const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
async function main(){
  const mail=fs.readFileSync(path.join(__dirname,'../src/services/email.js'),'utf8');
  const captured=[];
  const smtp={nodemailer:{createTransport:options=>{captured.push(options);return options;}},process:{env:{NODE_ENV:'production'}}};
  vm.runInNewContext(mail.slice(mail.indexOf('let transporter;'),mail.indexOf('async function platformSmtpConfig'))+';this.build=getTransporter;',smtp);
  smtp.build({smtp_host:'smtp.example.test',smtp_port:587,smtp_secure:true,smtp_user:'test',smtp_pass:'local-only'});
  assert.equal(captured[0].secure,false);assert.equal(captured[0].requireTLS,true);assert.equal(captured[0].tls.rejectUnauthorized,true);
  smtp.build({smtp_host:'smtp.example.test',smtp_port:465,smtp_secure:false});
  assert.equal(captured[1].secure,true);assert.equal(captured[1].requireTLS,false);
  const source=fs.readFileSync(path.join(__dirname,'../src/routes/superadminCore.js'),'utf8');
  let response={ok:true,status:200,json:async()=>({routes:[{sections:[{summary:{length:1000}}]}]})};
  const requests=[];
  const ctx={AbortController,setTimeout,clearTimeout,Date,GPS_PROVIDERS:['test-gps'],getGpsLinkedStats:async()=>({con_senal_reciente:0}),fetch:async(url,options)=>{requests.push({url,options});return response;}};
  vm.runInNewContext(source.slice(source.indexOf('async function testGpsProviderConnection'),source.indexOf('function integrationCheck'))+';this.test=testGpsProviderConnection;',ctx);
  assert.equal((await ctx.test('here','local-test-key')).ok,true);
  assert.equal(new URL(requests[0].url).hostname,'router.hereapi.com');assert.equal(new URL(requests[0].url).searchParams.get('transportMode'),'truck');
  response={ok:true,status:200,json:async()=>({features:[{properties:{summary:{distance:1000}}}]})};
  assert.equal((await ctx.test('ors','ors-test-key')).ok,true);assert.equal(requests[1].options.headers.Authorization,'ors-test-key');
  response={ok:false,status:403,json:async()=>({error:'denied'})};
  assert.equal((await ctx.test('here','bad-key')).ok,false);
  response={ok:true,status:200,json:async()=>({})};
  assert.equal((await ctx.test('ors','empty-response')).ok,false);
  assert.equal((await ctx.test('test-gps','configured')).ok,false);
  assert.equal((await ctx.test('unknown','configured')).ok,false);
  console.log('PASS SMTP 587 STARTTLS / 465 TLS and actual HERE/ORS request contracts, rejected/empty responses, unverified GPS and unknown connector. Remote responses simulated.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
