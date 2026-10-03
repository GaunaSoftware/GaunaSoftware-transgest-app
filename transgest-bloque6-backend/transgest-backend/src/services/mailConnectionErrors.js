// Only fixed, actionable messages cross the API boundary. Provider responses
// can contain credentials or internal details and must never be returned.
function smtpFailure(error = {}) {
  let status = 422, code = 'SMTP_CONFIGURATION', message;
  if (error.code === 'STAGING_RECIPIENT_BLOCKED') {
    code = error.code;
    message = 'Entorno de pruebas: este destinatario no está autorizado. Soporte debe habilitar su dirección como correo de pruebas; no se ha enviado ningún mensaje.';
  } else if (error.code === 'EAUTH' || [534, 535].includes(error.responseCode)) {
    message = 'El proveedor ha rechazado el acceso SMTP. Revisa el usuario y la contraseña del buzón en Mi empresa → Correo / Bandeja IA.';
  } else if (['ENOTFOUND', 'EAI_AGAIN', 'EDNS'].includes(error.code)) {
    message = 'No se pudo resolver el servidor SMTP. Comprueba su nombre con el proveedor del correo.';
  } else if (/CERT|TLS|SSL/.test(error.code || '')) {
    message = 'El certificado TLS del servidor SMTP no es válido o no coincide con su nombre. Comprueba el servidor y el puerto con el proveedor; la conexión debe mantenerse cifrada.';
  } else if (['ETIMEDOUT', 'ECONNREFUSED', 'ETIMEOUT', 'ECONNECTION', 'ESOCKET'].includes(error.code)) {
    status = 503; code = 'SMTP_CONNECTION_FAILED';
    message = 'No se pudo conectar con el servidor SMTP. Comprueba el servidor, el puerto y que el proveedor permita conexiones externas. Vuelve a probar cuando esté disponible.';
  } else if (error.code === 'EENVELOPE') {
    message = 'El proveedor ha rechazado el remitente o el destinatario. Revisa sus direcciones y que el buzón permita enviar con ese remitente.';
  } else if (/descifrar/i.test(error.message || '')) {
    status = 503; code = 'SMTP_CONNECTION_FAILED';
    message = 'El servidor no puede abrir la contraseña SMTP guardada. Soporte debe revisar la clave de custodia antes de volver a probar.';
  } else {
    status = 500; code = 'SMTP_INTERNAL';
    message = 'No se pudo completar la prueba de correo. Contacta con soporte e indica el código de seguimiento.';
  }
  return { status, code, message };
}

module.exports = { smtpFailure };
