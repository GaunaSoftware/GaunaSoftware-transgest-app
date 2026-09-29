import {Capacitor,registerPlugin} from '@capacitor/core';
import {getOfflineOwner} from './offlineQueue';
const Documents=registerPlugin('DriverDocuments');
export const hasNativeDocuments=()=>Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android';
export async function saveNativePdf(blob,name){
 const owner=getOfflineOwner();if(!owner)throw new Error('Inicia sesión para guardar documentos.');
 if(blob.size>25*1024*1024)throw new Error('El PDF supera el límite de 25 MB.');
 const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('No se pudo leer el PDF'));reader.readAsDataURL(blob);});
 if(getOfflineOwner()!==owner)throw new Error('La sesión ha cambiado.');
 return Documents.save({owner,name,base64});
}
export const listNativePdfs=()=>Documents.list({owner:getOfflineOwner()});
export const openNativePdf=id=>Documents.open({owner:getOfflineOwner(),id});
export const previewNativePdf=async id=>{
 try{return await Documents.preview({owner:getOfflineOwner(),id});}
 catch(error){
  // An installed APK may still contain the previous native bridge while its web
  // assets have updated. Keep document access available until the APK is updated.
  if(/not implemented|unimplemented|does not exist/i.test(String(error?.message||error)))return openNativePdf(id);
  throw error;
 }
};
export const removeNativePdf=id=>Documents.remove({owner:getOfflineOwner(),id});
