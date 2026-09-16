// Local SMTP sink: no messages leave this process or reach a real mailbox.
const net=require('node:net');
const assert=require('node:assert/strict');
const nodemailer=require('nodemailer');
async function main() {
  const messages=[];const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
    socket.write('220 localhost test SMTP\r\n');
    let buffer='',data=false,body=[];
    socket.on('data',chunk=>{
      buffer+=chunk.toString();
      let end;
      while((end=buffer.indexOf('\r\n'))>=0) {
        const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(data) {
          if(line==='.') {messages.push(body.join('\r\n'));body=[];data=false;socket.write('250 queued locally\r\n');}
          else body.push(line);
        } else if(/^EHLO|^HELO/.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if(/^AUTH PLAIN/.test(line)) socket.write('235 authenticated\r\n');
        else if(/^MAIL FROM|^RCPT TO|^RSET/.test(line)) socket.write('250 OK\r\n');
        else if(line==='DATA') {data=true;socket.write('354 End with dot\r\n');}
        else if(line==='QUIT') socket.end('221 Bye\r\n');
        else socket.write('502 Unsupported\r\n');
      }
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const transport=nodemailer.createTransport({host:'127.0.0.1',port:server.address().port,secure:false,ignoreTLS:true,auth:{user:'isolated-user',pass:'isolated-password'},connectionTimeout:3000,socketTimeout:3000});
  try {
    assert.equal(await transport.verify(),true);
    for(const kind of ['password-reset','invitation','invoice','notification']) {
      const result=await transport.sendMail({from:'TransGest <no-reply@example.test>',to:'Receiver <receiver@example.test>',subject:kind,text:'Local test',html:'<p>Local test</p>',attachments:kind==='invoice'?[{filename:'invoice.pdf',content:Buffer.from('%PDF-1.4 local fixture')}]:[]});
      assert.deepEqual(result.accepted,['receiver@example.test']);
    }
    assert.equal(messages.length,4);
    assert.ok(messages.every(message=>message.includes('multipart/alternative')));
    assert.ok(messages[2].includes('invoice.pdf'));
    console.log('PASS local SMTP: authentication, reset/invitation/invoice/notification MIME payloads and attachment. No external delivery.');
  } finally {transport.close();for(const socket of sockets) socket.destroy();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
