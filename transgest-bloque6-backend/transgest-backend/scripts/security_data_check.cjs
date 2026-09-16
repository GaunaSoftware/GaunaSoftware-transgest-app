const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {uuid_ossp}=require('@electric-sql/pglite/contrib/uuid_ossp');
const {pg_trgm}=require('@electric-sql/pglite/contrib/pg_trgm');
const db=require('../src/services/db');
const bcrypt=require('bcryptjs');
const {integrationSecret,redactSecrets,logRequestPath}=require('../src/services/integrationSecrets');
const {assertStrongPassword,assertPasswordNotReused,rememberPasswordHash}=require('../src/services/passwordPolicy');

async function main() {
  const pg=new PGlite({extensions:{uuid_ossp,pg_trgm}});
  const originalQuery=db.query,originalTransaction=db.transaction;
  const adapt=client=>({query:async(sql,params)=>{const result=await client.query(sql,params);return {...result,rowCount:result.affectedRows??result.rows.length};}});
  db.query=adapt(pg).query;db.transaction=callback=>pg.transaction(tx=>callback(adapt(tx)));
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname,'install_completo.sql'),'utf8'));
    const migration=fs.readFileSync(path.join(__dirname,'migrations/016_security_tables.sql'),'utf8');
    await pg.exec(migration);await pg.exec(migration);
    const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
    const clientA='33333333-3333-4333-8333-333333333333',clientB='44444444-4444-4444-8444-444444444444';
    await pg.query("INSERT INTO empresas(id,nombre,cif,email_admin) VALUES($1,'A','A-test','a@example.test'),($2,'B','B-test','b@example.test')",[A,B]);
    await pg.query("INSERT INTO clientes(id,empresa_id,nombre,cif) VALUES($1,$2,'Cliente A','CA'),($3,$4,'Cliente B','CB')",[clientA,A,clientB,B]);
    await pg.exec('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS mercancia_habitual TEXT; ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email_facturacion TEXT; ALTER TABLE clientes ADD COLUMN IF NOT EXISTS emails_albaranes TEXT; ALTER TABLE clientes ADD COLUMN IF NOT EXISTS iva_regimen TEXT; ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS imagen_data TEXT');
    const invoke=async(routerFile,method,routePath,empresa,id,body={},extra={})=>{
      const router=require('../src/routes/'+routerFile);
      const handler=router.stack.find(layer=>layer.route?.path===routePath&&layer.route.methods[method]).route.stack.at(-1).handle;
      const res={code:200,status(code){this.code=code;return this;},json(data){this.data=data;return this;},send(data){this.data=data;return this;},setHeader(){}};
      await handler({params:{id,pedido_id:id,doc_id:id},query:{},body,empresaId:empresa,user:{empresa_id:empresa,cliente_id:empresa===A?clientA:clientB,rol:'gerente'},...extra},res);
      return res;
    };
    assert.equal((await invoke('clientes','get','/:id',A,clientA)).data.nombre,'Cliente A');
    assert.equal((await invoke('clientes','get','/:id',A,clientB)).code,404);
    assert.equal((await invoke('clientes','patch','/:id/mercancia-habitual',A,clientA,{mercancia_habitual:'Allowed'})).code,200);
    assert.equal((await invoke('clientes','patch','/:id/mercancia-habitual',A,clientB,{mercancia_habitual:'CHANGED'})).code,404);
    assert.equal((await invoke('clientes','get','/:id',B,clientB)).data.nombre,'Cliente B');
    await invoke('clientes','delete','/:id',A,clientB);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM clientes WHERE id=$1',[clientB])).rows[0].n,1);
    const vehicleB='66666666-6666-4666-8666-666666666666',driverB='77777777-7777-4777-8777-777777777777';
    const orderB='88888888-8888-4888-8888-888888888888',invoiceB='99999999-9999-4999-8999-999999999999';
    await pg.query("INSERT INTO vehiculos(id,empresa_id,matricula) VALUES($1,$2,'B-1234');",[vehicleB,B]);
    await pg.query("INSERT INTO choferes(id,empresa_id,nombre) VALUES($1,$2,'Driver B')",[driverB,B]);
    await pg.query("INSERT INTO pedidos(id,empresa_id,cliente_id,numero) VALUES($1,$2,$3,'B-order')",[orderB,B,clientB]);
    await pg.query("INSERT INTO facturas(id,empresa_id,cliente_id,numero) VALUES($1,$2,$3,'B-invoice')",[invoiceB,B,clientB]);
    for(const [module,id] of [['vehiculos',vehicleB],['choferes',driverB],['pedidos',orderB],['facturas',invoiceB]]) {
      const result=await invoke(module,'get','/:id',A,id);
      assert.equal(result.code,404,`${module}: ${JSON.stringify(result.data)}`);
    }
    assert.equal((await invoke('vehiculos','put','/:id/imagen',A,vehicleB,{imagen_data:null})).code,404);
    assert.equal((await invoke('vehiculos','put','/:id/imagen',B,vehicleB,{imagen_data:null})).code,200);
    assert.equal((await invoke('cliente_portal','get','/facturas/:id',A,invoiceB)).code,404);
    assert.equal((await invoke('facturas','post','/',A,null,{cliente_id:clientA,serie:'A',lineas:[{descripcion:'Test',cantidad:1,precio:1}],pedidos_ids:[orderB]})).code,400);
    assert.equal((await invoke('facturas','delete','/:id',A,invoiceB)).code,404);
    await pg.exec(`CREATE TABLE contabilidad_export_lotes(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id UUID,creado_por UUID,created_at TIMESTAMPTZ DEFAULT NOW())`);
    const exportB=(await pg.query('INSERT INTO contabilidad_export_lotes(empresa_id) VALUES($1) RETURNING id',[B])).rows[0].id;
    assert.deepEqual((await invoke('facturas','get','/export/contabilidad/lotes',A)).data,[]);
    assert.equal((await invoke('facturas','get','/export/contabilidad/lotes',B)).data[0].id,exportB);
    assert.equal((await invoke('facturas','delete','/export/contabilidad/lotes/:id',A,exportB)).code,404);

    // ClaveiCon/Accounting SSO derives tenant from the authenticated context,
    // ignoring a conflicting company supplied by the caller.
    process.env.ACCOUNTING_SSO_JWT_SECRET='isolated-accounting-sso-secret-for-test';
    const sso=await invoke('accounting_sso','post','/launch-token',A,null,{empresa_id:B});
    const jwt=require('jsonwebtoken');
    assert.equal(jwt.verify(sso.data.sso_token,process.env.ACCOUNTING_SSO_JWT_SECRET).tenant_id,A);

    await pg.exec(`CREATE TABLE IF NOT EXISTS pedido_docs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id UUID,pedido_id UUID,nombre TEXT,tipo TEXT,file_mime TEXT,file_size_kb INTEGER,file_base64 TEXT,notas TEXT,visible_chofer BOOLEAN DEFAULT false,created_at TIMESTAMPTZ DEFAULT NOW())`);
    const doc=(await pg.query("INSERT INTO pedido_docs(empresa_id,pedido_id,nombre,file_base64,file_mime) VALUES($1,$2,'B-doc','cHJpdmF0ZQ==','text/plain') RETURNING id",[B,orderB])).rows[0];
    assert.equal((await invoke('datos_empresa','get','/pedido-docs/doc/:doc_id/archivo',A,doc.id)).code,404);
    assert.equal((await invoke('datos_empresa','get','/pedido-docs/doc/:doc_id/archivo',B,doc.id)).data.toString(),'private');
    assert.deepEqual((await invoke('datos_empresa','get','/pedido-docs/:pedido_id/base64',A,orderB)).data,[]);

    // Fiscal secrets use the actual configuration SQL, not a mocked repository.
    process.env.API_KEYS_ENCRYPTION_SECRET='isolated-test-key-'.repeat(4);
    const fiscal=require('../src/services/fiscal');
    const {sanitizeNestedFiscal}=require('../src/services/fiscalSecrets');
    const config={modo:'verifactu',verifactu:{proveedor:'verifacti',provider_api_key:'private-api-test',provider_webhook_secret:'private-webhook-test'}};
    await fiscal.saveEmpresaFiscalConfig(B,config,db);
    const stored=(await pg.query('SELECT configuracion FROM empresas WHERE id=$1',[B])).rows[0].configuracion;
    assert.ok(stored.facturacion_fiscal.verifactu.provider_api_key.startsWith('v1:'));
    assert.ok(!JSON.stringify(stored).includes('private-api-test'));
    assert.equal((await fiscal.getEmpresaFiscalConfig(B,db)).verifactu.provider_api_key,'private-api-test');
    assert.equal((await fiscal.getEmpresaFiscalConfig(A,db)).verifactu.provider_api_key,'');
    const publicConfig=fiscal.sanitizeFiscalConfigForClient(await fiscal.getEmpresaFiscalConfig(B,db));
    assert.equal(publicConfig.verifactu.provider_api_key,undefined);
    assert.equal(sanitizeNestedFiscal([{configuracion:stored}])[0].configuracion.facturacion_fiscal.verifactu.provider_api_key,undefined);
    await fiscal.saveEmpresaFiscalConfig(B,{modo:'verifactu',verifactu:{proveedor:'verifacti'}},db);
    assert.equal((await fiscal.getEmpresaFiscalConfig(B,db)).verifactu.provider_webhook_secret,'private-webhook-test');
    await pg.query("UPDATE empresas SET configuracion=$1 WHERE id=$2",[JSON.stringify({unrelated:'preserve',facturacion_fiscal:config}),A]);
    const {migrateFiscalSecrets}=require('./encrypt_fiscal_secrets.cjs');
    assert.equal((await migrateFiscalSecrets(db)).candidates,1);
    assert.equal((await migrateFiscalSecrets(db,{apply:true})).updated,1);
    assert.equal((await migrateFiscalSecrets(db,{apply:true})).updated,0);
    assert.equal((await fiscal.getEmpresaFiscalConfig(A,db)).verifactu.provider_api_key,'private-api-test');
    assert.equal((await pg.query('SELECT configuracion FROM empresas WHERE id=$1',[A])).rows[0].configuracion.unrelated,'preserve');

    const webhooks=require('../src/services/webhooks');await webhooks.ensureSchema();
    const hook=(await pg.query("INSERT INTO empresa_webhooks(empresa_id,url,secret_encrypted) VALUES($1,'https://example.com','ciphertext') RETURNING id",[B])).rows[0];
    assert.equal((await webhooks.listWebhooks(A)).length,0);
    assert.equal(await webhooks.revokeWebhook(A,hook.id),null);
    assert.equal((await webhooks.listWebhooks(B))[0].activo,true);
    assert.equal((await webhooks.listWebhooks(B))[0].secret_encrypted,undefined);
    assert.equal((await webhooks.revokeWebhook(B,hook.id)).id,hook.id);

    const apiKeys=require('../src/services/apiKeys');
    await apiKeys.setCompanyApiConfig(B,'here',{api_key:'company-B-only-key-for-test',use_global:false});
    assert.equal(await apiKeys.getCompanyApiConfig(A,'here'),null);
    assert.equal(apiKeys.decryptSecret((await apiKeys.getCompanyApiConfig(B,'here')).encrypted_key),'company-B-only-key-for-test');
    await apiKeys.setCompanyApiConfig(A,'here',{api_key:'company-A-only-key-for-test',use_global:false});
    assert.equal(apiKeys.decryptSecret((await apiKeys.getCompanyApiConfig(B,'here')).encrypted_key),'company-B-only-key-for-test');

    // The webhook executes real SQL with an A token and B's existing plate.
    await pg.exec(`ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_provider VARCHAR(40);
      ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_external_id VARCHAR(120);
      ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_lat NUMERIC(10,7);
      ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS gps_lng NUMERIC(10,7);
      ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS ubicacion_actual VARCHAR(255);
      ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS ubicacion_fuente VARCHAR(40);
      ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS ubicacion_ts TIMESTAMPTZ;
      ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
      CREATE TABLE gps_position_log(id UUID DEFAULT gen_random_uuid(),empresa_id UUID,vehiculo_id UUID,provider TEXT,external_id TEXT,lat NUMERIC,lng NUMERIC,ubicacion TEXT,velocidad_kmh NUMERIC,odometro_km NUMERIC,raw JSONB,recorded_at TIMESTAMPTZ)`);
    const hashToken=require('node:crypto').createHash('sha256').update('gps-A-secret').digest('hex');
    await pg.query("INSERT INTO gps_webhook_tokens(empresa_id,provider,token_hash) VALUES($1,'gps_generic',$2)",[A,hashToken]);
    const gpsHeaders={headers:{'x-transgest-gps-token':'gps-A-secret'},params:{empresaId:A,provider:'gps_generic'}};
    const foreignPosition=await invoke('gps_webhook','post','/webhook/:empresaId/:provider',A,null,{matricula:'B-1234',lat:40,lng:-3},gpsHeaders);
    assert.equal(foreignPosition.code,200,JSON.stringify(foreignPosition.data));
    assert.equal(foreignPosition.data.updated,0);
    assert.equal((await pg.query('SELECT gps_lat FROM vehiculos WHERE id=$1',[vehicleB])).rows[0].gps_lat,null);
    assert.equal((await invoke('gps_webhook','post','/webhook/:empresaId/:provider',B,null,{matricula:'B-1234',lat:40,lng:-3},{...gpsHeaders,params:{empresaId:B,provider:'gps_generic'}})).code,401);
    await pg.query("INSERT INTO vehiculos(empresa_id,matricula) VALUES($1,'A-1234')",[A]);
    const ownPosition=await invoke('gps_webhook','post','/webhook/:empresaId/:provider',A,null,{matricula:'A-1234',lat:40,lng:-3},gpsHeaders);
    assert.equal(ownPosition.data.updated,1,JSON.stringify(ownPosition.data));
    assert.equal((await pg.query('SELECT empresa_id FROM gps_position_log')).rows[0].empresa_id,A);

    await pg.exec(`CREATE TABLE factura_envios_fiscales(id UUID DEFAULT gen_random_uuid(),empresa_id UUID,sistema TEXT,response JSONB,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pg.query("INSERT INTO factura_envios_fiscales(empresa_id,sistema,response) VALUES($1,'verifactu',$2)",[B,JSON.stringify({provider_uuid:'existing-B-provider-uuid'})]);
    const fiscalQueue=require('../src/services/fiscalQueueState');
    assert.equal(await fiscalQueue.findLatestQueueItemByProviderUuid(db,A,'verifactu','existing-B-provider-uuid'),null);
    assert.equal((await fiscalQueue.findLatestQueueItemByProviderUuid(db,B,'verifactu','existing-B-provider-uuid')).empresa_id,B);

    const uid='55555555-5555-4555-8555-555555555555';
    const oldHash=await bcrypt.hash('Legacy123',4);
    await pg.query("INSERT INTO usuarios(id,empresa_id,nombre,email,password_hash,rol) VALUES($1,$2,'User','user@example.test',$3,'gerente')",[uid,A,oldHash]);
    assert.equal(await bcrypt.compare('Legacy123',oldHash),true);
    for(const value of ['short','abcdefgh123456','ABCDEF1234567','Abcdefghijkl','a'.repeat(73),null]) assert.throws(()=>assertStrongPassword(value),{code:'PASSWORD_POLICY'});
    assertStrongPassword('NewStrongPassword123!');
    await rememberPasswordHash({usuarioId:uid,empresaId:A,passwordHash:oldHash,queryClient:db});
    await assert.rejects(assertPasswordNotReused({usuarioId:uid,empresaId:A,passwordNuevo:'Legacy123',queryClient:db}),{status:400});
    await assertPasswordNotReused({usuarioId:uid,empresaId:A,passwordNuevo:'NewStrongPassword123!',queryClient:db});

    // Full HTTP middleware chain, current SQL role vs stale privileged JWT.
    process.env.SUPERADMIN_JWT_SECRET='isolated-superadmin-signing-secret-for-test';
    await pg.exec("ALTER TABLE superadmins ADD COLUMN IF NOT EXISTS rol VARCHAR(40) DEFAULT 'superadmin'; ALTER TABLE superadmins ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true");
    const adminId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await pg.query("INSERT INTO superadmins(id,nombre,email,password_hash,rol,activo) VALUES($1,'Test admin','admin@example.test',$2,'soporte',true)",[adminId,oldHash]);
    const token=jwt.sign({id:adminId,superadmin:true,rol:'superadmin'},process.env.SUPERADMIN_JWT_SECRET,{expiresIn:'5m'});
    const express=require('express');const app=express();app.use(express.json());app.use('/admin',require('../src/routes/superadmin'));
    const server=await new Promise(resolve=>{const running=app.listen(0,'127.0.0.1',()=>resolve(running));});
    try {
      const endpoint=`http://127.0.0.1:${server.address().port}/admin/usuarios-admin`;
      const options={headers:{authorization:`Bearer ${token}`}};
      assert.equal((await fetch(endpoint,options)).status,403);
      await pg.query("UPDATE superadmins SET rol='unknown' WHERE id=$1",[adminId]);
      assert.equal((await fetch(endpoint,options)).status,403);
      await pg.query("UPDATE superadmins SET rol='superadmin',activo=false WHERE id=$1",[adminId]);
      assert.equal((await fetch(endpoint,options)).status,401);
      await pg.query("UPDATE superadmins SET activo=true WHERE id=$1",[adminId]);
      const weak=await fetch(endpoint,{method:'POST',headers:{...options.headers,'content-type':'application/json'},body:JSON.stringify({nombre:'New',email:'new@example.test',password:'weak'})});
      assert.equal(weak.status,400);
      assert.match((await weak.json()).error,/12 caracteres/);
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

    assert.equal(integrationSecret({headers:{authorization:'Bearer header'},query:{token:'query'}},['x-token'],'token'),'header');
    assert.equal(integrationSecret({headers:{authorization:'invalid'},query:{token:'query'}},['x-token'],'token'),'');
    assert.equal(integrationSecret({headers:{},query:{token:'legacy'}},['x-token'],'token'),'legacy');
    process.env.ALLOW_LEGACY_INTEGRATION_QUERY_SECRETS='false';
    assert.equal(integrationSecret({headers:{},query:{token:'legacy'}},['x-token'],'token'),'');
    delete process.env.ALLOW_LEGACY_INTEGRATION_QUERY_SECRETS;
    const safe=redactSecrets({password:'private',nested:{provider_api_key:'private'},message:'https://host/x?secret=private&x=1 Bearer private'});
    assert.ok(!JSON.stringify(safe).includes('private'));
    assert.equal(logRequestPath({originalUrl:'/gps/webhook/company/provider?token=private'}),'/gps/webhook/company/provider');
    console.log('PASS real isolated SQL: A/B core entities, documents, exports, GPS, keys, SSO, fiscal encryption/migration/UUID ownership, webhooks, password history; full HTTP SuperAdmin current-role/deactivation/password checks; header precedence and redaction.');
  } finally {db.query=originalQuery;db.transaction=originalTransaction;await pg.close();await db.pool.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
