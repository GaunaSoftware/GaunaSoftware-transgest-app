const assert = require('node:assert/strict');
const { pointIdentity } = require('../src/services/pointIdentity');
const { fallbackPlaceForAddress } = require('../src/services/geoFallback');
const { candidateCompatibleWithLocal, countryHintFromRaw } = require('../src/routes/geocoding')._test;
const db = require('../src/services/db');
const notifications = require('../src/services/notificaciones');

async function main() {
  const point = {direccion:'Calle Málaga 1',ciudad:'San Vicente del Raspeig',provincia:'Alicante',pais:'España'};
  assert.equal(pointIdentity(point),pointIdentity({...point,direccion:' CALLE MALAGA   1 ',pais:'Espana'}));
  assert.notEqual(pointIdentity(point),pointIdentity({...point,ciudad:'Benissa'}));
  assert.notEqual(pointIdentity(point),pointIdentity({...point,direccion:'Calle Malaga 2'}));
  const local=fallbackPlaceForAddress('Calle Malaga 1, San Vicente del Raspeig, Alicante, Espana');
  assert.equal(local.municipio,'San Vicente del Raspeig');
  assert.equal(fallbackPlaceForAddress('Benissa').provincia,'Alicante');
  assert.equal(candidateCompatibleWithLocal({municipio:'Malaga',provincia:'Malaga',pais:'Espana'},local),false);
  assert.equal(candidateCompatibleWithLocal({municipio:'Benissa',provincia:'Alicante',pais:'Espana'},local),false);
  assert.equal(candidateCompatibleWithLocal({municipio:'San Vicente del Raspeig',provincia:'Alicante',pais:'Espana'},local),true);
  assert.equal(candidateCompatibleWithLocal({municipio:'Jerez',pais:'United States',country_code:'us'},fallbackPlaceForAddress('Jerez')),false);
  assert.equal(countryHintFromRaw('Lyon','','',{}),'Francia');
  assert.equal(countryHintFromRaw('Paris','Portugal','',{}),'Portugal');
  const queries=[];
  const original=db.query;
  try {
    db.query=async(sql,params)=>{queries.push({sql,params});return {rows:[]};};
    await notifications.listarNotificaciones('empresa','cliente',{audience:'cliente'});
    const reads=queries.filter(q=>/SELECT.*id, tipo|SELECT COUNT/s.test(q.sql));
    assert.equal(reads.length,2);
    for (const read of reads) {
      assert.ok(read.sql.includes("data->>'audiencia'"));
      assert.ok(read.params.includes('cliente'));
      assert.equal(read.params[0],'empresa');
    }
  } finally { db.query=original; }
  console.log('OK operativa: direcciones, duplicados por ubicacion y avisos privados del cliente');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
