const crypto=require('crypto');
const {encryptSecret,decryptSecret}=require('./apiKeys');
const UUID=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fail=(message,status=422)=>{throw Object.assign(Error(message),{status});};
function configured(env=process.env){return env.MOBILE_PUSH_ENABLED==='true'&&/^[a-z][a-z0-9-]{4,62}$/.test(env.MOBILE_PUSH_PROJECT_ID||'')&&!!(env.GOOGLE_APPLICATION_CREDENTIALS||env.FCM_SERVICE_ACCOUNT_JSON);}
async function register(db,company,user,token){
 if(typeof token!=='string'||token.length<40||token.length>4096||/\s/.test(token))fail('Token de dispositivo no válido');
 const hash=crypto.createHash('sha256').update(token).digest('hex');
 const actor=(await db.query('SELECT id FROM usuarios WHERE id=$1 AND empresa_id=$2 AND activo IS DISTINCT FROM false',[user,company])).rows[0];
 if(!actor)fail('Usuario no disponible',403);
 const result=await db.query(`INSERT INTO mobile_push_devices(empresa_id,usuario_id,token_hash,encrypted_token) VALUES($1,$2,$3,$4)
  ON CONFLICT(token_hash) DO UPDATE SET empresa_id=EXCLUDED.empresa_id,usuario_id=EXCLUDED.usuario_id,encrypted_token=EXCLUDED.encrypted_token,enabled=true,registered_at=CASE WHEN mobile_push_devices.empresa_id<>EXCLUDED.empresa_id OR mobile_push_devices.usuario_id<>EXCLUDED.usuario_id OR NOT mobile_push_devices.enabled THEN NOW() ELSE mobile_push_devices.registered_at END,updated_at=NOW() RETURNING id`,[company,user,hash,encryptSecret(token)]);
 return {id:result.rows[0].id,enabled:true};
}
async function unregister(db,company,user,id){
 if(!UUID.test(id||''))fail('Dispositivo no válido');
 await db.query('UPDATE mobile_push_devices SET enabled=false,updated_at=NOW() WHERE id=$1 AND empresa_id=$2 AND usuario_id=$3',[id,company,user]);return {ok:true};
}
let auth;
async function sendFcm(token,notificationId){
 if(!configured())fail('Notificaciones push sin configurar',503);
 if(!auth){const {GoogleAuth}=require('google-auth-library');auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/firebase.messaging'],...(process.env.FCM_SERVICE_ACCOUNT_JSON?{credentials:JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON)}:{})});}
 const client=await auth.getClient();
 const result=await client.request({url:`https://fcm.googleapis.com/v1/projects/${process.env.MOBILE_PUSH_PROJECT_ID}/messages:send`,method:'POST',timeout:10000,retry:false,data:{message:{token,
  notification:{title:'TransGest',body:'Tienes un nuevo aviso. Abre la app para consultar los detalles.'},
  data:{notification_id:notificationId},android:{priority:'NORMAL',ttl:'3600s',notification:{tag:notificationId,channel_id:'transgest_alerts'}}}}});
 return result.data.name;
}
async function processPending(db,send=sendFcm){
 // An interrupted delivery is uncertain, not safe to send again automatically.
 await db.query("UPDATE mobile_push_deliveries SET status='unknown',error_code='INTERRUPTED' WHERE status='processing' AND updated_at<NOW()-INTERVAL '5 minutes'");
 const candidates=(await db.query(`SELECT n.id AS notification_id,d.id AS device_id FROM notificaciones_internas n
  JOIN mobile_push_devices d ON d.empresa_id=n.empresa_id AND d.usuario_id=n.usuario_id AND d.enabled
  JOIN usuarios u ON u.id=d.usuario_id AND u.empresa_id=d.empresa_id AND u.activo IS DISTINCT FROM false
  LEFT JOIN mobile_push_deliveries r ON r.notification_id=n.id AND r.device_id=d.id
  WHERE n.leida=false AND n.created_at>=d.registered_at AND n.created_at>=NOW()-INTERVAL '24 hours'
    AND (r.notification_id IS NULL OR (r.status='retry' AND r.next_attempt_at<=NOW() AND r.attempts<5))
  ORDER BY n.created_at LIMIT 20`)).rows;
 let sent=0;
 for(const item of candidates){
  const claimed=(await db.query(`INSERT INTO mobile_push_deliveries(notification_id,device_id,status,attempts) VALUES($1,$2,'processing',1)
   ON CONFLICT(notification_id,device_id) DO UPDATE SET status='processing',attempts=mobile_push_deliveries.attempts+1,updated_at=NOW()
   WHERE mobile_push_deliveries.status='retry' AND mobile_push_deliveries.next_attempt_at<=NOW() AND mobile_push_deliveries.attempts<5 RETURNING attempts`,[item.notification_id,item.device_id])).rows[0];
  if(!claimed)continue;
  const device=(await db.query(`SELECT d.encrypted_token FROM mobile_push_devices d JOIN notificaciones_internas n ON n.empresa_id=d.empresa_id AND n.usuario_id=d.usuario_id
    JOIN usuarios u ON u.id=d.usuario_id AND u.empresa_id=d.empresa_id AND u.activo IS DISTINCT FROM false
    WHERE d.id=$1 AND n.id=$2 AND d.enabled AND n.leida=false`,[item.device_id,item.notification_id])).rows[0];
  if(!device){await db.query("UPDATE mobile_push_deliveries SET status='error',error_code='OWNER_CHANGED' WHERE notification_id=$1 AND device_id=$2",[item.notification_id,item.device_id]);continue;}
  try{
   const reference=await send(decryptSecret(device.encrypted_token),item.notification_id);
   await db.query("UPDATE mobile_push_deliveries SET status='sent',provider_reference=$3,updated_at=NOW() WHERE notification_id=$1 AND device_id=$2",[item.notification_id,item.device_id,reference]);sent++;
  }catch(e){
   const status=Number(e.response?.status||e.status||0),invalid=e.response?.data?.error?.details?.some(d=>d.errorCode==='UNREGISTERED');
   const state=status===429&&claimed.attempts<5?'retry':status>=400&&status<500?'error':'unknown';
   await db.query("UPDATE mobile_push_deliveries SET status=$3,error_code=$4,next_attempt_at=NOW()+INTERVAL '5 minutes',updated_at=NOW() WHERE notification_id=$1 AND device_id=$2",[item.notification_id,item.device_id,state,invalid?'UNREGISTERED':`HTTP_${status||'UNCERTAIN'}`]);
   if(invalid)await db.query('UPDATE mobile_push_devices SET enabled=false WHERE id=$1',[item.device_id]);
  }
 }
 return {sent};
}
let running=false;
function startScheduler(){if(!configured())return;const timer=setInterval(async()=>{if(running)return;running=true;try{await processPending(require('./db'));}catch{require('./logger').warn('No se pudo procesar la cola de avisos móviles');}finally{running=false;}},30000);timer.unref();return timer;}
module.exports={configured,register,unregister,processPending,sendFcm,startScheduler};
