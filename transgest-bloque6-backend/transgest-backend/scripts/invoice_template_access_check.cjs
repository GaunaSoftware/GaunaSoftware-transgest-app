const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const db = require('../src/services/db');
const router = require('../src/routes/datos_empresa');

async function main() {
  const pg = new PGlite();
  await pg.exec('CREATE TABLE empresas(id UUID PRIMARY KEY);');
  await pg.exec(require('node:fs').readFileSync(require('node:path').join(__dirname,'migrations/20260924_invoice_template.sql'),'utf8'));
  const a='00000000-0000-0000-0000-000000000001', b='00000000-0000-0000-0000-000000000002';
  await pg.query('INSERT INTO empresas(id) VALUES($1),($2)',[a,b]);
  const original=db.query;
  db.query=(sql,params)=>pg.query(sql,params);
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  async function call(method,owner,role='gerente',body={}) {
    const route=router.stack.find(layer=>layer.route?.path==='/factura-plantilla'&&layer.route.methods[method]).route;
    const req={empresaId:owner,user:{empresa_id:owner,rol:role,plan:'profesional',productos:['transgest']},body,method:method.toUpperCase(),path:'/factura-plantilla'};
    const res={code:200,status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
    for(const layer of route.stack) {
      let next=false;
      await layer.handle(req,res,()=>{next=true;});
      if(!next) break;
    }
    return res;
  }
  try {
    assert.equal((await call('post',a,'gerente',{nombre:'QA',mime:'image/png',imagen_base64:image})).code,200);
    assert.equal((await call('get',a)).data.nombre,'QA');
    assert.equal((await call('get',b)).data,null,'another company cannot read the template');
    assert.equal((await call('post',a,'administrativo',{nombre:'Invasión',mime:'image/png',imagen_base64:image})).code,403);
    assert.equal((await call('get',a,'chofer')).code,403);
    assert.equal((await call('delete',b)).code,200);
    assert.equal((await call('get',a)).data.nombre,'QA','other company delete must not alter A');
    assert.equal((await call('post',a,'gerente',{nombre:'No válido',mime:'image/png',imagen_base64:Buffer.from('<script/>').toString('base64')})).code,400);
  } finally { db.query=original; await pg.close(); }
  console.log('Plantilla factura: imagen validada, roles y aislamiento de empresa OK');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
