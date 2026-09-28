const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');

async function main(){
  const pg=new PGlite();
  const company='11111111-1111-4111-8111-111111111111';
  const other='22222222-2222-4222-8222-222222222222';
  const driver='33333333-3333-4333-8333-333333333333';
  try{
    await pg.exec(`CREATE TABLE chofer_jornadas(empresa_id uuid,chofer_id uuid,inicio_at timestamptz,estado text,
      km_inicio numeric,km_fin numeric,km_tramo_inicio numeric,km_acumulados numeric,hace_noche boolean);
      CREATE TABLE nominas_emitidas(id uuid DEFAULT gen_random_uuid(),empresa_id uuid,chofer_id uuid,
      periodo text,estado text,created_at timestamptz DEFAULT now(),liquido numeric);`);
    await pg.query(`INSERT INTO chofer_jornadas VALUES
      ($1,$2,'2026-09-28T06:00:00Z','cerrada',100,150,100,0,true),
      ($1,$2,'2026-09-29T06:00:00Z','cerrada',400,510,500,20,false),
      ($1,$2,'2026-09-30T06:00:00Z','abierta',510,NULL,510,0,false),
      ($3,$2,'2026-09-28T06:00:00Z','cerrada',10,999,10,0,true)`,[company,driver,other]);
    await pg.query("INSERT INTO nominas_emitidas(empresa_id,chofer_id,periodo,estado,liquido) VALUES($1,$2,'2026-09','emitida',1200),($3,$2,'2026-09','emitida',9000)",[company,driver,other]);
    const handlers={};
    const router={get:(route,...middlewares)=>{handlers[route]=middlewares.at(-1)}};
    const source=fs.readFileSync(path.join(__dirname,'../src/routes/choferes.js'),'utf8');
    const start=source.indexOf('router.get("/app/resumen-mensual"');
    const end=source.indexOf('router.post("/app/firma-base"',start);
    assert(start>0 && end>start);
    vm.runInNewContext(source.slice(start,end),{
      router,db:{query:(sql,args)=>pg.query(sql,args)},requireChoferApp:()=>{},
      ensureChoferJornadaSchema:async()=>{},resolveChoferApp:async()=>({id:driver}),
    });
    const call=async (empresaId,mes)=>{
      const res={code:200,status(code){this.code=code;return this},json(data){this.data=data;return this}};
      await handlers['/app/resumen-mensual']({empresaId,user:{empresa_id:empresaId},query:{mes}},res);
      return res;
    };
    assert.equal((await call(company,'2026-13')).code,400);
    const own=await call(company,'2026-09');
    assert.equal(own.code,200);
    assert.equal(own.data.km_recorridos,80);
    assert.equal(own.data.noches_fuera,1);
    assert.equal(own.data.cobertura_km,1);
    assert.equal(Number(own.data.nomina.liquido),1200);
    const otherResult=await call(other,'2026-09');
    assert.equal(otherResult.data.km_recorridos,989);
    assert.equal(Number(otherResult.data.nomina.liquido),9000);
    const empty=await call(company,'2026-08');
    assert.equal(empty.data.km_recorridos,null);
    assert.equal(empty.data.cobertura_km,null);
    console.log('PASS driver monthly summary: odometer segments, nights, missing data and company/payroll isolation.');
  }finally{await pg.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
