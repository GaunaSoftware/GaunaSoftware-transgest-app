function publicDocumentApiUrl(req, env = process.env) {
  // Never use PUBLIC_APP_URL for the QR: the frontend does not serve the PDF.
  const configured = env.PUBLIC_API_URL || env.API_PUBLIC_URL ||
    env.BACKEND_PUBLIC_URL || env.RENDER_EXTERNAL_URL;
  if (configured) return new URL(configured).origin;
  const host = typeof req?.get === 'function' ? req.get('host') : '';
  return host ? `${req.protocol}://${host}` : 'http://localhost';
}

module.exports = { publicDocumentApiUrl };
