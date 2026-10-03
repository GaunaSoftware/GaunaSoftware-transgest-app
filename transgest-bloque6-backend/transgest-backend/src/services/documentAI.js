const defaultDb=require('./db'),defaultKeys=require('./apiKeys'),defaultAI=require('./aiProvider');
const fail=(message,status)=>Object.assign(Error(message),{status});
async function readDocument(company,file,instruction,{db=defaultDb,keys=defaultKeys,ai=defaultAI}={}){
  const provider=ai.normalizeAiProvider(await keys.getGlobalSetting('ia_provider',process.env.AI_PROVIDER||'anthropic'));
  const credential=await keys.resolveBestApiKey(company,provider,['openai','ai_generic','anthropic']);
  if(!credential.key)throw fail('La IA no está configurada para esta empresa. Puedes completar la ficha manualmente.',503);
  const actual=ai.normalizeAiProvider(credential.provider||provider);
  const model=ai.normalizeAiModel(actual,actual===provider?await keys.getGlobalSetting('ia_model',process.env.AI_MODEL||''):'');
  const base=ai.normalizeAiBaseUrl(actual,await keys.getGlobalSetting('ia_base_url',process.env.AI_BASE_URL||''));
  const image=file.mime.startsWith('image/'),pdf=file.mime==='application/pdf';
  if(!image&&!pdf)throw fail('La lectura admite PDF, JPG, PNG y WebP.',422);
  let text='';
  if(actual==='ai_generic'&&pdf){try{text=(await require('pdf-parse')(file.bytes)).text||'';}catch{}if(!text.trim())throw fail('Este conector no puede leer el PDF escaneado. Usa una imagen legible o completa la ficha manualmente.',422);}
  await keys.assertApiUsageAllowed(company,actual);
  const period=new Date().toISOString().slice(0,7);
  await db.transaction(async tx=>{
    const row=(await tx.query('SELECT plan,ia_limite_mensual,ia_periodo_mes,ia_usos_mes FROM empresas WHERE id=$1 FOR UPDATE',[company])).rows[0];
    if(!['enterprise','pro_intelligence'].includes(row?.plan))throw fail('La lectura IA requiere Pro Intelligence.',403);
    const limit=Number(row.ia_limite_mensual??1000),used=row.ia_periodo_mes===period?Number(row.ia_usos_mes||0):0;
    if(used>=limit)throw fail('Se han agotado los usos de IA de este mes. El documento sigue archivado.',429);
    await tx.query('UPDATE empresas SET ia_periodo_mes=$2,ia_usos_mes=$3 WHERE id=$1',[company,period,used+1]);
  });
  const base64=file.bytes.toString('base64');let url,headers,body;
  if(actual==='openai'){
    const content=[{type:'input_text',text:instruction}];
    content.push(image?{type:'input_image',image_url:`data:${file.mime};base64,${base64}`}:{type:'input_file',filename:file.name,file_data:`data:application/pdf;base64,${base64}`});
    url=base+'/responses';headers={Authorization:'Bearer '+credential.key};body={model,store:false,input:[{role:'user',content}],max_output_tokens:6000};
  }else if(actual==='anthropic'){
    url=base+'/messages';headers={'x-api-key':credential.key,'anthropic-version':'2023-06-01'};
    body={model,max_tokens:6000,messages:[{role:'user',content:[{type:'text',text:instruction},{type:image?'image':'document',source:{type:'base64',media_type:file.mime,data:base64}}]}]};
  }else{
    const content=[{type:'text',text:instruction+'\n'+text.slice(0,90000)}];if(image)content.push({type:'image_url',image_url:{url:`data:${file.mime};base64,${base64}`}});
    url=base+'/chat/completions';headers={Authorization:'Bearer '+credential.key};body={model,max_tokens:6000,messages:[{role:'user',content}],response_format:{type:'json_object'}};
  }
  let response;
  try{response=await ai.fetchWithTimeout(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)},60000);}
  catch{throw fail('La IA no respondió. El archivo sigue guardado; reintenta o completa la ficha manualmente.',502);}
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw fail(response.status===429?'El proveedor de IA ha agotado su cuota o sus créditos.':'El proveedor de IA no pudo leer el documento.',response.status===429?429:502);
  await keys.recordApiUsage(company,actual,1);
  const raw=result.output_text||result.choices?.[0]?.message?.content||(result.output||[]).flatMap(r=>r.content||[]).map(r=>r.text||'').join('\n')||(result.content||[]).map(r=>r.text||'').join('\n');
  let data;try{data=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/,'').replace(/```$/,''));}catch{throw fail('La IA no devolvió datos válidos. No se ha modificado la ficha.',422);}
  return {data,provider:actual,model};
}
module.exports={readDocument};
