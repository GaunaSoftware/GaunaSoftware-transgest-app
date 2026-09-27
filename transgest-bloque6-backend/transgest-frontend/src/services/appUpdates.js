import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import build from '../data/appBuild.json';
// Register only the native bridge; web does not load the updater's history hooks.
const CapacitorUpdater = registerPlugin('CapacitorUpdater');

const HOST='https://transgest.app';
export function validUpdate(manifest, current=build){
  if(!manifest || manifest.schema!==1 || manifest.appId!==current.appId || manifest.nativeFingerprint!==current.nativeFingerprint || manifest.revision===current.revision)return false;
  if(!/^[a-f0-9]{40}$/.test(manifest.revision)||!/^[a-f0-9]{64}$/.test(manifest.checksum)||!/^\d+\.\d+\.\d+$/.test(manifest.version))return false;
  if(!Number.isSafeInteger(manifest.size)||manifest.size<1000||manifest.size>100*1024*1024)return false;
  return manifest.url===`${HOST}/mobile-updates/${manifest.checksum}.zip`;
}
let started;
export async function prepareNativeUpdate(updater=CapacitorUpdater,http=CapacitorHttp,current=build){
  // Readiness confirms React mounted; it does not depend on an online API.
  // The native plugin rolls back automatically if the new UI fails to mount.
  await updater.notifyAppReady();
  const response=await http.get({url:`${HOST}/mobile-updates/latest.json`,headers:{'Cache-Control':'no-cache'},connectTimeout:10000,readTimeout:15000});
  const manifest=typeof response.data==='string'?JSON.parse(response.data):response.data;
  if(response.status!==200||!validUpdate(manifest,current))return 'unchanged';
  const {bundles}=await updater.list();
  // Never repeatedly install a bundle that failed its startup health check.
  if(bundles.some(b=>b.version===manifest.version&&b.status==='error'))return 'failed-before';
  let bundle=bundles.find(b=>b.version===manifest.version&&['pending','success'].includes(b.status));
  if(!bundle)bundle=await updater.download({url:manifest.url,version:manifest.version,checksum:manifest.checksum});
  // No reload on camera/background, while signing, or with an unsaved form.
  // Activation is deferred until a full app restart; persisted queues survive.
  await updater.setMultiDelay({delayConditions:[{kind:'kill'}]});
  await updater.next({id:bundle.id});
  return 'prepared';
}
export function startAppUpdates(){
  if(!Capacitor.isNativePlatform()||Capacitor.getPlatform()!=='android')return;
  if(!started)started=prepareNativeUpdate().catch(()=> 'offline');
  return started;
}

export async function checkWebUpdate(current=build){
  if(Capacitor.isNativePlatform()||window.location.hostname!=='transgest.app')return false;
  const response=await fetch('/app-version.json',{cache:'no-store'});
  if(!response.ok)return false;
  const next=await response.json();
  return next.schema===1&&/^[a-f0-9]{40}$/.test(next.revision)&&next.revision!==current.revision;
}
