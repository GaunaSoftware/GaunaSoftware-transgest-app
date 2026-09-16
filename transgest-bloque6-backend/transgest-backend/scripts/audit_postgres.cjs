// Creates new loopback-only databases. Never accepts an existing database name.
const {Pool}=require('pg');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const exec=require('node:util').promisify(execFile);
function createAdapter(client) {
  return {
    query:(sql,params)=>client.query(sql,params),
    exec:async sql=>{const result=await client.query(sql);return Array.isArray(result)?result:[result];},
  };
}
async function createIsolatedPostgres() {
  const port=Number(process.env.AUDIT_PG_PORT);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Indica un puerto local de pruebas entre 1024 y 65535.');
  const password=fs.readFileSync(process.env.AUDIT_PG_PASSWORD_FILE,'utf8').trim();
  const config={host:'127.0.0.1',port,user:'audit_admin',password};
  const admin=new Pool({...config,database:'postgres'});
  const database='transgest_audit_'+crypto.randomBytes(8).toString('hex');
  await admin.query(`CREATE DATABASE "${database}"`);
  const pool=new Pool({...config,database});
  const adapter=createAdapter(pool);
  adapter.transaction=async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(createAdapter(client));await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}};
  adapter.close=async()=>{await pool.end();await admin.end();};
  Object.assign(process.env,{DB_HOST:config.host,DB_PORT:String(port),DB_USER:config.user,DB_PASSWORD:password,DB_NAME:database,
    PG_DUMP_BIN:path.join(process.env.AUDIT_PG_BIN,'pg_dump.exe'),BACKUP_DIR:path.resolve(process.env.AUDIT_BACKUP_DIR || path.join(__dirname,'audit-backups'))});
  adapter.verifyBackup=async()=>{
    const service=require('../src/services/backup');
    const file=await service.runBackup();
    if(!file.endsWith('.dump'))throw Error('La prueba requiere pg_dump; no se acepta fallback JSON.');
    const backup=service.backupPath(file);
    const manifest=JSON.parse(fs.readFileSync(backup+'.manifest.json','utf8'));
    if(manifest.sha256!==crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex')||!manifest.migrations.length)throw Error('Manifiesto de copia inválido.');
    const target='transgest_restore_'+crypto.randomBytes(8).toString('hex');
    await admin.query(`CREATE DATABASE "${target}"`);
    await exec(path.join(process.env.AUDIT_PG_BIN,'pg_restore.exe'),['-h',config.host,'-p',String(port),'-U',config.user,'-d',target,'--no-password','--no-owner','--no-acl','--exit-on-error',backup],
      {env:{...process.env,PGPASSWORD:password},windowsHide:true,timeout:120000,maxBuffer:1024*1024});
    const restored=new Pool({...config,database:target});
    try {
      const tables=await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
      const fingerprints=async(client,name)=>client.query(`SELECT COUNT(*)::int AS n, md5(COALESCE(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "${name.replace(/"/g,'""')}" t`);
      let rows=0;
      for(const {table_name} of tables.rows){
        const [a,b]=await Promise.all([fingerprints(pool,table_name),fingerprints(restored,table_name)]);
        if(JSON.stringify(a.rows)!==JSON.stringify(b.rows))throw Error('Restauración distinta en tabla '+table_name);
        rows+=a.rows[0].n;
      }
      const proof={verified:true,tested_at:new Date().toISOString(),scope:'isolated-local-audit',backup:file,
        sha256:crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex'),tables:tables.rows.length,rows};
      fs.writeFileSync(path.join(path.dirname(backup),'restore-verification.json'),JSON.stringify(proof,null,2));
      return proof;
    }finally{await restored.end();}
  };
  return adapter;
}
module.exports={createIsolatedPostgres};
