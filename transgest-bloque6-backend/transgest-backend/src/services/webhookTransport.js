const { BlockList, isIP } = require('node:net');
const dns = require('node:dns').promises;
const https = require('node:https');

const denied4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],
  ['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],
  ['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4],
]) denied4.addSubnet(address,prefix,'ipv4');
// Azure platform virtual IP is public-looking but exposes host services.
denied4.addAddress('168.63.129.16','ipv4');
const global6 = new BlockList();
global6.addSubnet('2000::',3,'ipv6');
const denied6 = new BlockList();
for (const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) {
  denied6.addSubnet(address,prefix,'ipv6');
}

function blocked(message = 'El webhook debe apuntar a un destino HTTPS público.') {
  return Object.assign(new Error(message), {status:400,code:'WEBHOOK_DESTINATION_BLOCKED'});
}

function publicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !denied4.check(address,'ipv4');
  if (family === 6) return !address.includes('%') && global6.check(address,'ipv6') && !denied6.check(address,'ipv6');
  return false;
}

function normalizeWebhookUrl(value) {
  const raw = String(value || '').trim();
  let url;
  try { url = new URL(raw); } catch { throw blocked(); }
  if (raw.length > 500 || url.protocol !== 'https:' || url.username || url.password || url.hash) throw blocked();
  const host = url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
  if (!host || host === 'localhost' || /\.(localhost|local|internal|home|lan)$/.test(host) ||
      ['metadata.google.internal','metadata.goog','instance-data.ec2.internal'].includes(host)) throw blocked();
  if (isIP(host) && !publicAddress(host)) throw blocked();
  return url;
}

async function resolveDestination(value, lookup = dns.lookup, signal) {
  const url = normalizeWebhookUrl(value);
  const host = url.hostname.replace(/^\[|\]$/g,'');
  let answers;
  if (isIP(host)) answers = [{address:host,family:isIP(host)}];
  else {
    const resolving = lookup(host,{all:true,verbatim:true});
    if (signal) {
      signal.throwIfAborted();
      let abort;
      try {
        answers = await Promise.race([resolving,new Promise((_,reject)=>{
          abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
        })]);
      } finally { signal.removeEventListener('abort',abort); }
    } else answers = await resolving;
  }
  if (!Array.isArray(answers) || !answers.length || answers.some(item=>!publicAddress(item.address))) throw blocked();
  return {url,address:answers[0].address,family:isIP(answers[0].address)};
}

function requestOnce(destination, {body,headers,signal,method}, request = https.request) {
  return new Promise((resolve,reject)=>{
    const {url,address,family} = destination;
    // Keep the original hostname for Host, TLS SNI and certificate validation.
    // Disable pooling and pin DNS so no subsequent resolution can change the IP.
    const req = request(url, {
      method,headers,signal,agent:false,
      lookup:(_host,options,callback)=>{
        if (typeof options === 'function') {callback=options;options={};}
        if (options.all) callback(null,[{address,family}]);
        else callback(null,address,family);
      },
    },res=>{
      resolve({status:res.statusCode,location:res.headers.location});
      res.destroy(); // Webhook responses are never retained or parsed.
    });
    req.once('error',reject);
    req.end(body);
  });
}

async function postWebhook(value, {body,headers,signal}, dependencies = {}) {
  let current = value, method='POST', payload=body;
  const original = normalizeWebhookUrl(value);
  for (let redirects=0;redirects<=3;redirects++) {
    const destination = await resolveDestination(current,dependencies.lookup,signal);
    if (destination.url.origin !== original.origin) {
      throw blocked('El webhook no puede redirigir datos firmados a otro origen. Configura la URL final.');
    }
    const response = await requestOnce(destination,{body:payload,headers,signal,method},dependencies.request);
    if (![301,302,303,307,308].includes(response.status) || !response.location) return response;
    if (redirects === 3) throw blocked('Demasiadas redirecciones en el webhook.');
    current = new URL(response.location,destination.url).href;
    if ([301,302,303].includes(response.status)) {method='GET';payload=undefined;}
  }
}

module.exports = { publicAddress, normalizeWebhookUrl, resolveDestination, postWebhook };
