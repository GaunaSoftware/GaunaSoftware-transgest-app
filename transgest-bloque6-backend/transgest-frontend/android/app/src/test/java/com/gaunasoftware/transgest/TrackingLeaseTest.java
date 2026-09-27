package com.gaunasoftware.transgest;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;

public class TrackingLeaseTest {
 private Set<String> trips(String...ids){return new HashSet<>(Arrays.asList(ids));}
 @Test public void leaseExpiresDuringLostConnectivityAndCannotExceedTwoMinutes(){
  TrackingLease lease=new TrackingLease("day","truck");assertFalse(lease.valid(1000));
  assertTrue(lease.renew(true,"day","truck",trips(),1000,900));assertTrue(lease.valid(120999));assertFalse(lease.valid(121000));
 }
 @Test public void completionStopsButAnIntermediateGroupageDeliveryDoesNot(){
  TrackingLease lease=new TrackingLease("day","truck");assertTrue(lease.renew(true,"day","truck",trips("a","b"),0,120));
  assertTrue(lease.renew(true,"day","truck",trips("b"),1000,120));assertFalse(lease.renew(true,"day","truck",trips("future"),2000,120));
  assertFalse(lease.renew(true,"day","truck",trips("a"),3000,120));
 }
 @Test public void vehicleDayPermissionAndExplicitStopAllRevokeTracking(){
  for(String reason:Arrays.asList("vehicle","day","permission","stop")){
   TrackingLease lease=new TrackingLease("day","truck");lease.renew(true,"day","truck",trips(),0,120);
   if(reason.equals("stop"))lease.close();
   assertFalse(lease.renew(!reason.equals("permission"),reason.equals("day")?"next":"day",reason.equals("vehicle")?"other":"truck",trips(),1000,120));assertFalse(lease.valid(1001));
  }
 }
}
