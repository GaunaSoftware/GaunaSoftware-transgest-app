const {fail}=require('./plannerInventory'),consent=require('./networkConsent'),supplier=require('./supplierInvoiceReview'),{validInvoiceSql}=require('./financialKpis');
const norm=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
async function connection(tx,c,id,lock=false){
 const x=(await tx.query(`SELECT x.*,e.cif emisor_cif,e.plan emisor_plan,e.estado emisor_estado,r.cif receptor_cif,r.estado receptor_estado,co.cif proveedor_cif,cli.cif cliente_cif FROM planner_conexiones_transporte x
 JOIN empresas e ON e.id=x.transportista_empresa_id JOIN empresas r ON r.id=x.empresa_id
 JOIN colaboradores co ON co.id=x.colaborador_id AND co.empresa_id=x.empresa_id
 JOIN clientes cli ON cli.id=x.cliente_id AND cli.empresa_id=x.transportista_empresa_id
 WHERE x.id::text=$1 AND (x.empresa_id=$2 OR x.transportista_empresa_id=$2) ${lock?'FOR UPDATE OF x':'FOR SHARE OF x'}`,[String(id),c])).rows[0];
 if(!x||!consent.allowed(x,'pedidos')||!['activo','activa'].includes(x.emisor_estado)||!['activo','activa'].includes(x.receptor_estado)||!['profesional','enterprise','pro','pro_intelligence','pro_planner'].includes(x.emisor_plan)||!norm(x.emisor_cif)||norm(x.emisor_cif)!==norm(x.proveedor_cif)||!norm(x.receptor_cif)||norm(x.receptor_cif)!==norm(x.cliente_cif))throw fail('Conexión activa e identidades fiscales verificadas no disponibles.',404);
 return x;
}
async function authorize(db,c,user,id,accept){return db.transaction(async tx=>{
 const x=await connection(tx,c,id,true),origin=x.empresa_id===c;
 if(typeof accept!=='boolean')throw fail('Confirma si autorizas el intercambio de facturas.');
 const field=origin?'facturas_origen_at':'facturas_destino_at';
 if(!accept)await tx.query("UPDATE planner_conexiones_transporte SET facturas_origen_at=NULL,facturas_destino_at=NULL,scopes=scopes-'facturas',consentimiento_version=consentimiento_version+1 WHERE id=$1",[id]);
 else {await tx.query(`UPDATE planner_conexiones_transporte SET ${field}=now(),consentimiento_version=consentimiento_version+1 WHERE id=$1`,[id]);await tx.query("UPDATE planner_conexiones_transporte SET scopes=CASE WHEN scopes ? 'facturas' THEN scopes ELSE scopes||'[\"facturas\"]'::jsonb END WHERE id=$1 AND facturas_origen_at IS NOT NULL AND facturas_destino_at IS NOT NULL",[id]);}
 await consent.event(tx,c,user,accept?'facturacion.autorizada':'facturacion.revocada',{link:id,data:{parte:origin?'cargador':'transportista'}});return {ok:true};
 });}
async function list(db,c,id){return db.transaction(async tx=>{
 const x=await connection(tx,c,id),scope=consent.allowed(x,'facturas');
 const rows=scope?(await tx.query(`SELECT n.id,n.factura_id,f.numero,f.fecha,f.base_imponible,f.total,n.recibida_id,n.created_at,r.estado revision,
 (SELECT count(*)::int FROM factura_proveedor_lineas l WHERE l.empresa_id=n.receptor_id AND l.factura_id=n.recibida_id AND l.conciliacion->>'estado' IN ('parcial','diferencia','no_encontrado')) diferencias,
 (SELECT count(*)::int FROM colaborador_facturas cf WHERE cf.empresa_id=n.receptor_id AND cf.factura_proveedor_id=n.recibida_id AND cf.estado='pagado') pagos_declarados
 FROM network_facturas n JOIN facturas f ON f.id=n.factura_id AND f.empresa_id=n.emisor_id JOIN facturas_proveedor r ON r.id=n.recibida_id AND r.empresa_id=n.receptor_id WHERE n.conexion_id=$1 ORDER BY n.created_at DESC LIMIT 100`,[id])).rows:[];
 const invoices=scope&&x.transportista_empresa_id===c?(await tx.query(`SELECT DISTINCT f.id,f.numero,f.fecha,f.base_imponible,f.total FROM facturas f JOIN factura_pedidos fp ON fp.factura_id=f.id JOIN planner_viajes_compartidos v ON v.viaje_id=fp.pedido_id AND v.transportista_empresa_id=f.empresa_id
 WHERE f.empresa_id=$1 AND f.cliente_id=$2 AND v.conexion_id=$3 AND ${validInvoiceSql('f')} AND NOT EXISTS(SELECT 1 FROM network_facturas n WHERE n.emisor_id=$1 AND n.factura_id=f.id AND n.receptor_id=$4) ORDER BY f.fecha DESC LIMIT 100`,[c,x.cliente_id,id,x.empresa_id])).rows:[];
 return {autorizado:scope,autorizado_por_mi:!!(x.empresa_id===c?x.facturas_origen_at:x.facturas_destino_at)||scope,emisor:x.transportista_empresa_id===c,proveedor_id:x.empresa_id===c?x.colaborador_id:undefined,facturas:rows,disponibles:invoices,limite:100,definicion:'Original enviado por el emisor, con revisión y conciliación del destinatario. Un pago declarado por el destinatario no acredita un cobro bancario del emisor.'};
 });}
