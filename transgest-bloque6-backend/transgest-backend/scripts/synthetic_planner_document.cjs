// Local regression fixture only; never used by application modules.
module.exports=async(db,company,order,user)=>{
 const p=(await db.query('SELECT peso_kg FROM pedidos WHERE id=$1 AND empresa_id=$2',[order,company])).rows[0];
 const documento={referencia_pedido:'SINTÉTICO',fecha_transporte:'2026-09-26',cargador_contractual:{nombre:'Cargador sintético',nif:'QA',domicilio:'Dirección de prueba'},transportista_efectivo:{nombre:'Transportista sintético',nif:'QA'},origen:{direccion:'Origen sintético'},destino:{direccion:'Destino sintético',destinatario:'Destinatario sintético'},mercancia:{descripcion:'Mercancía de ensayo',peso_kg:Number(p.peso_kg)||1},vehiculo:{tractora:'QA-0000'},observaciones_publicas:'Ensayo sintético sin validez comercial'};
 return require('../src/services/transportDocumentVersions').issue(db,{empresaId:company,pedidoId:order,actorId:user,payload:{documento},baseUrl:'https://example.invalid',reason:'Prueba sintética de expedición'});
};
