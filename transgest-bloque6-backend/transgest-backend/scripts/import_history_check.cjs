const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {evaluateHistory,createHistory}=require('../src/services/importHistory');

async function main(){
  const pg=new PGlite();
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  const batch='33333333-3333-4333-8333-333333333333';
  try{
    await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY);CREATE TABLE usuarios(id uuid PRIMARY KEY);
      CREATE TABLE clientes(id uuid PRIMARY KEY,empresa_id uuid,cif text);
      CREATE TABLE vehiculos(id uuid PRIMARY KEY,empresa_id uuid,matricula text);
      INSERT INTO empresas VALUES('${a}'),('${b}');
      INSERT INTO clientes VALUES('44444444-4444-4444-8444-444444444444','${a}','A12345678'),
        ('55555555-5555-4555-8555-555555555555','${b}','A12345678');
      INSERT INTO vehiculos VALUES('66666666-6666-4666-8666-666666666666','${a}','0009-LCZ');`);
    for(const name of ['20260924_import_batches.sql','20260924_import_history.sql']) await pg.exec(fs.readFileSync(path.join(__dirname,'migrations',name),'utf8'));
    await pg.query(`INSERT INTO import_batches(id,empresa_id,tipo,filename,source_system) VALUES($1,$2,'Pack_TransGest','synthetic.xlsx','legacy')`,[batch,a]);
    const header={source_id:'f1',numero_origen:'F-7',serie_origen:'2024',fecha:'2024-05-02',cliente_nombre:'Cliente histórico',cliente_cif:'A12345678',total:1210,rectificativa:'no'};
    const decision=await evaluateHistory(pg,a,'legacy','Facturas_Historicas',header,'f1');
    assert.equal(decision.action,'create');
    const invoice=await createHistory(pg,a,batch,'legacy','Facturas_Historicas',header,decision);
    assert.equal(invoice.table,'import_facturas_historicas');
    const line1={source_id:'l1',factura_source_id:'f1',linea:1,importe:800,vehiculo_matricula:'0009LCZ',proveedor:'Transportista',coste_proveedor:600};
    const line2={source_id:'l2',factura_source_id:'f1',linea:2,importe:410,coste_proveedor:200};
    for(const line of [line1,line2]){
      const checked=await evaluateHistory(pg,a,'legacy','Facturas_Lineas',line,line.source_id);
      assert.equal(checked.action,'create');
      await createHistory(pg,a,batch,'legacy','Facturas_Lineas',line,checked);
    }
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM import_factura_lineas_historicas')).rows[0].n,2);
    assert.equal((await evaluateHistory(pg,a,'legacy','Facturas_Lineas',{...line2,importe:500},'different-id')).action,'review');
    const rect={...header,source_id:'f2',numero_origen:'AB-2',total:-121,rectificativa:'sí',rectifica_referencia:'F-7'};
    const rectDecision=await evaluateHistory(pg,a,'legacy','Facturas_Historicas',rect,'f2');
    assert.equal(rectDecision.action,'create');
    await createHistory(pg,a,batch,'legacy','Facturas_Historicas',rect,rectDecision);
    assert.equal((await pg.query('SELECT rectificativa FROM import_facturas_historicas WHERE source_id=$1',['f2'])).rows[0].rectificativa,true);
    const balance={source_id:'p1',numero_origen:'old-pending',cliente_nombre:'Cliente histórico',cliente_cif:'A12345678',total:1210,cobrado:605,fecha_vencimiento:'2024-07-01'};
    const balanceDecision=await evaluateHistory(pg,a,'legacy','Facturas_Pendientes',balance,'p1');
    assert.equal(balanceDecision.outstanding,605);
    await createHistory(pg,a,batch,'legacy','Facturas_Pendientes',balance,balanceDecision);
    assert.equal(Number((await pg.query('SELECT saldo_pendiente FROM import_saldos_pendientes WHERE source_id=$1',['p1'])).rows[0].saldo_pendiente),605);
    assert.equal((await evaluateHistory(pg,a,'legacy','Facturas_Historicas',{...header,cliente_cif:'B99999999',numero_origen:'X'},'f3')).action,'review');
    assert.equal((await evaluateHistory(pg,b,'legacy','Facturas_Lineas',line1,'l1')).action,'review');
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='facturas'")).rows[0].n,0,
      'Historical import must not touch the fiscal invoice table');
    console.log('PASS: historical header with two lines, negative rectification, subcontractor cost, opening balance, tenant isolation and no fiscal invoice. Synthetic PGlite only.');
  }finally{await pg.close();}
}
main().catch(cause=>{console.error(cause);process.exitCode=1;});
