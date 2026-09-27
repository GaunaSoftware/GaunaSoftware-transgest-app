const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const notices = require('../src/services/noticeCenter');
const reads = require('../src/services/operativeReadState');
const intelligence = require('../src/services/intelligence');
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const U='33333333-3333-4333-8333-333333333333', V='44444444-4444-4444-8444-444444444444';
const manager={id:U,empresa_id:A,rol:'gerente',productos:['transgest']};
async function run() {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY,cfg_alertas jsonb DEFAULT '[]');
      CREATE TABLE usuarios(id uuid PRIMARY KEY,empresa_id uuid);
      CREATE TABLE clientes(id uuid,empresa_id uuid,nombre text);
      CREATE TABLE facturas(id uuid,empresa_id uuid,cliente_id uuid,numero text,fecha date,fecha_vencimiento date,total numeric,estado text,origen_producto text);
      CREATE TABLE vehiculos(id uuid PRIMARY KEY,empresa_id uuid,matricula text,fecha_itv date,fecha_seguro date,plataformas jsonb);
      CREATE TABLE choferes(id uuid PRIMARY KEY,empresa_id uuid,nombre text,apellidos text,cap_vencimiento date);
      CREATE TABLE docs_vehiculos(id uuid,tipo text,vehiculo_id uuid,fecha_emision date,fecha_vencimiento date,created_at timestamptz);
      CREATE TABLE docs_choferes(id uuid,tipo text,chofer_id uuid,fecha_emision date,fecha_vencimiento date,created_at timestamptz);
      INSERT INTO empresas VALUES('${A}','[{"id":"maintenance","tipo_mantenimiento":"Aceite","dias_aviso":180}]'),('${B}','[]');
      INSERT INTO usuarios VALUES('${U}','${A}'),('${V}','${A}');
      INSERT INTO facturas VALUES('${U}','${A}',null,'A-2026-0072','2026-08-01','2026-09-01',1210,'emitida','transgest'),('${V}','${B}',null,'PRIVATE-B','2026-08-01','2026-09-01',99999,'emitida','transgest');
      INSERT INTO vehiculos VALUES('${U}','${A}','QA-REMOLQUE','2026-09-01',null,'[{"id":"p","nombre":"Plataforma QA","documentos":[{"id":"d","nombre":"Acceso","caducidad":"2026-09-02"}]}]');
      INSERT INTO choferes VALUES('${U}','${A}','Conductor','QA','2026-09-02');
      INSERT INTO docs_vehiculos VALUES('${U}','ITV','${U}','2026-01-01','2026-09-01',NOW()),('${V}','ITV','${U}','2026-09-01','2027-09-01',NOW());`);
    await pg.exec(fs.readFileSync(path.join(__dirname,'migrations/20260928_operational_alert_reads.sql'),'utf8'));
    const options={now:new Date('2026-09-27T12:00:00Z')};
    const result=await notices.readNotices(pg,manager,options);
    assert.equal(result.coverage,'completo'); assert.equal(result.errors.length,0);
    assert.ok(!JSON.stringify(result).includes('PRIVATE-B'));
    assert.equal(result.items.find(i=>i.category==='facturas').focus.factura_id,U);
    assert.equal(result.items.find(i=>i.category==='facturas').amount,1210);
    assert.ok(!result.items.some(i=>i.title.startsWith('ITV')), 'Renewed document supersedes expired history and ficha date');
    assert.ok(result.items.some(i=>i.category==='plataformas' && i.view==='vehiculos'));
    // Imported documents use the compatible legacy enum 'otro' and retain their
    // specific category in tipo_doc. A valid DNI must not conceal an expired CAP.
    await pg.exec(`ALTER TABLE docs_choferes ADD COLUMN tipo_doc text;
      ALTER TABLE docs_vehiculos ADD COLUMN tipo_doc text;
      INSERT INTO docs_choferes(id,tipo,tipo_doc,chofer_id,fecha_emision,fecha_vencimiento,created_at)
      VALUES('${U}','otro','cap','${U}','2021-09-01','2026-09-01',NOW()),
      ('${V}','otro','dni','${U}','2025-01-01','2033-01-01',NOW());
      INSERT INTO docs_vehiculos(id,tipo,tipo_doc,vehiculo_id,fecha_emision,fecha_vencimiento,created_at)
      VALUES('${A}','otro','seguro','${U}','2025-09-01','2026-09-01',NOW()),
      ('${B}','otro','itv','${U}','2026-09-01','2027-09-01',NOW());`);
    const imported=await notices.readNotices(pg,manager,options);
    assert.equal(imported.coverage,'completo');
    assert.equal(imported.items.filter(i=>i.category==='choferes').length,1,'CAP is not hidden by DNI and does not duplicate the master date');
    assert.ok(imported.items.some(i=>i.category==='choferes' && i.title.startsWith('cap')));
    assert.ok(imported.items.some(i=>i.category==='vehiculos' && i.title.startsWith('seguro')));
    assert.ok(!imported.items.some(i=>/^(itv|dni|otro)/i.test(i.title)));
    for (const state of ['borrador','anulada','cancelada','cobrada','rectificada']) {
      await pg.query('UPDATE facturas SET estado=$1 WHERE empresa_id=$2',[state,A]);
      assert.equal((await notices.readNotices(pg,manager,options)).items.filter(i=>i.category==='facturas').length,0,state);
    }
    await pg.query("UPDATE facturas SET estado='emitida' WHERE empresa_id=$1",[A]);
    const blocked={...manager,rol:'chofer'};
    await assert.rejects(notices.readNotices(pg,blocked,options),e=>e.status===403);
    const limited={...manager,permisos:{modulos:{facturacion:{ver:false},vehiculos:{ver:false},choferes:{ver:false}}}};
    assert.equal((await notices.readNotices(pg,limited,options)).items.length,0);
    const cfg=(await notices.settings(pg,manager)).map(r=>({...r,enabled:r.key!=='facturas'}));
    await notices.saveSettings(pg,manager,cfg);
    assert.equal((await notices.readNotices(pg,manager,options)).items.some(i=>i.category==='facturas'),false);
    assert.equal((await pg.query('SELECT cfg_alertas FROM empresas WHERE id=$1',[A])).rows[0].cfg_alertas[0].id,'maintenance');
    await assert.rejects(notices.saveSettings(pg,{...manager,rol:'trafico'},cfg),e=>e.status===403);
    await assert.rejects(notices.saveSettings(pg,manager,cfg.map(r=>({...r,days:-1}))),e=>e.status===400);
    assert.equal(notices.difference('2026-03-30','2026-03-29'),1);
    assert.equal((await notices.readNotices(pg,manager,{now:new Date('2026-03-29T22:30:00Z')})).date,'2026-03-30');
    const items=Array.from({length:301},(_,i)=>({key:`pedido:${i}`,estado:'pendiente',severity:'media'}));
    assert.equal(await reads.markRead(pg,manager,items),301);
    assert.equal((await reads.unreadItems(pg,manager,items)).length,0);
    assert.equal((await reads.unreadItems(pg,{...manager,id:V},items)).length,301);
    assert.equal((await reads.unreadItems(pg,{...manager,empresa_id:B},items)).length,301);
    assert.equal((await reads.unreadItems(pg,manager,[{...items[0],severity:'alta'}])).length,1,'Changed severity surfaces a new condition');
    assert.equal(reads.fingerprint({...items[0],minutos:61}),reads.fingerprint({...items[0],minutos:80}));
    assert.ok(!intelligence.toolsFor(manager).some(t=>t.name==='reservas_muelles'));
    await assert.rejects(intelligence.executeTool(pg,{...manager,rol:'trafico'},'analisis_rentabilidad',{}),e=>e.status===403);
    let turn=0;
    const answer=await intelligence.runConversation({db:pg,user:manager,messages:[{role:'user',content:'Documentación pendiente'}],request:async payload=>{
      if(++turn===1)return {output:[{type:'function_call',name:'vencimientos_empresa',call_id:'a',arguments:JSON.stringify({categoria:'plataformas',texto:'',pagina:'1'})}]};
      assert.ok(!JSON.stringify(payload).includes('PRIVATE-B'));
      return {output:[{type:'message',content:[{type:'output_text',text:'Consulta sintética verificada.'}]}]};
    }});
    assert.equal(answer.sources[0].name,'vencimientos_empresa');
    assert.ok(answer.references.some(r=>r.view==='vehiculos' && r.focus.vehiculo_id===U));
    console.log('PASS notice center: tenant/module isolation, fiscal states, renewal, platform links, settings, Madrid/DST, 301 read acknowledgements, independent users, changed conditions and Intelligence grounded references.');
  } finally { await pg.close(); }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
