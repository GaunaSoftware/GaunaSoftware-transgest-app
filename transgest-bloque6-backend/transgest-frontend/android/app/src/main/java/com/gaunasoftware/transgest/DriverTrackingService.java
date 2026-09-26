package com.gaunasoftware.transgest;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.location.*;
import android.os.*;
import androidx.core.app.NotificationCompat;
import org.json.JSONObject;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;

/** User-started only. No boot receiver, persisted bearer, background permission or automatic restart. */
public class DriverTrackingService extends Service implements LocationListener {
  static volatile boolean active=false;
  static volatile String message="Seguimiento detenido",lastSentAt="";
  private static final String CHANNEL="transgest_driver_location";
  private final ScheduledExecutorService executor=Executors.newSingleThreadScheduledExecutor();
  private final Handler main=new Handler(Looper.getMainLooper());
  private LocationManager locations;
  private String base,token,vehicle,day;
  private TrackingLease lease;
  private volatile boolean stopping=false;
  private volatile Location latest;
  private long sentCapture=0;

  @Override public int onStartCommand(Intent intent,int flags,int startId){
    if(intent==null||"STOP".equals(intent.getAction())){finish("Seguimiento detenido por el conductor");return START_NOT_STICKY;}
    if(active){return START_NOT_STICKY;}
    base=intent.getStringExtra("base");token=intent.getStringExtra("token");vehicle=intent.getStringExtra("vehicle");day=intent.getStringExtra("day");
    if(base==null||token==null||vehicle==null||day==null){finish("Configuración incompleta");return START_NOT_STICKY;}
    lease=new TrackingLease(day,vehicle);
    NotificationManager manager=getSystemService(NotificationManager.class);
    if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel(CHANNEL,"Ubicación durante la jornada",NotificationManager.IMPORTANCE_LOW));
    Intent stop=new Intent(this,DriverTrackingService.class).setAction("STOP");
    PendingIntent stopAction=PendingIntent.getService(this,1,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    PendingIntent open=PendingIntent.getActivity(this,2,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    Notification notification=new NotificationCompat.Builder(this,CHANNEL).setSmallIcon(R.drawable.ic_tracking).setContentTitle("TransGest · Seguimiento de jornada").setContentText("Ubicación activa. Puedes detenerla en cualquier momento.").setOngoing(true).setOnlyAlertOnce(true).setContentIntent(open).addAction(R.drawable.ic_tracking,"Detener",stopAction).build();
    try{
      if(Build.VERSION.SDK_INT>=29)startForeground(604,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);else startForeground(604,notification);
      active=true;message="Comprobando jornada y permisos…";
      executor.scheduleWithFixedDelay(this::tick,0,30,TimeUnit.SECONDS);
    }catch(Exception e){finish("No se pudo iniciar el seguimiento; revisa permisos y notificaciones.");}
    return START_NOT_STICKY;
  }
  private void startLocations(){
    if(locations!=null||stopping)return;
    try{
      locations=(LocationManager)getSystemService(LOCATION_SERVICE);
      boolean enabled=false;
      for(String provider:new String[]{LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER}){
        if(locations.isProviderEnabled(provider)){locations.requestLocationUpdates(provider,30000,15,this,Looper.getMainLooper());enabled=true;}
      }
      if(!enabled)finish("Activa la ubicación del dispositivo y vuelve a iniciar el seguimiento.");
    }catch(SecurityException e){finish("Permiso de ubicación retirado");}
  }
  private void tick(){
    if(stopping)return;
    try{
      JSONObject context=request("GET","/choferes/app/tracking-context",null);
      if(stopping)return;
      Set<String> currentTrips=new HashSet<>();org.json.JSONArray trips=context.optJSONArray("active_trip_ids");
      if(trips!=null)for(int i=0;i<trips.length();i++)currentTrips.add(trips.getString(i));
      if(!lease.renew(context.optBoolean("allowed"),context.optString("jornada_id"),context.optString("vehiculo_id"),currentTrips,SystemClock.elapsedRealtime(),context.optInt("lease_seconds",120))){finish("Seguimiento finalizado: viaje, jornada, conjunto o fuente GPS cambiados.");return;}
      main.post(this::startLocations);
      Location fix=latest;
      if(fix==null){message="Esperando señal GPS…";return;}
      long age=(SystemClock.elapsedRealtimeNanos()-fix.getElapsedRealtimeNanos())/1000000;
      if(age>120000||fix.getTime()<=sentCapture){message="Esperando una posición reciente…";return;}
      JSONObject body=new JSONObject();body.put("vehiculo_id",vehicle);body.put("jornada_id",day);body.put("lat",fix.getLatitude());body.put("lng",fix.getLongitude());body.put("recorded_at",iso(fix.getTime()));
      body.put("accuracy_m",fix.hasAccuracy()?fix.getAccuracy():JSONObject.NULL);body.put("velocidad_kmh",fix.hasSpeed()?fix.getSpeed()*3.6:JSONObject.NULL);body.put("heading",fix.hasBearing()?fix.getBearing():JSONObject.NULL);
      JSONObject result=request("POST","/choferes/app/gps",body);
      if(stopping)return;
      if(result.has("skipped")){finish("Seguimiento pausado por el servidor");return;}
      if(result.optBoolean("ok")){sentCapture=fix.getTime();lastSentAt=iso(sentCapture);message="Ubicación enviada a TransGest";}
    }catch(Exception e){
      message="Sin conexión; esperando para reintentar";
      if(!lease.valid(SystemClock.elapsedRealtime()))finish("Seguimiento detenido: no se pudo renovar la autorización de jornada.");
    }
  }
  private JSONObject request(String method,String path,JSONObject body)throws Exception{
    HttpsURLConnection c=(HttpsURLConnection)new URL(base+path).openConnection();
    c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(10000);c.setRequestMethod(method);c.setRequestProperty("Authorization","Bearer "+token);c.setRequestProperty("Accept","application/json");
    try{
      if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
      int status=c.getResponseCode();
      if(status==401||status==403||status==409){finish("Seguimiento detenido: sesión o asignación no válida");throw new IOException("Authorization expired");}
      if(status!=200)throw new IOException("Server unavailable");
      ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream input=c.getInputStream()){byte[] buffer=new byte[1024];int n;while((n=input.read(buffer))!=-1){if(bytes.size()+n>65536)throw new IOException("Response too large");bytes.write(buffer,0,n);}}
      return new JSONObject(bytes.toString("UTF-8"));
    }finally{c.disconnect();}
  }
  private static String iso(long time){SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT);f.setTimeZone(TimeZone.getTimeZone("UTC"));return f.format(new Date(time));}
  private void finish(String reason){if(stopping)return;stopping=true;message=reason;main.post(this::stopSelf);}
  @Override public void onLocationChanged(Location location){if(!stopping&&lease.valid(SystemClock.elapsedRealtime()))latest=new Location(location);}
  @Override public void onProviderDisabled(String provider){message="Señal GPS no disponible";}
  @Override public void onProviderEnabled(String provider){}
  @Override public void onStatusChanged(String provider,int status,Bundle extras){}
  @Override public IBinder onBind(Intent intent){return null;}
  @Override public void onTaskRemoved(Intent rootIntent){finish("Seguimiento detenido al cerrar la app");}
  @Override public void onDestroy(){stopping=true;active=false;if(lease!=null)lease.close();latest=null;executor.shutdownNow();if(locations!=null)locations.removeUpdates(this);token=null;stopForeground(true);super.onDestroy();}
}
