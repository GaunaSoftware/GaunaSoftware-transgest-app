const {PGlite} = require('@electric-sql/pglite');
const {uuid_ossp} = require('@electric-sql/pglite/contrib/uuid_ossp');
const {pg_trgm} = require('@electric-sql/pglite/contrib/pg_trgm');
const fs = require('fs');
const assert = require('assert/strict');
(async()=>{
  const pg = new PGlite({extensions:{uuid_ossp,pg_trgm}});
  try {
    await pg.exec(fs.readFileSync(require('path').join(__dirname,'install_completo.sql'),'utf8'));
    await pg.exec(fs.readFileSync(require('path').join(__dirname,'install_completo.sql'),'utf8'));
    assert.equal((await pg.query('SELECT count(*)::int n FROM empresas')).rows[0].n,0);
    assert.equal((await pg.query('SELECT count(*)::int n FROM usuarios')).rows[0].n,0);
    assert.equal((await pg.query('SELECT count(*)::int n FROM planes')).rows[0].n,4);
    const {validateEnv} = require('../src/services/envValidator');
    Object.assign(process.env, {NODE_ENV:'production',LOCAL_DEPLOYMENT:'true',CORS_ORIGINS:'http://192.168.1.20:8088,transgest://app',APP_URL:'http://192.168.1.20:8088'});
    for(const key of ['JWT_SECRET','USER_JWT_SECRET','SUPERADMIN_JWT_SECRET','ACCOUNTING_SSO_JWT_SECRET','API_KEYS_ENCRYPTION_SECRET','DOC_CONTROL_SECRET','DB_PASSWORD']) process.env[key]=require('crypto').randomBytes(48).toString('hex');
    validateEnv();
    process.env.LOCAL_DEPLOYMENT='false';
    assert.throws(()=>validateEnv(),/HTTPS/);
    console.log('PASS: esquema de instalacion nuevo, sin cuentas demo. No sustituye la prueba Docker completa.');
  } finally { await pg.close(); }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
