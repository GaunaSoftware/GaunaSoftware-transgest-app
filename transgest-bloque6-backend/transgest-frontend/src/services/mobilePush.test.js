import {enableMobilePush,disableMobilePush} from './mobilePush';
import {getMobilePushStatus,getToken,registerMobilePushDevice,unregisterMobilePushDevice} from './api';
const mockEvents={},mockRegister=jest.fn(),mockUnregister=jest.fn();
jest.mock('@capacitor/push-notifications',()=>({PushNotifications:{
 addListener:async(name,fn)=>{mockEvents[name]=fn;return {remove:async()=>{delete mockEvents[name];}};},
 requestPermissions:async()=>({receive:'granted'}),createChannel:async()=>{},register:(...a)=>mockRegister(...a),unregister:(...a)=>mockUnregister(...a)
}}));
jest.mock('./api',()=>({getMobilePushStatus:jest.fn(),getToken:jest.fn(),registerMobilePushDevice:jest.fn(),unregisterMobilePushDevice:jest.fn()}));
jest.mock('./nativeDriverTracking',()=>({hasNativeDriverTracking:()=>true,nativePushAvailable:async()=>true}));
test('native push does not claim activation without a configured provider and preserves owner on logout',async()=>{
 getMobilePushStatus.mockResolvedValue({configured:false});await expect(enableMobilePush()).rejects.toThrow('pendientes');expect(mockRegister).not.toHaveBeenCalled();
 getMobilePushStatus.mockResolvedValue({configured:true});getToken.mockReturnValue('owner-a');registerMobilePushDevice.mockResolvedValue({id:'device'});
 mockRegister.mockImplementation(async()=>mockEvents.registration({value:'fcm-token-synthetic'}));
 const open=jest.fn();expect(await enableMobilePush(open)).toBe(true);expect(registerMobilePushDevice).toHaveBeenCalledWith('fcm-token-synthetic');
 mockEvents.pushNotificationActionPerformed({});expect(open).toHaveBeenCalledTimes(1);
 getToken.mockReturnValue('owner-b');mockEvents.pushNotificationActionPerformed({});expect(open).toHaveBeenCalledTimes(1);
 await disableMobilePush();expect(unregisterMobilePushDevice).toHaveBeenCalledWith('device','owner-a');expect(Object.keys(mockEvents)).toHaveLength(0);
});
