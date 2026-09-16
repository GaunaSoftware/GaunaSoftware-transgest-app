# Propuesta separada: sesiones y recuperación de copias

Diseño para revisar y validar; no implementado en el PR de MapLibre.

## Sesiones

Propuesta: una sesión opaca revocable en el servidor para la web, con cookie host-only `HttpOnly; Secure; SameSite=Lax; Path=/`, duración limitada y rotación al entrar o elevar privilegios. Mantener separados los dominios de autenticación de usuario, SuperAdmin y SSO. La cookie HttpOnly no se puede leer desde JavaScript, pero un XSS puede seguir realizando peticiones con ella; no sustituye corregir XSS. [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

Las mutaciones exigirían un token CSRF ligado a sesión, Origin validado y métodos correctos; CORS con lista concreta y credenciales. Logout y reset revocarían sesiones; no borrar `tms_token` hasta validar la sesión nueva. El despliegue sería por cohortes con una ventana de compatibilidad limitada, sin que un fallo de autenticación por cookie permita recurrir silenciosamente a un token viejo.

| Entorno | Decisión y prueba antes de migrar |
|---|---|
| Web Vercel + API Render | Preferir API bajo el mismo sitio mediante proxy/dominio controlado. Probar cookies, preflight, uploads, descargas y renovación. Evitar depender de cookies de terceros |
| Portal cliente y chófer web | Mismo transporte, sesiones y permisos separados; probar aislamiento de empresa, logout y documentos |
| Capacitor Android/iOS | Verificar almacenamiento y envío de cookies en WebView y cliente HTTP nativo. Si se usa refresh token nativo, almacenarlo en Keychain/Keystore y nunca en Preferences/localStorage; access token breve en memoria |
| Electron | Proceso principal custodia refresh token, renderer aislado y API IPC mínima; evaluar safeStorage y rechazar almacenamiento inseguro cuando no esté disponible. Probar `transgest://app`, subida, impresión y links externos |
| Instalación local | HTTPS de la instancia y certificado confiable en los puestos. Definir origen estable; no desactivar Secure globalmente para resolver una instalación HTTP |
| ClaveiCon | Código de intercambio de un solo uso, corto y vinculado al destinatario, en lugar de JWT en URL; borrar código del historial tras canje |

Electron ofrece almacenamiento protegido por el sistema operativo, con condiciones que varían según plataforma; la implementación debe comprobar disponibilidad y backend. [Documentación de safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

Pruebas obligatorias: XSS no puede leer credenciales persistentes; CSRF falla; sesión revocada no renueva; rotación/reuso detectado; dos empresas y roles; múltiples pestañas; offline/reconexión; redirección desde email; actualización desde versión anterior; rollback sin aceptar tokens revocados. Publicar métricas de fallos sin registrar tokens.

## Copias cifradas y restauración

Propuesta: clave de datos aleatoria de 256 bits por copia, AES-256-GCM con nonce único y metadatos autenticados (versión de formato, identificador de copia y esquema). Clave de envoltura independiente de JWT/API/fiscal, con identificador de versión. Guardar la clave maestra fuera de la copia y del repositorio, en almacén de secretos o custodia local acordada. Conservar claves antiguas hasta agotar la retención de las copias que protegen.

Generar dump en formato custom de PostgreSQL mediante stream hacia el cifrador. Fichero temporal exclusivo, permisos Unix 0600 y directorio 0700; en Windows ACL limitada a la identidad del servicio y recuperación autorizada. Renombrar atómicamente al terminar y registrar tamaño, versión y checksum del ciphertext. No anunciar éxito antes de terminar la autenticación/cierre del stream. Retención solo sobre copias completas verificadas, sin eliminar la última recuperable al fallar una copia nueva.

Rotación: nuevas copias usan la nueva clave de envoltura; verificar recuperación con claves antiguas y nuevas antes de retirar cualquiera. La copia externa no debe depender del único equipo que contiene la clave. Definir responsable, ubicación y prueba periódica de la custodia.

Prueba de aceptación en PostgreSQL real desechable (no sustituible por probar solo AES):

1. Crear empresas A/B, relaciones, documentos, secretos de prueba, secuencias y esquema migrado; registrar recuentos y consultas de referencia.
2. `pg_dump` → cifrado → almacenamiento → nueva sesión/proceso de recuperación.
3. Verificar GCM antes de permitir que un dump descifrado se ejecute; usar temporal restringido si el formato exige acceso aleatorio. Una clave errónea o un byte modificado debe fallar antes del restore.
4. Crear base vacía separada y ejecutar `pg_restore --exit-on-error`; restaurar roles/extensiones requeridas mediante procedimiento explícito, sin usar producción como destino.
5. Comparar recuentos, relaciones, documentos, secuencias, login y descifrado de secretos; arrancar la aplicación y ejecutar smoke de lectura/escritura de prueba.
6. Repetir con clave antigua tras rotación, copia truncada, disco lleno y proceso interrumpido; retirar temporales solo dentro del directorio verificado.

El procedimiento debe fijar versiones de PostgreSQL, herramientas, extensiones y permisos. Los dumps no incluyen todos los objetos globales del clúster; el plan de recuperación debe contemplarlos. [PostgreSQL: SQL dump y restauración](https://www.postgresql.org/docs/current/backup-dump.html).

No se cambia `backup.js` hasta tener evidencia de esta cadena completa y acordar la custodia de claves. La copia actualmente existente no pasa a estar cifrada por publicar este documento.
