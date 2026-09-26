package com.gaunasoftware.transgest;

import java.util.HashSet;
import java.util.Set;
import java.util.Collections;

/** Monotonic-clock policy, shared by the real service and local JVM regressions. */
final class TrackingLease {
 private final String day,vehicle;
 private final Set<String> observedTrips=new HashSet<>();
 private long until=0;
 private boolean closed=false;
 TrackingLease(String day,String vehicle){this.day=day;this.vehicle=vehicle;}
 synchronized boolean renew(boolean allowed,String nextDay,String nextVehicle,Set<String> trips,long now,int seconds){
  if(closed||!allowed||!day.equals(nextDay)||!vehicle.equals(nextVehicle)||(!observedTrips.isEmpty()&&Collections.disjoint(observedTrips,trips))){close();return false;}
  observedTrips.addAll(trips);until=now+Math.max(0,Math.min(120,seconds))*1000L;return true;
 }
 synchronized boolean valid(long now){return !closed&&now<until;}
 synchronized void close(){closed=true;until=0;}
}
