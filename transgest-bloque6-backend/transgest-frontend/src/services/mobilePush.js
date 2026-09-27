import {PushNotifications} from '@capacitor/push-notifications';
import {getToken,getMobilePushStatus,registerMobilePushDevice,unregisterMobilePushDevice} from './api';
import {hasNativeDriverTracking,nativePushAvailable} from './nativeDriverTracking';
let device=null,owner=null,listeners=[],generation=0,enabling=null,cancelPending=null;
export async function disableMobilePush(){
 cancelPending?.(new Error('Registro de notificaciones cancelado.'));cancelPending=null;
 generation++;const previous=device,token=owner;device=null;owner=null;
 const nativeConfigured=await nativePushAvailable().catch(()=>false);
 await Promise.allSettled([...(listeners.splice(0).map(l=>l.remove())),...(previous?[unregisterMobilePushDevice(previous,token)]:[]),...(nativeConfigured?[PushNotifications.unregister()]:[])]);
}
export function enableMobilePush(onOpen){
 if(!enabling)enabling=register(onOpen).finally(()=>{enabling=null;});return enabling;
}
async function register(onOpen){
 if(!hasNativeDriverTracking())return false;
 if(!await nativePushAvailable())throw new Error('Esta compilación no tiene Firebase configurado. Los avisos siguen disponibles dentro de la app.');
 if(!(await getMobilePushStatus()).configured)throw new Error('Notificaciones push pendientes de configurar. Los avisos siguen disponibles al abrir la app.');
 await disableMobilePush();
 const version=generation,token=getToken();
 const permission=await PushNotifications.requestPermissions();
 if(permission.receive!=='granted')throw new Error('Permiso de notificaciones no concedido.');
 await PushNotifications.createChannel({id:'transgest_alerts',name:'Avisos de TransGest',importance:3,visibility:-1});
 let resolveRegistration,rejectRegistration;
 const completion=new Promise((resolve,reject)=>{resolveRegistration=resolve;rejectRegistration=reject;});
 completion.catch(()=>{}); // Listener setup can still be awaiting when logout cancels registration.
 cancelPending=rejectRegistration;
 let timer;
 try{
  listeners.push(await PushNotifications.addListener('registration',async result=>{
   try{if(version!==generation||getToken()!==token){rejectRegistration(new Error('La sesión ha cambiado.'));return;}const response=await registerMobilePushDevice(result.value);if(version!==generation||getToken()!==token){await unregisterMobilePushDevice(response.id,token);rejectRegistration(new Error('La sesión ha cambiado.'));return;}device=response.id;owner=token;resolveRegistration();}
   catch(e){rejectRegistration(e);}
  }));
  listeners.push(await PushNotifications.addListener('registrationError',()=>rejectRegistration(new Error('No se pudo registrar el dispositivo. Revisa la configuración de Firebase.'))));
  listeners.push(await PushNotifications.addListener('pushNotificationActionPerformed',()=>{if(version===generation&&getToken()===token)onOpen?.();}));
  timer=setTimeout(()=>rejectRegistration(new Error('No se recibió el registro de notificaciones. Reintenta con conexión.')),20000);
  PushNotifications.register().catch(rejectRegistration);
  await completion;
 }catch(e){if(version===generation)await disableMobilePush();throw e;}finally{clearTimeout(timer);if(cancelPending===rejectRegistration)cancelPending=null;}
 return true;
}
