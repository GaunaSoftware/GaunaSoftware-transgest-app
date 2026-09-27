import {validUpdate,prepareNativeUpdate} from './appUpdates';
jest.mock('@capgo/capacitor-updater',()=>({CapacitorUpdater:{}}));
const current={appId:'com.gaunasoftware.transgest',revision:'a'.repeat(40),nativeFingerprint:'native-v1'};
const manifest={schema:1,...current,revision:'b'.repeat(40),version:'1.3.1800000000',checksum:'c'.repeat(64),size:50000,url:`https://transgest.app/mobile-updates/${'c'.repeat(64)}.zip`};
function fixture(){return {notifyAppReady:jest.fn(async()=>{}),list:jest.fn(async()=>({bundles:[]})),download:jest.fn(async()=>({id:'new-bundle'})),setMultiDelay:jest.fn(async()=>{}),next:jest.fn(async()=>{})};}
test('only compatible releases from the fixed HTTPS host can be installed',()=>{
  expect(validUpdate(manifest,current)).toBe(true);
  for(const change of [{nativeFingerprint:'other'},{appId:'foreign'},{revision:current.revision},{checksum:'bad'},{size:Infinity},{url:'https://other.invalid/file.zip'},{schema:2}])expect(validUpdate({...manifest,...change},current)).toBe(false);
});
test('verifies checksum, schedules full restart, and never reloads an active form',async()=>{
  const plugin=fixture();expect(await prepareNativeUpdate(plugin,{get:async()=>({status:200,data:manifest})},current)).toBe('prepared');
  expect(plugin.download).toHaveBeenCalledWith({url:manifest.url,version:manifest.version,checksum:manifest.checksum});
  expect(plugin.setMultiDelay).toHaveBeenCalledWith({delayConditions:[{kind:'kill'}]});expect(plugin.next).toHaveBeenCalledWith({id:'new-bundle'});
  expect(plugin.notifyAppReady.mock.invocationCallOrder[0]).toBeLessThan(plugin.download.mock.invocationCallOrder[0]);
});
test('offline keeps the running bundle healthy; failed downloads are never activated',async()=>{
  const plugin=fixture();await expect(prepareNativeUpdate(plugin,{get:async()=>{throw Error('offline');}},current)).rejects.toThrow('offline');expect(plugin.notifyAppReady).toHaveBeenCalled();expect(plugin.next).not.toHaveBeenCalled();
  plugin.download.mockRejectedValueOnce(Error('checksum mismatch'));await expect(prepareNativeUpdate(plugin,{get:async()=>({status:200,data:manifest})},current)).rejects.toThrow('checksum');expect(plugin.next).not.toHaveBeenCalled();
});
test('a bundle rolled back by the native health check is not installed repeatedly',async()=>{
  const plugin=fixture();plugin.list.mockResolvedValue({bundles:[{version:manifest.version,status:'error'}]});
  expect(await prepareNativeUpdate(plugin,{get:async()=>({status:200,data:manifest})},current)).toBe('failed-before');expect(plugin.download).not.toHaveBeenCalled();
});
