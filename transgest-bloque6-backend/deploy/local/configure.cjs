const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const target = path.join(__dirname,'.env');
const url = new URL(process.argv[2] || 'http://localhost:8088');
if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('URL de servidor no valida.');
if (fs.existsSync(target)) { console.log('La configuracion ya existe. No se han cambiado las claves.'); process.exit(0); }
const secret = () => crypto.randomBytes(48).toString('hex');
fs.writeFileSync(target, [
  `LOCAL_URL=${url.origin}`, `LOCAL_PORT=${url.port || (url.protocol==='https:'?'443':'80')}`,
  `DB_PASSWORD=${secret()}`, `JWT_SECRET=${secret()}`, `USER_JWT_SECRET=${secret()}`,
  `SUPERADMIN_JWT_SECRET=${secret()}`, `ACCOUNTING_SSO_JWT_SECRET=${secret()}`,
  `API_KEYS_ENCRYPTION_SECRET=${secret()}`, `DOC_CONTROL_SECRET=${secret()}`, ''
].join('\n'), {flag:'wx',mode:0o600});
console.log('Configuracion local creada con claves aleatorias. Conserva .env junto con tus copias de seguridad.');
