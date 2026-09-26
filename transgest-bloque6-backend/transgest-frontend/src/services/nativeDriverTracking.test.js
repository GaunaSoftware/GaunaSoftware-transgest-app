import {startNativeDriverTracking,stopNativeDriverTracking} from './nativeDriverTracking';
import {getDriverTrackingContext,getToken} from './api';
import {requestForegroundLocationPermission} from './mobileRuntime';
const mockStart=jest.fn(),mockStop=jest.fn();
jest.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'android',isNativePlatform:()=>true},registerPlugin:()=>({start:(...args)=>mockStart(...args),stop:(...args)=>mockStop(...args)})}));
jest.mock('./api',()=>({getDriverTrackingContext:jest.fn(),getToken:jest.fn()}));
jest.mock('./mobileRuntime',()=>({requestForegroundLocationPermission:jest.fn()}));
jest.mock('../utils/serverConfig',()=>({resolveApiBase:()=> 'https://api.example.invalid'}));
test('native tracking never starts without server workday or user location permission',async()=>{
 getDriverTrackingContext.mockResolvedValue({allowed:false});await expect(startNativeDriverTracking()).rejects.toThrow('jornada');expect(mockStart).not.toHaveBeenCalled();
 getDriverTrackingContext.mockResolvedValue({allowed:true,jornada_id:'day',vehiculo_id:'truck'});requestForegroundLocationPermission.mockResolvedValue(false);await expect(startNativeDriverTracking()).rejects.toThrow('ubicación');expect(mockStart).not.toHaveBeenCalled();
 getToken.mockReturnValue('synthetic-token');requestForegroundLocationPermission.mockResolvedValue(true);await startNativeDriverTracking();expect(mockStart).toHaveBeenCalledWith({base:'https://api.example.invalid/api/v1',token:'synthetic-token',jornada_id:'day',vehiculo_id:'truck'});
 await stopNativeDriverTracking();expect(mockStop).toHaveBeenCalledTimes(1);
});
