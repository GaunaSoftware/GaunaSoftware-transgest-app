// Loaded only by the staging launcher. Delivery still uses the real SMTP server.
const nodemailer = require('nodemailer');
const addressparser = require('nodemailer/lib/addressparser');

function addresses(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(addresses);
  if (typeof value === 'object') return addresses(value.address);
  return addressparser(String(value), { flatten: true }).map(item => String(item.address || '').trim().toLowerCase());
}

function validateRecipients(mail, allowlist) {
  const approved = new Set(addresses(allowlist));
  const recipients = [mail.to, mail.cc, mail.bcc, mail.envelope?.to].flatMap(addresses);
  if (!recipients.length || recipients.some(address => !address || !approved.has(address))) {
    throw Object.assign(new Error('Entorno de pruebas: configura y autoriza los correos de prueba antes de enviar.'), { code: 'STAGING_RECIPIENT_BLOCKED' });
  }
}

function installMailGuard(env = process.env) {
  if (env.TRANSGEST_STAGING !== 'true') throw new Error('La protección de correo solo puede usarse en pruebas.');
  // The owner can explicitly enable ordinary delivery in this isolated test
  // environment. This does not bypass SMTP authentication or TLS checks.
  if (env.STAGING_EMAIL_UNRESTRICTED === 'true') return;
  const createTransport = nodemailer.createTransport;
  nodemailer.createTransport = function (...args) {
    const transport = createTransport.apply(this, args);
    const sendMail = transport.sendMail;
    transport.sendMail = function (mail, callback) {
      try { validateRecipients(mail, env.STAGING_EMAIL_ALLOWLIST || ''); }
      catch (error) {
        if (typeof callback === 'function') { queueMicrotask(() => callback(error)); return; }
        return Promise.reject(error);
      }
      return sendMail.call(this, mail, callback);
    };
    return transport;
  };
}
if (process.env.TRANSGEST_STAGING === 'true') installMailGuard();
module.exports = { addresses, validateRecipients, installMailGuard };
