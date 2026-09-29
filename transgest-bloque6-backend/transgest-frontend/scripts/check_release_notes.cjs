const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const file='transgest-bloque6-backend/transgest-backend/src/data/productReleases.json';
const releases=JSON.parse(fs.readFileSync(path.join(root,file)));
if(!releases.length || new Set(releases.map(r=>r.id)).size!==releases.length || releases.some(r=>!r.title || !r.intro || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Array.isArray(r.items)||!r.items.length||r.items.some(i=>!i.title||!i.text)))throw Error('Completa el catálogo de novedades con textos para usuarios.');
const base=process.env.RELEASE_BASE_SHA;
if(base && /^[a-f0-9]{40}$/.test(base) && !/^0+$/.test(base)){
  let previous=[];try{previous=JSON.parse(cp.execFileSync('git',['show',`${base}:${file}`],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}));}catch{}
  // The user publishes a consolidated announcement only on request. Ordinary
  // code changes must not force a new releaseId (and another login popup).
  if(previous.length && JSON.stringify(releases.slice(-previous.length))!==JSON.stringify(previous))
    throw Error('Conserva intactas las novedades ya publicadas; añade una nueva entrada solo al anunciar una actualización.');
}
console.log('Catálogo de novedades válido.');
