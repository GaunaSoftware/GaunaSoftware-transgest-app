const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
async function main(){
 const pg=new PGlite();
 try{
  const source=fs.readFileSync(path.join(__dirname,'../src/routes/choferes.js'),'utf8');
  const insert=source.match(/`(INSERT INTO choferes[\s\S]*?RETURNING \*)`/)[1];
  const update=source.match(/`(UPDATE choferes\s+SET nombre=\$1[\s\S]*?RETURNING \*)`/)[1];
  const columns=insert.match(/choferes \(([^)]+)\)/)[1].split(',');
  const definitions=columns.map(c=>`${c} ${['historial_laboral','plataformas'].includes(c)?'jsonb':c==='fecha_alta'?'date':'text'}`);
  await pg.exec(`CREATE TABLE choferes(id text PRIMARY KEY DEFAULT 'driver-a',${definitions.join(',')},activo boolean DEFAULT true,estado text DEFAULT 'disponible',avisos jsonb,fecha_baja date,motivo_baja text,carta_renuncia_nombre text,carta_renuncia_mime text,carta_renuncia_base64 text)`);
  const values=['Ana','García Pérez',null,null,null,null,'C+E',null,null,null,'company-a',null,null,null,'[]','[]','Ana GP'];
  assert.equal((await pg.query(insert,values)).rows[0].alias,'Ana GP');
  const edit=['Ana','García Pérez',null,null,null,null,'C+E',true,null,null,null,null,null,'disponible',null,'driver-a','company-a',null,null,null,null,null,null,'[]',null,'Ana tráfico'];
  assert.equal((await pg.query(update,edit)).rows[0].alias,'Ana tráfico');
  edit[25]=null;
  assert.equal((await pg.query(update,edit)).rows[0].alias,null);
  edit[16]='other-company';edit[25]='No autorizado';
  assert.equal((await pg.query(update,edit)).rows.length,0);
  console.log('PASS driver alias SQL: create, update, clear and company isolation');
 }finally{await pg.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
