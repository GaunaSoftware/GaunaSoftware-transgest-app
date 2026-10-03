import {TextDecoder} from 'util';
import {inboxOriginalView} from './inboxOriginalView';
beforeAll(()=>{global.TextDecoder=TextDecoder;});
test('original email view decodes MIME headers and prefers readable text without rendering HTML or attachments',()=>{
 const raw=['From: =?UTF-8?Q?Prueba_cami=C3=B3n?= <pedidos@example.invalid>','To: trafico@example.invalid','Subject: =?UTF-8?B?Q2FyZ2EgTWFkcmlk?=','Content-Type: multipart/mixed; boundary="test"','','--test','Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: quoted-printable','','Carga ma=C3=B1ana en Madrid.','--test','Content-Type: application/pdf','Content-Disposition: attachment; filename="orden.pdf"','','PDF DATA','--test--'].join('\r\n');
 const view=inboxOriginalView(raw);
 expect(view.from).toBe('Prueba camión <pedidos@example.invalid>');expect(view.subject).toBe('Carga Madrid');
 expect(view.body).toBe('Carga mañana en Madrid.');expect(view.body).not.toContain('PDF DATA');
});
test('HTML-only emails display plain text and omit executable/remote content',()=>{
 const view=inboxOriginalView('Content-Type: text/html\r\n\r\n<p>Hola &amp; carga</p><script>alert(1)</script><img src="https://example.invalid/track"><div>Madrid</div>');
 expect(view.body).toContain('Hola & carga');expect(view.body).toContain('Madrid');expect(view.body).not.toContain('alert');expect(view.body).not.toContain('https');
 expect(inboxOriginalView('Texto manual',false).body).toBe('Texto manual');
});
