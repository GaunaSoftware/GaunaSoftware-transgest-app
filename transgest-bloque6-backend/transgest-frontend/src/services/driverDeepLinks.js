import {App} from '@capacitor/app';
import {isNativeMobileApp} from './mobileRuntime';
export function driverOrderFromLink(value){
 try{const url=new URL(value);if(url.protocol!=='transgest:'||url.host!=='chofer'||url.search||url.hash)return null;
  const match=url.pathname.match(/^\/pedidos\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);return match?.[1]||null;
 }catch{return null;}
}
export async function listenDriverDeepLinks(onOrder){
 if(!isNativeMobileApp())return ()=>{};
 const open=value=>{const id=driverOrderFromLink(value?.url);if(id)onOrder(id);};
 const listener=await App.addListener('appUrlOpen',open);
 try{open(await App.getLaunchUrl());}catch{}
 return ()=>listener.remove();
}
