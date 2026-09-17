// JSON access tolerates pre-Planner databases while migrations finish.
function plannerInvoiceSql(alias='f') {
 if(!/^[a-z][a-z0-9_]*$/i.test(alias))throw new Error('Invalid SQL alias');
 return `(NULLIF(to_jsonb(${alias})->>'planner_preparacion_id','') IS NOT NULL OR EXISTS(
 SELECT 1 FROM facturas original WHERE original.empresa_id=${alias}.empresa_id
 AND original.id::text=to_jsonb(${alias})->>'factura_original_id'
 AND NULLIF(to_jsonb(original)->>'planner_preparacion_id','') IS NOT NULL))`;
}
module.exports={plannerInvoiceSql};
