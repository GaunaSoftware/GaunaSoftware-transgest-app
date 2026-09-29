const assert=require('node:assert/strict'),crypto=require('node:crypto');
module.exports=async function({base,fetch,db,managerToken,driverToken,company,password}) {
  assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/);
  let checks=0;
  async function call(path,token,status=200,body) {
    body=await require('./audit_company_login.cjs')(db,path,body);
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));checks++;return data;
  }
  const id=crypto.randomUUID(),other=crypto.randomUUID();
  await db.query("INSERT INTO empresas(id,nombre,cif,email_admin,plan,estado) VALUES($1,'CT aislado B','B00000009','ct-b@example.invalid','enterprise','activa')",[other]);
  await db.query(`INSERT INTO usuarios(id,empresa_id,nombre,email,password_hash,rol,activo)
    SELECT $1,$2,'Gerente B','ct-b@example.invalid',password_hash,'gerente',true FROM usuarios WHERE empresa_id=$3 AND email='audit@example.invalid'`,[crypto.randomUUID(),other,company]);
  const bToken=(await call('/auth/login',managerToken,200,{email:'ct-b@example.invalid',password})).token;
  assert.ok(bToken);
  await db.query(`INSERT INTO pedidos(id,empresa_id,cliente_id,numero,estado,fecha_carga,origen,destino)
    SELECT $1,$2,id,'QA-CONTROL-FLOW','en_curso',CURRENT_DATE,'A','B' FROM clientes WHERE empresa_id=$2 ORDER BY id LIMIT 1`,[id,company]);
  await db.query('INSERT INTO pedido_chofer_pasos(pedido_id,empresa_id,data) VALUES($1,$2,$3)',[id,company,JSON.stringify({carga_ok:true})]);
  const path='/informes/control-tower/flujo?estado=cargado';
  assert.ok((await call(path,managerToken)).items.some(row=>row.id===id));
  assert.equal((await call(path+'&empresa_id='+company,bToken)).items.length,0,'User parameters never select another tenant');
  await call(path,driverToken,403);
  const summary=await call('/informes/control-tower',managerToken);
  assert.ok(summary.flujo_operativo_v2.find(row=>row.key==='cargado').total>=1);
  assert.equal((await call('/informes/control-tower?empresa_id='+company,bToken)).flujo_alcance.total,0,'Cached aggregates stay tenant-scoped');
  await call('/informes/control-tower/flujo?estado=cargado&page=0',managerToken,400);
  return {checks,status:'passed',mode:'synthetic HTTP and production module/plan gates'};
};
