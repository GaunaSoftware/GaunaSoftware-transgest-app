const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const file='transgest-bloque6-backend/transgest-backend/src/data/productReleases.json';
const releases=JSON.parse(fs.readFileSync(path.join(root,file)));
if(!releases.length || new Set(releases.map(r=>r.id)).size!==releases.length || releases.some(r=>!r.title || !r.intro || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Array.isArray(r.items)||!r.items.length||r.items.some(i=>!i.title||!i.text)))throw Error('Completa el catálogo de novedades con textos para usuarios.');
const base=process.env.RELEASE_BASE_SHA;
if(base && /^[a-f0-9]{40}$/.test(base) && !/^0+$/.test(base)){
  const changed=cp.execFileSync('git',['diff','--name-only',base,'HEAD'],{cwd:root,encoding:'utf8'}).split('\n');
  const customerChange=changed.some(p=>/^transgest-bloque6-backend\/transgest-(front|back)end\/src\//.test(p) && !/\.test\.|\/data\/productReleases.json$/.test(p));
  let previous=[];try{previous=JSON.parse(cp.execFileSync('git',['show',`${base}:${file}`],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}));}catch{}
  if(customerChange && previous.some(r=>r.id===releases[0].id))throw Error('Hay cambios visibles: añade una nueva entrada al principio de productReleases.json. No reutilices una actualización ya descartada por usuarios.');
}
console.log('Catálogo de novedades válido.');
