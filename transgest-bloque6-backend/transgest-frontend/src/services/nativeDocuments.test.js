import {saveNativePdf,listNativePdfs,openNativePdf} from './nativeDocuments';
const mockSave=jest.fn(),mockList=jest.fn(),mockOpen=jest.fn();
jest.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'android',isNativePlatform:()=>true},registerPlugin:()=>({save:(...a)=>mockSave(...a),list:(...a)=>mockList(...a),open:(...a)=>mockOpen(...a)})}));
test('downloaded PDF is stored and read under the current company/user, without bearer credentials',async()=>{
 localStorage.setItem('tms_user',JSON.stringify({empresa_id:'company-a',id:'user-a'}));
 mockSave.mockResolvedValue({id:'hash'});expect(await saveNativePdf(new Blob(['%PDF-1.7 test'],{type:'application/pdf'}),'prueba.pdf')).toEqual({id:'hash'});
 expect(mockSave.mock.calls[0][0]).toEqual({owner:'company-a:user-a',name:'prueba.pdf',base64:btoa('%PDF-1.7 test')});
 localStorage.setItem('tms_user',JSON.stringify({empresa_id:'company-b',id:'user-b'}));await listNativePdfs();await openNativePdf('hash');expect(mockList).toHaveBeenCalledWith({owner:'company-b:user-b'});expect(mockOpen).toHaveBeenCalledWith({owner:'company-b:user-b',id:'hash'});
 localStorage.removeItem('tms_user');await expect(saveNativePdf(new Blob(['a']),'test.pdf')).rejects.toThrow('sesión');
});
