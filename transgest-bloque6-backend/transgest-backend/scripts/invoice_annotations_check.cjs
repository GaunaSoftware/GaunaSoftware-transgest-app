const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const annotations = require('../src/services/invoiceAnnotations');

async function main() {
  const pg = new PGlite();
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const issued = '11111111-1111-4111-8111-111111111111';
  const draft = '22222222-2222-4222-8222-222222222222';
  const actor = '33333333-3333-4333-8333-333333333333';
  const db = { query:(sql,args)=>pg.query(sql,args), transaction:fn=>pg.transaction(tx=>fn({query:(sql,args)=>tx.query(sql,args)})) };
  try {
    await pg.exec('CREATE TABLE facturas(id uuid PRIMARY KEY,empresa_id uuid NOT NULL,estado text NOT NULL,numero text NOT NULL,base numeric NOT NULL,total numeric NOT NULL);');
    const migration = fs.readFileSync(path.join(__dirname,'migrations/20260925_factura_anotaciones.sql'),'utf8');
    await pg.exec(migration);
    await pg.exec(migration);
    await pg.query('INSERT INTO facturas VALUES($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)',[issued,a,'emitida','A-1',1000,1210,draft,a,'borrador','A-2',500,605]);
    const request=(facturaId,empresaId,body)=>annotations.save(db,{facturaId,empresaId,actorId:actor,body});
    await assert.rejects(request(issued,b,{version:0,motivo:'Corrección de matrícula',matricula:'1234ABC'}),{status:404});
    await assert.rejects(request(draft,a,{version:0,motivo:'Corrección de matrícula',matricula:'1234ABC'}),{code:'FACTURA_BORRADOR'});
    await assert.rejects(request(issued,a,{version:0,motivo:'Cambiar total',total:0}),{status:400});
    const first=await request(issued,a,{version:0,motivo:'Matrícula corregida según tráfico',matricula:'1234ABC',referencia_cliente:'REF-42'});
    assert.equal(first.actual.version,1);
    assert.equal(first.actual.datos.matricula,'1234ABC');
    const retry=await request(issued,a,{version:0,motivo:'Reintento de la misma anotación',matricula:'1234ABC'});
    assert.equal(retry.sin_cambios,true);
    await assert.rejects(request(issued,a,{version:0,motivo:'Cambio simultáneo',matricula:'5678DEF'}),{code:'FACTURA_ANOTACIONES_VERSION'});
    const second=await request(issued,a,{version:1,motivo:'Remolque informado por tráfico',remolque:'R-9999-XYZ'});
    assert.equal(second.actual.version,2);
    assert.equal(second.actual.datos.matricula,'1234ABC');
    const read=await annotations.read(db,{facturaId:issued,empresaId:a});
    assert.equal(read.historial.length,2);
    assert.equal(read.historial[0].cambios.remolque.anterior,'');
    assert.equal((await annotations.read(db,{facturaId:issued,empresaId:b})).historial.length,0);
    const fiscal=(await pg.query('SELECT numero,base,total FROM facturas WHERE id=$1',[issued])).rows[0];
    assert.deepEqual([fiscal.numero,Number(fiscal.base),Number(fiscal.total)],['A-1',1000,1210]);
    console.log('PASS invoice annotations: versioned history, idempotent retry, stale conflict, fiscal immutability, draft guard and tenant isolation.');
  } finally { await pg.close(); }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
