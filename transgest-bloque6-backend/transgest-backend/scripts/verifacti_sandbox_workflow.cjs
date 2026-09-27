// Manual opt-in probe. No database access; credentials remain in process memory.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const provider=require('../src/services/fiscalProviderVerifacti');
const key=process.env.VERIFACTI_TEST_API_KEY||'';
const target=process.env.VERIFACTI_TEST_REPORT;
if(!key.startsWith('vf_test_')||!target)throw new Error('Set a TEST key and an explicit report path. Production keys are refused.');
const config={entorno:'pruebas',nif_declarante:'B75777847',verifactu:{provider_base_url:'https://api.verifacti.com',provider_api_key:key}};
const persist=report=>{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(report,null,2));};
(async()=>{
 const health=await provider.probeVerifactiConnection(config);
 console.log(JSON.stringify({stage:'health',ok:health.ok,environment:health.response?.entorno,nif:health.response?.nif,message:health.message}));
 if(!health.ok)throw new Error('Test identity/environment was not verified. No invoice sent.');
 let report=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):null;
 if(!report){
  const id=crypto.randomUUID(),date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  report={synthetic:true,environment:'test',issuer:'B75777847',created_at:new Date().toISOString(),id,
   payload:{expedicion:{serie:'TG-TEST',numero:`TG-TEST-${Date.now()}`,fecha_factura:date},receptor:{nombre:'Cliente sintético de ensayo',nif:'A15022510'},
    importes:{base_imponible:100,tipo_iva:21,cuota_iva:21,total:121},lineas:[{concepto:'Ensayo de integración TransGest. Sin operación comercial.'}]}};
  persist(report);
 }
 if(!report.synthetic||report.environment!=='test'||report.issuer!==config.nif_declarante)throw new Error('Report identity mismatch.');
 const queue={empresa_id:'00000000-0000-4000-8000-000000000001',registro_id:report.id,idempotency_key:`tg-sandbox-${report.id}`,payload:report.payload};
 if(!report.provider_uuid){
  if(report.attempted_at){
   const existing=await provider.findVerifactiInvoice(config,provider.mapInternalPayloadToVerifacti(report.payload));
   if(existing.provider_uuid)report.provider_uuid=existing.provider_uuid;
   else throw new Error('Previous attempt has uncertain outcome. Reconcile in the provider before another create.');
  } else {
   report.attempted_at=new Date().toISOString();persist(report);
   const created=await provider.createVerifactiRecord(config,queue);
   report.provider_uuid=created.provider_uuid;report.create_status=created.provider_status;persist(report);
   const replay=await provider.createVerifactiRecord(config,queue);
   report.idempotency_same_uuid=replay.provider_uuid===created.provider_uuid;persist(report);
   if(!report.idempotency_same_uuid)throw new Error('Provider returned a different identifier for the same idempotency key.');
  }
 }
 const status=await provider.getVerifactiRecordStatus(config,report.provider_uuid);
 report.status=status.provider_status;report.checked_at=new Date().toISOString();report.qr_url=status.official_qr_url||null;
 try {const xml=await provider.downloadVerifactiXml(config,{payload:report.payload,provider_uuid:report.provider_uuid});report.xml_available=true;report.xml_sha256=crypto.createHash('sha256').update(xml).digest('hex');}
 catch(e){report.xml_available=false;report.xml_error=e.message;}
 persist(report);
 console.log(JSON.stringify({stage:'invoice',environment:'test',uuid:report.provider_uuid,status:report.status,idempotency_same_uuid:report.idempotency_same_uuid,xml_available:report.xml_available,report:target}));
})().catch(e=>{console.error(JSON.stringify({error:e.message,status:e.status||null}));process.exitCode=1;});
