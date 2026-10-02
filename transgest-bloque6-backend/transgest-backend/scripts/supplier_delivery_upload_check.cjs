const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepareSupplierProofs } = require('../src/services/supplierProofUpload');
const { PLANTILLAS } = require('../src/services/email');

const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
const valid = { nombre:'Albarán firmado.png', file_mime:'image/png', file_base64:png.toString('base64') };
assert.equal(prepareSupplierProofs([valid])[0].mime, 'image/png');
assert.throws(() => prepareSupplierProofs([]), /Selecciona entre 1 y 8/);
assert.throws(() => prepareSupplierProofs([{...valid,file_mime:'application/pdf'}]), /no coincide/);
assert.throws(() => prepareSupplierProofs(Array(9).fill(valid)), /Selecciona entre 1 y 8/);

const email = PLANTILLAS.colaborador_descarga({numero:'PED-QA',url:'https://example.invalid/paso',dcd_url:'https://example.invalid/deca'}).html;
assert.match(email,/Confirmar descarga y subir albaranes/);
assert.doesNotMatch(email,/DeCA|example\.invalid\/deca/i, 'el correo de albaranes no debe incluir el DeCA');

const script = fs.readFileSync(path.join(__dirname,'../src/public/colaboradorDescarga.js'),'utf8');
const events = {};
const button = {disabled:false,dataset:{uploadUrl:'/api/v1/pedidos/colaborador/descarga/token-qa'},addEventListener:(name,handler)=>{events[name]=handler;}};
const files = {files:[{name:'Albarán firmado.png',type:'image/png',size:png.length,content:png}]};
const notes = {value:'Entregado sin incidencia'};
const message = {textContent:''};
const main = {innerHTML:''};
const document = {getElementById:id=>({send:button,files,notas:notes,msg:message})[id],querySelector:selector=>selector==='main'?main:null};
const requests = [];
let failRequest = false;
class FileReader {
  readAsDataURL(file) {
    this.result = `data:${file.type};base64,${file.content.toString('base64')}`;
    this.onload();
  }
}
const fetch = async (url,options) => {
  requests.push({url,options});
  if (failRequest) return {ok:false,status:503,json:async()=>({error:'Servicio temporalmente no disponible'})};
  return {ok:true,json:async()=>({html:'<h1>Albaranes recibidos</h1>'})};
};
vm.runInNewContext(script,{document,FileReader,fetch});

(async()=>{
  await events.click();
  assert.equal(requests.length,1,'el botón debe realizar una petición real');
  assert.equal(requests[0].url,button.dataset.uploadUrl);
  assert.equal(JSON.parse(requests[0].options.body).documentos[0].file_base64,valid.file_base64);
  assert.match(main.innerHTML,/Albaranes recibidos/);
  files.files=[];
  button.disabled=false;
  await events.click();
  assert.equal(requests.length,1,'sin archivo no debe confirmar la descarga');
  assert.match(message.textContent,/Selecciona al menos un albarán/);
  files.files=[{name:valid.nombre,type:'image/png',size:png.length,content:png}];
  failRequest=true;
  await events.click();
  assert.equal(requests.length,2);
  assert.equal(button.disabled,false,'un fallo permite reintentar sin perder el archivo');
  assert.match(message.textContent,/temporalmente no disponible/);
  console.log('PASS carga de albaranes, MIME y firma, límite, correo sin DeCA y botón de descarga');
})().catch(error=>{console.error(error);process.exitCode=1;});
