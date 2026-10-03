import {testCompanyEmail,testOrderMailbox} from './api';
jest.mock('../utils/serverConfig',()=>({resolveApiBase:()=> 'https://example.invalid'}));
jest.mock('./nativeDocuments',()=>({}));
jest.mock('./notify',()=>({confirmDialog:jest.fn()}));

const response=(status,code,error)=>({ok:false,status,headers:{get:name=>name==='content-type'?'application/json':name==='x-request-id'?'synthetic-trace':null},json:async()=>({code,error})});
beforeEach(()=>{localStorage.clear();window.__TMS_TOKEN='synthetic-token';global.fetch=jest.fn();});
afterEach(()=>{delete global.fetch;window.__TMS_TOKEN='';});

test('mail setup and safe connection failures are actionable, unknown server failures remain hidden',async()=>{
 fetch.mockResolvedValue(response(422,'STAGING_RECIPIENT_BLOCKED','Este destinatario no está autorizado.'));
 await expect(testCompanyEmail('test@example.invalid')).rejects.toThrow('Este destinatario no está autorizado.');
 fetch.mockResolvedValue(response(503,'SMTP_CONNECTION_FAILED','No se pudo conectar con el servidor SMTP.'));
 await expect(testCompanyEmail('test@example.invalid')).rejects.toThrow('No se pudo conectar con el servidor SMTP.');
 fetch.mockResolvedValue(response(502,'IMAP_CONNECTION_FAILED','El servidor IMAP no respondió en el puerto 993.'));
 await expect(testOrderMailbox()).rejects.toThrow('El servidor IMAP no respondió en el puerto 993.');
 fetch.mockResolvedValue(response(500,'SMTP_INTERNAL','private database or provider detail'));
 await expect(testCompanyEmail('test@example.invalid')).rejects.toThrow('Codigo de seguimiento: synthetic-trace');
 fetch.mockResolvedValue(response(500,'OTHER','private database or provider detail'));
 await expect(testOrderMailbox()).rejects.toThrow('Codigo de seguimiento: synthetic-trace');
});
