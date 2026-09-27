const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),JSZip=require('jszip');
const root=path.resolve(__dirname,'..');
(async()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'build/mobile-updates/latest.json')));
  const bytes=fs.readFileSync(path.join(root,'build/mobile-updates',manifest.checksum+'.zip'));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),manifest.checksum);assert.equal(bytes.length,manifest.size);
  const zip=await JSZip.loadAsync(bytes),files=Object.keys(zip.files);
  assert.ok(zip.file('index.html'));assert.ok(zip.file('app-version.json'));
  assert.ok(!files.some(p=>p.startsWith('/')||p.includes('..')||p.startsWith('qa/')||p.startsWith('mobile-updates/')||p.endsWith('.map')));
  assert.equal(JSON.parse(await zip.file('app-version.json').async('string')).nativeFingerprint,manifest.nativeFingerprint);
  const html=await zip.file('index.html').async('string');
  for(const match of html.matchAll(/(?:src|href)="(\/static\/[^"?]+)"/g))assert.ok(zip.file(match[1].slice(1)),match[1]);
  console.log(`Paquete OTA OK: ${files.length} entradas, ${bytes.length} bytes, index y activos íntegros; sin QA, mapas de código ni ZIP anidado.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
