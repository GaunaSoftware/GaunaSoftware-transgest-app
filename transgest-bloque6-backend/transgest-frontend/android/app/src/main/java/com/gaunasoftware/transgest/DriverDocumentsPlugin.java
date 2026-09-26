package com.gaunasoftware.transgest;

import android.content.Intent;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONArray;

@CapacitorPlugin(name="DriverDocuments")
public class DriverDocumentsPlugin extends Plugin {
 private File ownerDirectory(PluginCall call)throws Exception{
  String owner=call.getString("owner","");if(!owner.matches("[a-fA-F0-9-]{36}:[a-fA-F0-9-]{36}"))throw new Exception("Sesión de documentos no válida");
  File root=new File(getContext().getFilesDir(),"driver_documents"),directory=new File(root,sha(owner.getBytes(StandardCharsets.UTF_8)));
  if(!directory.exists()&&!directory.mkdirs())throw new Exception("No se pudo preparar el almacenamiento privado");return directory;
 }
 private static String sha(byte[] data)throws Exception{StringBuilder s=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(data))s.append(String.format("%02x",value&255));return s.toString();}
 private File pdf(File directory,String id)throws Exception{if(id==null||!id.matches("[a-f0-9]{64}"))throw new Exception("Documento no válido");return new File(directory,id+".pdf");}
 @PluginMethod public void save(PluginCall call){
  try{
   String encoded=call.getString("base64","");if(encoded.length()>35*1024*1024)throw new Exception("El PDF supera 25 MB");byte[] bytes=Base64.decode(encoded,Base64.DEFAULT);
   if(bytes.length<5||bytes.length>25*1024*1024||!new String(bytes,0,5,StandardCharsets.US_ASCII).equals("%PDF-"))throw new Exception("Solo se pueden guardar originales PDF");
   String hash=sha(bytes),expected=call.getString("sha256");if(expected!=null&&!expected.equals(hash))throw new Exception("La integridad del PDF no coincide");
   File directory=ownerDirectory(call),target=pdf(directory,hash);
   if(!target.exists()){
    long total=0;File[] entries=directory.listFiles();if(entries!=null)for(File entry:entries)total+=entry.length();if(total+bytes.length>200*1024*1024)throw new Exception("Límite de copias locales de 200 MB. Retira copias antiguas.");
    File temp=File.createTempFile("pdf-",".tmp",directory);
    try(FileOutputStream out=new FileOutputStream(temp)){out.write(bytes);out.getFD().sync();}
    if(!temp.renameTo(target)){temp.delete();throw new Exception("No se pudo conservar el PDF");}
    String name=call.getString("name","Documento.pdf");if(name.length()>500)name=name.substring(0,500);
    JSObject metadata=new JSObject();metadata.put("id",hash);metadata.put("name",name);metadata.put("saved_at",System.currentTimeMillis());metadata.put("size",bytes.length);
    try(FileOutputStream out=new FileOutputStream(new File(directory,hash+".json"))){out.write(metadata.toString().getBytes(StandardCharsets.UTF_8));}
   }
   JSObject result=new JSObject();result.put("id",hash);result.put("size",bytes.length);call.resolve(result);
  }catch(Exception e){call.reject(e.getMessage());}
 }
 @PluginMethod public void list(PluginCall call){
  try{File directory=ownerDirectory(call);JSONArray items=new JSONArray();File[] entries=directory.listFiles((d,n)->n.endsWith(".json"));
   if(entries!=null)for(File entry:entries){try(InputStream in=new FileInputStream(entry)){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[1024];int n;while((n=in.read(buf))!=-1){if(out.size()+n>16384)throw new IOException("Metadata too large");out.write(buf,0,n);}JSObject item=new JSObject(out.toString("UTF-8"));if(pdf(directory,item.getString("id")).exists())items.put(item);}}
   JSObject result=new JSObject();result.put("items",items);call.resolve(result);
  }catch(Exception e){call.reject(e.getMessage());}
 }
 @PluginMethod public void open(PluginCall call){
  try{File file=pdf(ownerDirectory(call),call.getString("id"));if(!file.isFile())throw new Exception("Copia local no disponible");
   Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file),"application/pdf").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
   getActivity().startActivity(intent);call.resolve();
  }catch(Exception e){call.reject("No se pudo abrir el PDF. Comprueba que hay un lector instalado.");}
 }
 @PluginMethod public void remove(PluginCall call){
  try{File dir=ownerDirectory(call),file=pdf(dir,call.getString("id"));if(file.exists()&&!file.delete())throw new Exception("No se pudo retirar la copia local");new File(dir,call.getString("id")+".json").delete();call.resolve();}
  catch(Exception e){call.reject(e.getMessage());}
 }
}
