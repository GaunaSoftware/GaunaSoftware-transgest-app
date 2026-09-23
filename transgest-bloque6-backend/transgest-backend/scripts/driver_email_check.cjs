const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {emailBrand,transportEmail}=require('../src/services/transportEmail');
const nodemailer=require('nodemailer');
async function main(){
 const dockerfile=fs.readFileSync(path.join(__dirname,'../Dockerfile'),'utf8');
 assert.match(dockerfile,/^COPY\s+assets\/transgest-email\.png\s+\.\/assets\/transgest-email\.png\s*$/m,
   'The production image must include the email logo attachment');
 const emailLogo=path.join(__dirname,'../assets/transgest-email.png');
 assert(fs.existsSync(emailLogo),'The email logo attachment must exist');
 const platform={smtp_host:'platform.test',smtp_from:'noreply@platform.test',smtp_from_nombre:'Gauna'},company={activo:true,smtp_host:'company.test',smtp_from:'trafico@company.test',smtp_from_nombre:'Empresa',reply_to:'reply@company.test'};
 let activeCompany=company,sent,lastConfig;
 const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNlsAAAAASUVORK5CYII=';
 const context={emailBrand,transportEmail,PLANTILLAS:{},process:{env:{}},logger:{warn(){},info(){},error(){}},ensureEmailTables:async()=>{},platformSmtpConfig:async()=>platform,getEmpresaEmailConfig:async()=>activeCompany,
 db:{query:async sql=>({rows:sql.startsWith('SELECT nombre')?[{nombre:'Empresa',logo_base64:logo,cfg_precios:{empresa_perfil:{email:'contact@company.test'}}}]:[]})},
 getTransporter:cfg=>{lastConfig=cfg;return {sendMail:async payload=>{sent=payload;const info=await nodemailer.createTransport({streamTransport:true,buffer:true}).sendMail(payload);const mime=info.message.toString();assert(mime.includes('Content-ID: <transgest-brand>'));assert(mime.includes('Content-ID: <company-brand>'));return info;}};}};
 const source=fs.readFileSync(path.join(__dirname,'../src/services/email.js'),'utf8');
 vm.runInNewContext(source.slice(source.indexOf('async function resolveTransportConfig'),source.indexOf('// ── Plantillas HTML')),context);
 vm.runInNewContext(source.slice(source.indexOf('async function enviarEmail'),source.indexOf('module.exports =')),context);
 const payload={empresa_id:'company',destinatario:'test@receiver.test',plantilla:'colaborador_confirmar',datos:{numero:'TEST-1',url:'https://example.test/accept',map_links:[{tipo:'Carga',direccion:'Valencia',url:'https://maps.google.com/?q=Valencia'}],dcd_instrucciones:'Mostrar el documento'}};
 await context.enviarEmail(payload);assert.equal(lastConfig.smtp_host,'company.test');assert.equal(sent.from.address,'trafico@company.test');assert.equal(sent.replyTo,'reply@company.test');assert(sent.html.includes('Carga · Valencia'));assert(sent.html.includes('Mostrar el documento'));
 activeCompany=null;await context.enviarEmail(payload);assert.equal(sent.from.address,'noreply@platform.test');assert.equal(sent.replyTo,'contact@company.test');
 await context.enviarEmail({...payload,plantilla:'invitacion_usuario'});assert(sent.html.includes('Activar mi acceso'));
 console.log('PASS company SMTP precedence, platform fallback, reply-to, dual CID logos, invitation and load MIME. Stream transport only; no external delivery.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
