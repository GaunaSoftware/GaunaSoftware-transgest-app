package com.gaunasoftware.transgest;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.net.URI;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import org.json.JSONArray;

@CapacitorPlugin(name="DriverTracking", permissions={
  @Permission(alias="notifications", strings={Manifest.permission.POST_NOTIFICATIONS})
})
public class DriverTrackingPlugin extends Plugin {
  @PluginMethod public void start(PluginCall call) {
    if(Build.VERSION.SDK_INT>=33&&ContextCompat.checkSelfPermission(getContext(),Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
      requestPermissionForAlias("notifications",call,"notificationResult");return;
    }
    launch(call);
  }
  @PermissionCallback private void notificationResult(PluginCall call){launch(call);}
  private void launch(PluginCall call){
    try{
      if(!NotificationManagerCompat.from(getContext()).areNotificationsEnabled())throw new IllegalStateException("Permite las notificaciones para mantener visible el seguimiento.");
      if(ContextCompat.checkSelfPermission(getContext(),Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED&&ContextCompat.checkSelfPermission(getContext(),Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED)throw new IllegalStateException("Permiso de ubicación no concedido.");
      if(!getActivity().hasWindowFocus())throw new IllegalStateException("Inicia el seguimiento desde la app visible.");
      String base=call.getString("base"),token=call.getString("token"),vehicle=call.getString("vehiculo_id"),day=call.getString("jornada_id");
      URI uri=new URI(base);
      if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||token==null||token.length()<10||vehicle==null||day==null)throw new IllegalArgumentException("Configuración de seguimiento no válida; requiere API HTTPS.");
      Intent intent=new Intent(getContext(),DriverTrackingService.class).setAction("START");
      intent.putExtra("base",base.replaceAll("/+$",""));intent.putExtra("token",token);intent.putExtra("vehicle",vehicle);intent.putExtra("day",day);
      ContextCompat.startForegroundService(getContext(),intent);call.resolve();
    }catch(Exception e){call.reject(e.getMessage());}
  }
  @PluginMethod public void stop(PluginCall call){getContext().stopService(new Intent(getContext(),DriverTrackingService.class));call.resolve();}
  @PluginMethod public void status(PluginCall call){JSObject out=new JSObject();out.put("active",DriverTrackingService.active);out.put("message",DriverTrackingService.message);out.put("last_sent_at",DriverTrackingService.lastSentAt);call.resolve(out);}
  @PluginMethod public void capabilities(PluginCall call){JSObject out=new JSObject();out.put("push_configured",getContext().getResources().getIdentifier("google_app_id","string",getContext().getPackageName())!=0);call.resolve(out);}
  @PluginMethod public void diagnostics(PluginCall call){
    JSObject out=new JSObject();out.put("android_api",Build.VERSION.SDK_INT);out.put("tracking_active",DriverTrackingService.active);JSONArray exits=new JSONArray();
    if(Build.VERSION.SDK_INT>=30){ActivityManager manager=(ActivityManager)getContext().getSystemService(android.content.Context.ACTIVITY_SERVICE);
      for(ApplicationExitInfo info:manager.getHistoricalProcessExitReasons(getContext().getPackageName(),0,5)){
        JSObject item=new JSObject();item.put("timestamp",info.getTimestamp());item.put("reason_code",info.getReason());item.put("status",info.getStatus());exits.put(item);
      }
    }
    out.put("process_exits",exits);out.put("contains_location_or_credentials",false);call.resolve(out);
  }
}
