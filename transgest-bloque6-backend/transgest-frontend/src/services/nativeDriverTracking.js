import {Capacitor,registerPlugin} from '@capacitor/core';
import {getToken,getDriverTrackingContext} from './api';
import {resolveApiBase} from '../utils/serverConfig';
import {requestForegroundLocationPermission} from './mobileRuntime';
const Tracking=registerPlugin('DriverTracking');
export const hasNativeDriverTracking=()=>Capacitor.getPlatform()==='android'&&Capacitor.isNativePlatform();
export async function startNativeDriverTracking(){
 if(!hasNativeDriverTracking())throw new Error('El servicio de jornada está disponible en la app Android.');
 const context=await getDriverTrackingContext();
 if(!context.allowed)throw new Error('Abre una jornada activa con tractora. Si el vehículo ya tiene GPS reciente, no es necesario activar el móvil.');
 if(!await requestForegroundLocationPermission())throw new Error('Permite la ubicación para iniciar el seguimiento.');
 await Tracking.start({base:resolveApiBase().replace(/\/+$/,'')+'/api/v1',token:getToken(),jornada_id:context.jornada_id,vehiculo_id:context.vehiculo_id});
}
export async function stopNativeDriverTracking(){if(hasNativeDriverTracking())await Tracking.stop();}
export async function nativeDriverTrackingStatus(){return hasNativeDriverTracking()?Tracking.status():{active:false,message:'Seguimiento nativo no disponible'};}
export async function nativeDriverDiagnostics(){return Tracking.diagnostics();}
export async function nativePushAvailable(){return hasNativeDriverTracking()&&(await Tracking.capabilities()).push_configured===true;}
