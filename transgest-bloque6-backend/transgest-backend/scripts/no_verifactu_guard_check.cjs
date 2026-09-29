const assert = require('node:assert/strict');
const fiscal = require('../src/services/fiscal');

async function main() {
  const config = fiscal.normalizeFiscalConfig({modo:'no_verifactu',nif_declarante:'B00000000'});
  assert.equal(config.modo,'no_verifactu','Unsupported mode must not silently become ninguno');
  const status = fiscal.buildFiscalStatus(config);
  assert.equal(status.ready,false);
  assert.ok(status.checks.some(check=>check.label.includes('NO VERI*FACTU')&&!check.ok));
  assert.ok(status.checks.some(check=>check.label==='Firma XAdES y certificado'&&!check.ok));
  assert.ok(status.checks.some(check=>check.label==='Registro de eventos y comprobación'&&!check.ok));
  assert.equal(status.checks.some(check=>check.label==='Endpoint real configurado'),false,'NO VERI*FACTU no tiene endpoint de envío instantáneo');
  const client = {query:async sql=>{
    assert.match(sql,/SELECT configuracion FROM empresas/);
    return {rows:[{configuracion:{facturacion_fiscal:config}}]};
  }};
  await assert.rejects(fiscal.ensureFacturaFiscalRecord({empresaId:'synthetic',facturaId:'synthetic',client}),
    {code:'NO_VERIFACTU_NOT_READY',status:409});
  console.log('PASS NO VERI*FACTU: mode remains explicit, health is incomplete, emission fails closed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
