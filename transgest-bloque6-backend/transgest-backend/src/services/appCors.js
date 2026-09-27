// Packaged clients still authenticate every request with the normal API token.
// Android serves bundled assets from this exact HTTPS origin; do not use a
// localhost suffix/port wildcard or accept arbitrary origins from the request.
const PACKAGED_ORIGINS = new Set(['transgest://app', 'https://localhost']);

function appCorsOptions(configuredOrigins = '') {
  const origins = new Set(String(configuredOrigins).split(',').map(value => value.trim()).filter(Boolean));
  return {
    origin(origin, cb) {
      // Preserve server-to-server and unconfigured development behavior.
      // envValidator requires an explicit CORS_ORIGINS list in production.
      cb(null, !origin || PACKAGED_ORIGINS.has(origin) || !origins.size || origins.has(origin));
    },
    credentials: true,
  };
}

module.exports = { appCorsOptions };