async function send(db,c,user,id,input){return db.transaction(async tx=>{
 const x=await connection(tx,c,id);if(x.transportista_empresa_id!==c||!consent.allowed(x,'facturas'))throw fail('Intercambio de facturas no autorizado por ambas empresas.',403);
 if(input.confirmado!==true)throw fail('Confirma que adjuntas el PDF original de la factura emitida.');
 await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[c+':network-invoice:'+input.factura_id]);
 const prior=(await tx.query('SELECT * FROM network_facturas WHERE emisor_id=$1 AND factura_id::text=$2 AND receptor_id=$3',[c,String(input.factura_id),x.empresa_id])).rows[0];
 const file=supplier.document({...input,mime:'application/pdf'});
 if(prior){if(prior.sha256!==file.sha256)throw fail('Esta factura ya se compartió con otro original. Conserva el original y tramita la rectificación.',409);return {id:prior.id,repetida:true};}
 const f=(await tx.query(`SELECT f.* FROM facturas f WHERE f.empresa_id=$1 AND f.id::text=$2 AND f.cliente_id=$3 AND ${validInvoiceSql('f')} FOR SHARE`,[c,String(input.factura_id),x.cliente_id])).rows[0];if(!f)throw fail('Factura emitida a este destinatario no encontrada.',404);
 const rows=(await tx.query(`SELECT p.id,p.numero,v.pedido_id,v.conexion_id FROM factura_pedidos fp JOIN pedidos p ON p.id=fp.pedido_id AND p.empresa_id=$2 LEFT JOIN planner_viajes_compartidos v ON v.viaje_id=p.id AND v.transportista_empresa_id=p.empresa_id WHERE fp.factura_id=$1`,[f.id,c])).rows;
 if(!rows.length||rows.some(r=>r.conexion_id!==x.id))throw fail('La factura debe corresponder exclusivamente a encargos de esta conexión. Revisa sus asociaciones.',409);
 const scoped={query:(...a)=>tx.query(...a),transaction:fn=>fn(tx)};
 const received=await supplier.receive(scoped,x.empresa_id,null,x.colaborador_id,{...input,mime:'application/pdf'});
 if(received.repetida||received.estado!=='revision')throw fail('El destinatario ya tiene este documento. Concilia el registro existente antes de compartirlo de nuevo.',409);
 // These are candidates, never an automatic acceptance or payment. Multi-order
 // invoices retain an unassigned total until the recipient reviews their split.
 const data={numero:f.numero,fecha:f.fecha,vencimiento:f.fecha_vencimiento,proveedor_cif:x.emisor_cif,moneda:'EUR',base:Number(f.base_imponible),impuestos:Number(f.total)-Number(f.base_imponible),total:Number(f.total),nota_revision:'',lineas:[{descripcion:'Factura '+f.numero,referencia:rows.length===1?undefined:rows.map(r=>r.numero).join(', '),pedido_id:rows.length===1?rows[0].pedido_id:null,base:Number(f.base_imponible),impuestos:Number(f.total)-Number(f.base_imponible),parcial:rows.length!==1}]};
 await supplier.save(scoped,x.empresa_id,received.id,null,{version:received.version,datos:data},false);
 const result=(await tx.query('INSERT INTO network_facturas(conexion_id,emisor_id,receptor_id,factura_id,recibida_id,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[x.id,c,x.empresa_id,f.id,received.id,file.sha256,user])).rows[0];
 await consent.event(tx,c,user,'factura.compartida',{link:x.id,data:{factura_id:f.id,recibida_id:received.id,sha256:file.sha256}});return result;
 });}
module.exports={connection,authorize,list,send};
