const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');

async function main(){
  const pg=new PGlite();
  const company='11111111-1111-4111-8111-111111111111';
  const other='22222222-2222-4222-8222-222222222222';
  const vehicle='33333333-3333-4333-8333-333333333333';
  const order='44444444-4444-4444-8444-444444444444';
  const user='55555555-5555-4555-8555-555555555555';
  try{
    await pg.exec(`CREATE TABLE vehiculos(id uuid PRIMARY KEY,empresa_id uuid,km_actuales numeric,updated_at timestamptz);
      CREATE TABLE taller_intervenciones(id uuid PRIMARY KEY,empresa_id uuid,vehiculo_id uuid,estado text,origen_taller text,
        factura_proveedor_num text,factura_proveedor_file_base64 text,factura_proveedor_importe numeric,
        km_en_intervencion numeric,cierre_definitivo_at timestamptz,updated_at timestamptz);
      CREATE TABLE taller_intervencion_piezas(intervencion_id uuid,empresa_id uuid,pendiente_asignar boolean,escaneado boolean);
      CREATE TABLE vehiculo_eventos(empresa_id uuid,vehiculo_id uuid,tipo text,actor_id uuid,detalle jsonb);`);
    await pg.query('INSERT INTO vehiculos(id,empresa_id,km_actuales) VALUES($1,$2,100)',[vehicle,company]);
    await pg.query("INSERT INTO taller_intervenciones(id,empresa_id,vehiculo_id,estado,origen_taller) VALUES($1,$2,$3,'abierta','externo')",[order,company,vehicle]);
    const db={transaction:fn=>pg.transaction(fn)};
    const handlers={};
    const router={post:(route,...middlewares)=>{handlers[route]=middlewares.at(-1)}};
    const source=fs.readFileSync(path.join(__dirname,'../src/routes/taller.js'),'utf8');
    const start=source.indexOf('router.post("/intervenciones/:id/cerrar"');
    const end=source.indexOf('router.delete("/intervenciones/:id"',start);
    assert(start>0 && end>start);
    vm.runInNewContext(source.slice(start,end),{router,db,empresaId:req=>req.empresaId,requireRole:()=>()=>{}});
    const close=async (body,empresaId=company)=>{
      const res={code:200,status(code){this.code=code;return this},json(data){this.data=data;return this}};
      await handlers['/intervenciones/:id/cerrar']({params:{id:order},empresaId,user:{id:user,rol:'gerente'},body},res);
      return res;
    };
    assert.equal((await close({km_retorno:101},other)).code,404,'tenant isolation');
    assert.equal((await close({km_retorno:101})).code,409,'external invoice required');
    await pg.query("UPDATE taller_intervenciones SET factura_proveedor_num='FAC-1',factura_proveedor_file_base64='JVBERg==',factura_proveedor_importe=200 WHERE id=$1",[order]);
    await pg.query('INSERT INTO taller_intervencion_piezas VALUES($1,$2,true,false)',[order,company]);
    assert.equal((await close({km_retorno:101})).code,409,'unscanned parts block closing');
    await pg.query('DELETE FROM taller_intervencion_piezas WHERE intervencion_id=$1',[order]);
    assert.equal((await close({km_retorno:99})).code,409,'odometer cannot go backwards');
    assert.equal((await close({km_retorno:3001})).code,409,'large jump needs explicit verification');
    assert.equal((await close({km_retorno:101})).code,200);
    assert.equal((await close({km_retorno:102})).code,200,'repeat returns existing closed order');
    assert.equal(Number((await pg.query('SELECT km_actuales FROM vehiculos')).rows[0].km_actuales),101);
    assert.equal((await pg.query("SELECT COUNT(*)::int AS n FROM vehiculo_eventos WHERE tipo='vehiculo.odometro_taller'")).rows[0].n,1);
    console.log('PASS workshop closure: tenant scope, invoice/parts checks, odometer guard, atomic update and retry.');
  }finally{await pg.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
