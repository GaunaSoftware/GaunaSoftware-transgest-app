function allocateCosts(lines,total,method='peso') {
 if(!['peso','unidades','venta'].includes(method))throw Object.assign(new Error('Criterio de reparto no válido.'),{status:400});
 if(!Number.isFinite(total)||total<0)throw Object.assign(new Error('Coste operativo no válido.'),{status:400});
 if(!Array.isArray(lines)||lines.some(l=>!Number.isFinite(Number(l.cantidad))||Number(l.cantidad)<=0||!Number.isFinite(Number(l.peso_kg||0))||Number(l.peso_kg||0)<0))throw Object.assign(new Error('Cantidades o pesos no válidos para repartir el coste.'),{status:400});
 let basis=lines.map(l=>method==='peso'?Number(l.cantidad)*Number(l.peso_kg||0):method==='venta'?Number(l.cantidad)*Number(l.precio_venta)*(1-Number(l.descuento_pct||0)/100):Number(l.cantidad));
 let used=method;
 if(!basis.some(v=>v>0)){used='unidades';basis=lines.map(l=>Number(l.cantidad));}
 const sum=basis.reduce((a,b)=>a+b,0), cents=Math.round(total*100);
 if(!sum&&cents)throw Object.assign(new Error('No hay mercancía para repartir el coste.'),{status:409});
 const shares=basis.map(v=>sum?cents*v/sum:0),allocated=shares.map(Math.floor);
 let remainder=cents-allocated.reduce((a,b)=>a+b,0);
 const rank=shares.map((v,i)=>({i,f:v-allocated[i]})).sort((a,b)=>b.f-a.f||a.i-b.i);
 for(let j=0;j<remainder;j++)allocated[rank[j%rank.length].i]++;
 return {criterio_solicitado:method,criterio:used,total:cents/100,lineas:lines.map((l,i)=>({linea_id:l.id,referencia:l.referencia,cantidad:Number(l.cantidad),base:basis[i],coste_producto:Number(l.coste_unitario)*Number(l.cantidad),coste_operativo:allocated[i]/100,coste_unitario_operativo:Number(l.cantidad)>0?allocated[i]/100/Number(l.cantidad):0}))};
}
async function snapshotCosts(tx,company,user,prep,method='peso'){
 const order=(await tx.query('SELECT precio_colaborador,coste_gasoil,coste_peajes,coste_dietas,coste_otros FROM pedidos WHERE id=$1 AND empresa_id=$2',[prep.pedido_id,company])).rows[0];
 const lines=(await tx.query('SELECT * FROM planner_preparacion_lineas WHERE preparacion_id=$1 AND empresa_id=$2 ORDER BY id',[prep.id,company])).rows;
 const components=Object.fromEntries(Object.entries(order||{}).map(([k,v])=>[k,Number(v||0)]));
 const data={...allocateCosts(lines,Object.values(components).reduce((a,b)=>a+b,0),method),componentes:components,registrado_at:new Date().toISOString()};
 await tx.query('UPDATE planner_preparaciones SET reparto_coste=$3 WHERE id=$1 AND empresa_id=$2',[prep.id,company,JSON.stringify(data)]);
 await tx.query("INSERT INTO planner_eventos(empresa_id,pedido_id,preparacion_id,tipo,datos,created_by) VALUES($1,$2,$3,'coste.repartido',$4,$5)",[company,prep.pedido_id,prep.id,JSON.stringify(data),user]);
 return data;
}
module.exports={allocateCosts,snapshotCosts};
