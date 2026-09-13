const {normalizeClientImage}=require('./clientImage');
async function saveVehicleImage(db,{id,empresaId,image}) {
 const value=normalizeClientImage(image);
 const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 if(value===undefined)fail(400,'Indica una foto o elimina la existente.');
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(id||'')))fail(400,'Vehículo no válido.');
 const {rows}=await db.query('UPDATE vehiculos SET imagen_data=$1 WHERE id=$2 AND empresa_id=$3 RETURNING id,imagen_data',[value,id,empresaId]);
 if(!rows[0])fail(404,'Vehículo no encontrado.');
 return rows[0];
}
module.exports={saveVehicleImage};
