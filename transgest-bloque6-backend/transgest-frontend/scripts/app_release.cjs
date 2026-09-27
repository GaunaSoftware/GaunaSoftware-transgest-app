const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function nativeFingerprint(){
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));
  const native=Object.entries(pkg.packages).filter(([name])=>/^node_modules\/@(capacitor|capgo)\//.test(name)).map(([name,p])=>[name,p.version]).sort();
  const files=['capacitor.config.json','android/variables.gradle','android/build.gradle','android/app/build.gradle'];
  const walk=dir=>{for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=`${dir}/${e.name}`;if(e.isDirectory())walk(p);else if(!p.includes('/assets/'))files.push(p);}};
  walk('android/app/src/main/java');files.push('android/app/src/main/AndroidManifest.xml');
  return hash(JSON.stringify(native)+files.sort().map(p=>p+'\n'+fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n')).join('\n'));
}
function prepare(){
  let revision=process.env.VERCEL_GIT_COMMIT_SHA;
  if(!revision){try{revision=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{revision='development';}}
  if(process.env.VERCEL_ENV==='production' && !/^[a-f0-9]{40}$/.test(revision))throw new Error('La publicación necesita una revisión Git identificable.');
  const releases=JSON.parse(fs.readFileSync(path.resolve(root,'../transgest-backend/src/data/productReleases.json')));
  const info={schema:1,appId:'com.gaunasoftware.transgest',revision,releaseId:releases[0].id,nativeFingerprint:nativeFingerprint(),builtAt:new Date().toISOString()};
  fs.mkdirSync(path.join(root,'src/data'),{recursive:true});
  fs.writeFileSync(path.join(root,'src/data/appBuild.json'),JSON.stringify(info,null,2)+'\n');
  return info;
}
async function pack(){
  const JSZip=require('jszip'),build=path.join(root,'build');
  const info=JSON.parse(fs.readFileSync(path.join(root,'src/data/appBuild.json')));
  fs.writeFileSync(path.join(build,'app-version.json'),JSON.stringify(info));
  if(process.env.VERCEL_ENV!=='production' && process.env.TRANSGEST_PACKAGE_UPDATE!=='1')return;
  if(process.env.REACT_APP_PRODUCT==='planner'||process.env.REACT_APP_LOCAL_SERVER==='true'||process.env.PUBLIC_URL && process.env.PUBLIC_URL!=='/')throw new Error('No publicar un paquete móvil de Planner/escritorio/ensayo.');
  const zip=new JSZip();
  function walk(dir=''){
    for(const entry of fs.readdirSync(path.join(build,dir),{withFileTypes:true})){
      const rel=path.posix.join(dir,entry.name);
      if(entry.name==='mobile-updates'||entry.name==='qa'||entry.name.endsWith('.map'))continue;
      if(entry.isDirectory())walk(rel);else zip.file(rel,fs.readFileSync(path.join(build,rel)));
    }
  }
  walk();
  const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
  const checksum=hash(bytes),version=`1.3.${Math.floor(Date.parse(info.builtAt)/1000)}`;
  const out=path.join(build,'mobile-updates');fs.mkdirSync(out,{recursive:true});
  const name=`${checksum}.zip`;
  fs.writeFileSync(path.join(out,name),bytes);
  fs.writeFileSync(path.join(out,'latest.json'),JSON.stringify({...info,version,checksum,size:bytes.length,url:`https://transgest.app/mobile-updates/${name}`}));
  console.log(`Actualización Android preparada: ${bytes.length} bytes, SHA-256 ${checksum}`);
}
module.exports={prepare,pack,nativeFingerprint};
if(require.main===module)(process.argv.includes('--pack')?pack():Promise.resolve(prepare())).catch(e=>{console.error(e.message);process.exitCode=1;});
