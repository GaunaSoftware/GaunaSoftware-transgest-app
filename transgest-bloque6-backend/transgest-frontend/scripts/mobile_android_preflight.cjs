const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'capacitor.config.json'),'utf8'));
assert.equal(config.appId,'com.gaunasoftware.transgest');
assert.equal(config.webDir,'build');
assert.equal(config.server.androidScheme,'https');
assert.ok(!config.server.url,'No se publica un contenedor que cargue una web remota de desarrollo.');
assert.equal(config.android.allowMixedContent,false);
if(process.env.REACT_APP_API_URL)assert.equal(new URL(process.env.REACT_APP_API_URL).origin,'https://api.transgest.app','La publicación oficial debe conectar con la API TransGest.');
assert.ok(!process.env.PUBLIC_URL || process.env.PUBLIC_URL==='/', 'No reutilices PUBLIC_URL del escritorio para Android.');
const sdk=fs.readFileSync(path.join(root,'android/variables.gradle'),'utf8');
assert.match(sdk,/targetSdkVersion\s*=\s*36\b/);
const manifest=fs.readFileSync(path.join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
assert.ok(!/ACCESS_BACKGROUND_LOCATION|READ_MEDIA_IMAGES|READ_EXTERNAL_STORAGE/.test(manifest),'Revisar permisos generales no necesarios.');
assert.match(manifest,/allowBackup="false"/);
if(process.argv.includes('--assets')){
  const assets=path.join(root,'android/app/src/main/assets');
  const bundled=JSON.parse(fs.readFileSync(path.join(assets,'capacitor.config.json'),'utf8'));
  assert.deepEqual(bundled.server,config.server);
  assert.ok(fs.existsSync(path.join(assets,'public/index.html')));
  assert.ok(!fs.existsSync(path.join(assets,'public/qa')),'No empaquetar demostraciones QA.');
  const scripts=fs.readdirSync(path.join(assets,'public/static/js')).filter(f=>/^main\..*\.js$/.test(f));
  assert.equal(scripts.length,1);
  assert.ok(fs.readFileSync(path.join(assets,'public/static/js',scripts[0]),'utf8').includes('https://api.transgest.app'));
}
console.log('Android preflight OK: identidad, API HTTPS, SDK 36, permisos y activos. No acredita firma ni prueba física.');
