const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {publicAddress,resolveDestination,postWebhook}=require('../src/services/webhookTransport');

async function main() {
  for(const ip of ['127.0.0.1','10.2.3.4','192.168.1.1','172.16.1.1','172.31.255.254',
    '169.254.169.254','100.100.100.200','168.63.129.16','0.0.0.0','224.0.0.1','255.255.255.255',
    '192.0.2.5','198.18.0.1','::1','::','::ffff:127.0.0.1','::ffff:8.8.8.8','fe80::1','fc00::1','ff02::1',
    '2001:db8::1','2002:7f00:1::','64:ff9b::7f00:1','3fff::1']) assert.equal(publicAddress(ip),false,ip);
  for(const ip of ['8.8.8.8','1.1.1.1','93.184.216.34','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(publicAddress(ip),true,ip);
  for(const url of ['https://localhost/a','https://localhost./a','https://metadata.google.internal',
    'https://127.1','https://2130706433','https://0x7f000001','https://[::1]',
    'https://u:p@example.com','http://example.com','https://example.com/#token','https://a.local']) {
    await assert.rejects(resolveDestination(url),{code:'WEBHOOK_DESTINATION_BLOCKED'},url);
  }
  const lookup=async()=>[{address:'93.184.216.34',family:4}];
  assert.equal((await resolveDestination('https://public.example/path',lookup)).address,'93.184.216.34');
  await assert.rejects(resolveDestination('https://mixed.example',async()=>[
    {address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]),{code:'WEBHOOK_DESTINATION_BLOCKED'});
  let calls=0, dnsCalls=0;
  function request(url,options,callback) {
    calls++;
    assert.equal(url.hostname,'public.example');
    assert.equal(options.agent,false);
    options.lookup(url.hostname,{},(err,ip,family)=>{assert.equal(err,null);assert.equal(ip,'93.184.216.34');assert.equal(family,4);});
    options.lookup(url.hostname,{all:true},(err,addresses)=>assert.deepEqual(addresses,[{address:'93.184.216.34',family:4}]));
    const req=new EventEmitter();
    req.end=body=>{assert.equal(body,'signed-body');queueMicrotask(()=>callback({statusCode:307,headers:{location:'https://10.0.0.1/private'},destroy(){}}));};
    return req;
  }
  const args={body:'signed-body',headers:{'X-TransGest-Signature':'sha256=test'},signal:AbortSignal.timeout(3000)};
  await assert.rejects(postWebhook('https://public.example',args,{lookup:async()=>{dnsCalls++;return lookup();},request}),{code:'WEBHOOK_DESTINATION_BLOCKED'});
  assert.equal(calls,1);assert.equal(dnsCalls,1);
  // A same-host redirect forces a new DNS validation; rebinding never connects.
  calls=0;dnsCalls=0;
  const redirectRequest=(url,options,callback)=>{
    calls++;const req=new EventEmitter();req.end=()=>queueMicrotask(()=>callback({statusCode:307,headers:{location:'/next'},destroy(){}}));return req;
  };
  await assert.rejects(postWebhook('https://public.example',args,{request:redirectRequest,lookup:async()=>{
    dnsCalls++;return [{address:dnsCalls===1?'93.184.216.34':'127.0.0.1',family:4}];
  }}),{code:'WEBHOOK_DESTINATION_BLOCKED'});
  assert.equal(calls,1);assert.equal(dnsCalls,2);
  // A valid destination preserves POST and signed bytes on 307, then succeeds.
  calls=0;
  const response=await postWebhook('https://public.example',args,{lookup,request:(url,options,callback)=>{
    calls++;assert.equal(options.method,'POST');const req=new EventEmitter();
    req.end=body=>{assert.equal(body,args.body);queueMicrotask(()=>callback({statusCode:calls===1?307:204,headers:calls===1?{location:'/receiver'}:{},destroy(){}}));};return req;
  }});
  assert.equal(response.status,204);assert.equal(calls,2);
  console.log('PASS webhook SSRF: public/private IPv4 and IPv6, mixed DNS, credentials, redirects, rebinding, pinned transport and signed POST.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
