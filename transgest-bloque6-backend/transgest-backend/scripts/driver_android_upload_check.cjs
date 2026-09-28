const assert = require('node:assert/strict');
const {validateBase64Upload} = require('../src/services/uploadValidation');

// Android camera/gallery providers may send JPEG as image/jpg or image/pjpeg.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64');
for (const mime of ['image/jpeg', 'image/jpg', 'image/pjpeg']) {
  const accepted = validateBase64Upload({data:jpeg,mime,filename:'foto.jpg'});
  assert.equal(accepted.mime,'image/jpeg');
  assert.equal(accepted.sizeBytes,10);
}
assert.throws(() => validateBase64Upload({data:Buffer.from('<html>bad</html>').toString('base64'),mime:'image/jpg',filename:'foto.jpg'}), /contenido.*no coincide/i);
assert.throws(() => validateBase64Upload({data:jpeg,mime:'text/html',filename:'foto.jpg'}), /Tipo de archivo no permitido/i);
console.log('PASS Android JPG upload: provider MIME aliases accepted, invalid content and HTML rejected.');
