const path=require('path');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeLink(value) {try {const u=new URL(value);return u.protocol==='https:'||u.protocol==='http:'?u.href:'';}catch{return '';}}
function emailBrand(company={}) {
  const profile=company.cfg_precios?.empresa_perfil||company.cfg_precios||{};
  const raw=String(company.logo_base64||profile.logo_base64||'');
  const match=raw.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/);
  const mime=match?.[1]||profile.logo_mime||company.cfg_precios?.logo_mime||'image/png';
  const bytes=match?.[2]||raw;
  const logo=/^image\/(png|jpeg)$/.test(mime)&&bytes.length>0&&bytes.length<2800000&&/^[A-Za-z0-9+/=\s]+$/.test(bytes);
  return {name:company.nombre||profile.razon_social||'TransGest',replyTo:profile.email||company.email||'',logo:!!logo,attachments:[
    {filename:'transgest.png',path:path.join(__dirname,'../../assets/transgest-email.png'),cid:'transgest-brand'},
    ...(logo?[{filename:'empresa.'+(mime==='image/jpeg'?'jpg':'png'),content:Buffer.from(bytes,'base64'),contentType:mime,cid:'company-brand'}]:[])
  ]};
}
function transportEmail(template,data={},brand={}) {
  const invite=template==='invitacion_usuario';
  const title=invite?'Tu acceso a TransGest':template==='colaborador_confirmar'?'Nueva carga para confirmar':'Actualización de tu transporte';
  const cta=invite?'Activar mi acceso':template==='colaborador_confirmar'?'Revisar y aceptar carga':'Abrir transporte';
  const url=safeLink(data.url);
  const rows=[['Referencia',data.numero],['Ruta',data.ruta],['Fecha de carga',data.fecha_carga],['Precio acordado',data.precio],['Código DCD',data.dcd_codigo],['Canal DCD',data.dcd_canal]];
  const links=(Array.isArray(data.map_links)?data.map_links:[]).filter(x=>safeLink(x.url));
  return {asunto:invite?`Invitación a TransGest · ${data.empresa||brand.name||''}`:`${title} · ${data.numero||''}`,
    html:`<!doctype html><html lang="es"><body style="margin:0;background:#f1f6f7;font-family:Arial,sans-serif;color:#102a35"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" style="width:100%;max-width:600px;background:white;border:1px solid #dce8eb;border-radius:16px" cellspacing="0" cellpadding="0"><tr><td style="padding:24px;border-bottom:1px solid #e5eef0"><table role="presentation" width="100%"><tr><td><img src="cid:transgest-brand" width="180" alt="TransGest" style="max-width:100%;height:auto"/></td><td align="right">${brand.logo?'<img src="cid:company-brand" width="100" alt="Logo de la empresa" style="max-height:64px;object-fit:contain"/>':esc(brand.name||data.empresa)}</td></tr></table></td></tr><tr><td style="padding:28px"><p style="color:#087f78;font-size:12px;font-weight:bold;text-transform:uppercase">${esc(data.empresa||brand.name)}</p><h1 style="font-size:25px;line-height:1.3;margin:12px 0">${title}</h1><p style="line-height:1.7">Hola, ${esc(data.nombre||data.colaborador||'colaborador')}. ${invite?'Ya puedes activar tu acceso y gestionar los viajes y documentos que te asigne la empresa. El enlace caduca en 72 horas.':'Consulta los datos del transporte y responde desde el enlace seguro o desde tu cuenta de TransGest.'}</p>${invite?'':`<table width="100%" style="border-collapse:collapse;margin:20px 0">${rows.filter(([,v])=>v!=null&&v!=='').map(([label,value])=>`<tr><td style="padding:12px 8px;border-bottom:1px solid #e7eff1;color:#617987;font-size:13px">${label}</td><td style="padding:12px 8px;border-bottom:1px solid #e7eff1;font-size:14px;font-weight:bold">${esc(value)}</td></tr>`).join('')}</table>`}${url?`<p style="margin:28px 0"><a href="${esc(url)}" style="display:inline-block;padding:15px 24px;border-radius:10px;background:#00867f;color:white;text-decoration:none;font-weight:bold">${cta}</a></p>`:''}${safeLink(data.dcd_url)?`<p><a href="${esc(safeLink(data.dcd_url))}" style="color:#007e77">Consultar documento de control digital</a> · ${esc(data.dcd_estado||'')}</p>`:''}${data.dcd_instrucciones?`<p style="line-height:1.6;color:#617987">${esc(data.dcd_instrucciones)}</p>`:''}${links.map(x=>`<p><a style="color:#007e77" href="${esc(safeLink(x.url))}">${esc(x.label||[x.tipo,x.nombre||x.direccion].filter(Boolean).join(' · ')||'Ver punto del viaje')}</a></p>`).join('')}${url?`<p style="font-size:12px;line-height:1.6;color:#718792;word-break:break-all">Si el botón no funciona, abre este enlace:<br/>${esc(url)}</p>`:''}</td></tr><tr><td style="padding:20px 28px;background:#eef9f6;color:#52736e;font-size:12px;line-height:1.6">${esc(brand.name||data.empresa)} · TransGest<br/>${brand.replyTo?'Puedes responder a este correo para contactar con la empresa.':'Mensaje automático de transporte.'}</td></tr></table></td></tr></table></body></html>`};
}
module.exports={emailBrand,transportEmail,safeLink};
