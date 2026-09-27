# Conexión Android: origen del WebView

## Defecto reproducido

El APK 1.2.0 apunta a `https://api.transgest.app`. Capacitor sirve sus activos desde `https://localhost`, según `capacitor.config.json`. No requiere una cuenta de Play, Firebase ni una dirección introducida por el usuario para conectar con la API.

Antes de la corrección, la API productiva `292ef57` devolvía `/health` 200 con base conectada, pero el OPTIONS de `/api/v1/auth/login` desde `https://localhost` devolvía 200 sin `Access-Control-Allow-Origin`. La web `https://transgest.app` recibía 204 y su origen autorizado. El WebView bloqueaba por CORS el inicio de sesión antes de enviar las credenciales.

El smoke anterior comprobaba disponibilidad y autenticación, pero no este origen. El smoke ampliado reproduce el fallo con salida 1 antes de publicar. Esa omisión de validación queda cubierta en esta corrección.

## Cambio acotado

`appCorsOptions` conserva los orígenes configurados, el escritorio `transgest://app` y el comportamiento de desarrollo existente. Añade exclusivamente `https://localhost` para el APK distribuido. No admite comodines, puertos ni sufijos similares. Se mantienen el token, los permisos de rol/plan y el aislamiento por empresa. CORS no sustituye la autenticación.

No hay migraciones, cambios de credenciales, aumento de capacidad ni cambios en el APK. Tras publicar el backend, cerrar y abrir la app vuelve a realizar el preflight; no se necesita reinstalar ni borrar los datos.

## Verificación

- `node scripts/mobile_cors_check.cjs`: servidor HTTP local, configuración real de Capacitor, preflight JSON/Authorization, POST sintético, orígenes web/escritorio y middleware real de autenticación (401 sin token). Rechaza variantes HTTP, otro puerto, IP, sufijos ajenos, `null` y sitios no autorizados.
- La prueba está incluida en `npm run security:regression` y CI. `npm run check` conserva la batería de operaciones.
- `node scripts/deploy_smoke_check.js`, con URLs de la web/API publicadas y sin `DEPLOY_SMOKE_USER`/`DEPLOY_SMOKE_PASSWORD`: verifica el origen Android, preflight 204 y pedidos 401 con cabecera CORS, sin escribir datos ni realizar intentos de acceso con claves.
- Para la validación de seguridad desplegada: `SECURITY_ALLOWED_ORIGIN=https://localhost`, `SECURITY_BASE_URL=https://transgest.app`, `SECURITY_API_URL=https://api.transgest.app`, `node scripts/security_check.js`.

La evidencia HTTP no sustituye la comprobación final en el teléfono del usuario, al que no hay conexión de depuración. Si persistiera un error distinto tras reabrir, se necesita su texto exacto; no se atribuye por defecto a Play ni Firebase.
