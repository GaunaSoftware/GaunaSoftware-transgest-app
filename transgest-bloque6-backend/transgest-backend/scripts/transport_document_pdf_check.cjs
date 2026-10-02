const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parse = require('pdf-parse');
const { renderDeca } = require('../src/services/transportDocumentPdf');

const d = {
  codigo_control:'QA-FORMATO', referencia_pedido:'PED-QA-0003', fecha_transporte:'2026-10-02',
  empresa:{nombre:'EMPRESA DE ENSAYO LOGÍSTICO DEL MEDITERRÁNEO, S.L.',logo_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='},
  cargador_contractual:{nombre:'CARGADOR SINTÉTICO DE MERCANCÍAS Y DISTRIBUCIÓN DEL MEDITERRÁNEO, S.L.',nif:'QA-CARGADOR',domicilio:'Avenida del Recinto Logístico de Ensayo, número 15, nave 2.3, módulo 1, 41000 Ciudad de Ensayo, España'},
  transportista_efectivo:{nombre:'TRANSPORTISTA SINTÉTICO Y OPERADOR LOGÍSTICO DEL MEDITERRÁNEO, S.L.',nif:'QA-TRANSPORTISTA',domicilio:'Calle del Centro de Transportes de Ensayo, número 28, oficina 3, 30000 Ciudad de Ensayo, España'},
  origen:{nombre:'C/ Almacén de Ensayo 1',direccion:'C/ ALMACÉN DE ENSAYO 1'},
  destino:{nombre:'CTRA. DEL RECINTO, 15 - NAVE 2.3 MÓDULO 1',direccion:'CTRA. DEL RECINTO, 15 - NAVE 2.3 MÓDULO 1',destinatario:'DESTINATARIO SINTÉTICO'},
  mercancia:{descripcion:'1 grupo + 1 palet de ensayo',peso_kg:5857,bultos:2},
  vehiculo:{tractora:'QA-TRACTORA',remolque:'QA-REMOLQUE'},
  firmas:{cargador:{nombre:'FIRMA AJENA A ESTE ORIGINAL',imagen:'data:image/png;base64,NOT-AN-ADVANCED-SIGNATURE'}},
};
const args = {version:1,generatedAt:'2026-10-02T14:00:00.000Z',url:'https://example.invalid/deca/qa'};
const normalized = value => value.replace(/\s+/g,' ').trim();
async function check(documento, name) {
  const pdf = await renderDeca({...args,documento});
  const pages = [];
  const parsed = await parse(pdf,{pagerender:async page=>{
    const content = await page.getTextContent();
    pages.push(content.items);
    return content.items.map(item=>item.str).join('\n');
  }});
  for (const items of pages) for (const item of items.filter(item=>item.str.trim())) {
    const y = item.transform[5];
    assert.ok(y >= 35 && y <= 810, `Texto fuera del área de página: ${item.str}`);
  }
  if (process.env.DECA_PDF_QA_OUTPUT) {
    fs.mkdirSync(process.env.DECA_PDF_QA_OUTPUT,{recursive:true});
    fs.writeFileSync(path.join(process.env.DECA_PDF_QA_OUTPUT,`${name}.pdf`),pdf);
  }
  return {parsed,pages,text:normalized(parsed.text)};
}
async function main() {
  const regular = await check(d,'deca-formato-corregido');
  const first = normalized(regular.pages[0].map(item=>item.str).join(' '));
  for (const party of [d.cargador_contractual,d.transportista_efectivo])
    for (const field of [party.nombre,party.nif,party.domicilio]) assert.ok(first.includes(field),'Las partes completas se muestran en la primera página');
  assert.equal(regular.parsed.numpages,1,'Un transporte con nombres y domicilios habituales cabe en una página');
  assert.equal(regular.text.split(d.origen.direccion).length-1,1,'No se repite la dirección usada como nombre de punto');
  assert.equal(regular.text.split(d.destino.direccion).length-1,1,'La dirección de entrega se imprime una sola vez');
  assert.doesNotMatch(regular.text,/Ver texto íntegro|Firma contractual|FIRMA AJENA A ESTE ORIGINAL/);
  assert.match(regular.text,/justificantes operativos/);
  const distinctName = await check({...d,origen:{nombre:'ALMACEN',direccion:'ALMACENES DE ENSAYO, CALLE 2'}},'deca-nombre-de-punto');
  assert.ok(distinctName.text.includes('ALMACEN ALMACENES DE ENSAYO, CALLE 2'),'No se elimina un nombre diferente que solo comparte el prefijo de la dirección');
  const long = await check({...d,cargador_contractual:{...d.cargador_contractual,domicilio:`${'AVENIDA DE ENSAYO '.repeat(300)}FIN DEL DOMICILIO ÍNTEGRO`}},'deca-textos-largos');
  assert.ok(long.parsed.numpages>1);
  assert.match(long.text,/FIN DEL DOMICILIO ÍNTEGRO/);
  const longFirst = normalized(long.pages[0].map(item=>item.str).join(' '));
  assert.ok(longFirst.includes(d.cargador_contractual.nombre)&&longFirst.includes(d.cargador_contractual.nif),'Incluso un domicilio excepcionalmente largo no oculta la identidad de la parte');
  const envios = Array.from({length:5},(_,i)=>({id:`QA-${i+1}`,referencia:`REPARTO ${i+1}`,origen:d.origen,destino:{...d.destino,destinatario:`DESTINATARIO ${i+1}`},mercancia:{descripcion:'Palets de ensayo',peso_kg:1000,bultos:1}}));
  const consolidated = await check({...d,envios},'deca-varios-envios');
  for (let i=1;i<=5;i++) assert.ok(consolidated.text.includes(`REPARTO ${i}`)&&consolidated.text.includes(`DESTINATARIO ${i}`));
  console.log('PASS DeCA PDF: partes completas en portada, direcciones sin duplicados, textos largos íntegros, envíos paginados y firmas operativas diferenciadas.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
