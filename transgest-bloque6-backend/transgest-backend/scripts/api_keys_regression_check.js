const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const db = require('../src/services/db');
const keys = require('../src/services/apiKeys');
async function main() {
  const pg = new PGlite();
  const original = {query:db.query,transaction:db.transaction};
  const savedEnv = process.env.OPENAI_API_KEY;
  const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
  db.query=(sql,params)=>pg.query(sql,params);
  db.transaction=fn=>pg.transaction(tx=>fn({query:(sql,params)=>tx.query(sql,params)}));
  try {
    await pg.exec(`CREATE TABLE empresas(id UUID PRIMARY KEY); INSERT INTO empresas VALUES ('${a}'),('${b}');`);
    await keys.setGlobalApiKey(' OPENAI ','qa-fake-global-credential');
    await keys.setGlobalApiKey('openai','qa-fake-global-updated');
    assert.equal((await keys.resolveApiKey(a,'openai')).key,'qa-fake-global-updated');
    await keys.setCompanyApiConfig(a,' OPENAI ',{api_key:'qa-fake-company-credential',use_global:false,limite_mensual:25});
    await keys.setCompanyApiConfig(a,'openai',{limite_mensual:40});
    assert.equal((await keys.resolveApiKey(a,'openai')).key,'qa-fake-company-credential');
    assert.equal((await keys.resolveApiKey(b,'openai')).key,'qa-fake-global-updated');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM empresa_api_configs')).rows[0].n,1);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM system_config WHERE key='openai_api_key'")).rows[0].n,1);
    const encrypted=(await keys.getCompanyApiConfig(a,'openai')).encrypted_key;
    assert.ok(encrypted.startsWith('v1:'));
    assert.ok(!encrypted.includes('qa-fake-company'));
    assert.ok(!JSON.stringify(await keys.publicStatusForProvider('openai',a)).includes('qa-fake-company-credential'));
    await keys.setCompanyApiConfig(a,'openai',{use_global:true});
    assert.equal((await keys.resolveApiKey(a,'openai')).key,'qa-fake-global-updated');
    assert.equal((await keys.getCompanyApiConfig(a,'openai')).encrypted_key,encrypted);
    await keys.setCompanyApiConfig(a,'openai',{use_global:false,api_key:''});
    assert.equal((await keys.resolveApiKey(a,'openai')).source,'company');
    await keys.setCompanyApiConfig(a,'openai',{activo:false});
    assert.equal((await keys.resolveApiKey(a,'openai')).source,'disabled');
    await assert.rejects(keys.setCompanyApiConfig(a,'openai',{api_key:'qa...masked'}),{status:400});
    await assert.rejects(keys.setCompanyApiConfig(a,'openai',{use_global:'false'}),{status:400});
    await assert.rejects(keys.setCompanyApiConfig(a,'openai',{limite_mensual:-1}),{status:400});
    await keys.setCompanyApiConfig(a,'openai',{clear_key:true,activo:true});
    assert.equal((await keys.getCompanyApiConfig(a,'openai')).encrypted_key,null);
    await keys.deleteGlobalApiKey('openai');
    process.env.OPENAI_API_KEY='qa-fake-env-after-restart';
    assert.equal((await keys.resolveApiKey(a,'openai')).key,'');
    await keys.setCompanyApiConfig(a,'locatel',{api_key:'qa-fake-gps-one',use_global:false});
    await keys.setCompanyApiConfig(a,'movildata',{api_key:'qa-fake-gps-two',use_global:false});
    assert.equal((await keys.getCompanyApiConfig(a,'locatel')).activo,false);
    assert.equal((await keys.getCompanyApiConfig(a,'movildata')).activo,true);
    console.log('OK claves: cifrado, aislamiento, upsert sin duplicados, modo explicito, borrado persistente y GPS unico.');
  } finally {
    Object.assign(db,original);
    if(savedEnv===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=savedEnv;
    await pg.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
