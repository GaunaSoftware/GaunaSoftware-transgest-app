// Explicit maintenance command. Dry-run by default; no automatic startup writes.
const {encryptFiscalSecrets}=require('../src/services/fiscalSecrets');
const paths=[['verifactu','provider_api_key'],['verifactu','provider_webhook_secret'],['factura_b2b','api_key']];
async function migrateFiscalSecrets(db,{apply=false}={}) {
  if(apply && String(process.env.API_KEYS_ENCRYPTION_SECRET || '').length<32) {
    throw new Error('Configure API_KEYS_ENCRYPTION_SECRET (32+ characters) before applying. Preserve the existing encryption key.');
  }
  return db.transaction(async client=>{
    const {rows}=await client.query(`SELECT id,configuracion FROM empresas ORDER BY id ${apply?'FOR UPDATE':''}`);
    let candidates=0,updated=0;
    for(const row of rows) {
      const config=row.configuracion?.facturacion_fiscal;
      if(!config || !paths.some(([group,key])=>config[group]?.[key]&&!String(config[group][key]).startsWith('v1:'))) continue;
      candidates++;
      if(apply) {
        const encrypted=encryptFiscalSecrets(config);
        await client.query(`UPDATE empresas SET configuracion=jsonb_set(COALESCE(configuracion,'{}'::jsonb),'{facturacion_fiscal}',$1::jsonb) WHERE id=$2`,[JSON.stringify(encrypted),row.id]);
        updated++;
      }
    }
    return {mode:apply?'apply':'dry-run',companies:rows.length,candidates,updated};
  });
}
if(require.main===module) {
  require('dotenv').config();
  const db=require('../src/services/db');
  migrateFiscalSecrets(db,{apply:process.argv.includes('--apply')})
    .then(result=>console.log(JSON.stringify(result)))
    .catch(()=>{console.error('Fiscal encryption migration failed; transaction rolled back. Check schema and encryption key configuration.');process.exitCode=1;})
    .finally(()=>db.pool.end());
}
module.exports={migrateFiscalSecrets};
