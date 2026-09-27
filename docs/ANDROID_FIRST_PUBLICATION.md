# Primera publicación Android de TransGest

27/09/2026. El titular confirma que todavía no tiene cuenta de Google Play ni clave de subida. Este documento es la guía vigente; `APP_CHOFER_ANDROID_PUBLICACION.md` conserva el historial anterior.

## Preparado en el repositorio

- Aplicación Capacitor `com.gaunasoftware.transgest`, Android 7+ (API 24), destino Android 16/API 36.
- Código web incluido en la aplicación y API HTTPS de TransGest. No se carga un servidor de desarrollo remoto.
- Cámara, documentos privados, navegación, jornada, cambios de conjunto, seguimiento foreground y avisos según permisos actuales.
- Seguimiento iniciado expresamente, notificación persistente, parada y caducidad de autorización. No solicita ubicación permanente.
- Comprobación `scripts/mobile_android_preflight.cjs`: identidad, servidor, permisos y activos sincronizados. CI exige firma; no presenta un AAB sin firma como publicable.
- Push opcional: no funciona hasta configurar Firebase Android y la credencial FCM del servidor. Sin Firebase se conservan los avisos dentro del programa.

## Lo que debe hacer el titular

1. Crear la cuenta en [Google Play Console](https://play.google.com/console/signup). Elegir el tipo de cuenta que corresponda al titular real, completar identificación, verificaciones y pago de registro. Esos pasos y la aceptación de condiciones debe hacerlos el titular. No compartir contraseñas por chat.
2. Crear la aplicación TransGest, idioma español. Conservar el identificador `com.gaunasoftware.transgest`.
3. Aprobar y alojar una política de privacidad real: responsable, contacto, ubicación, fotos/documentos, finalidades, conservación, encargados y derechos. No inventar esos datos. Completar Data Safety, clasificación, declaración del servicio foreground de ubicación y acceso para revisión. Facilitar a Google una cuenta limitada para revisar la app, sin datos reales de clientes.
4. Crear la clave de subida en Android Studio: Build → Generate Signed Bundle / APK → Android App Bundle → Create new. Guardar el `.jks` y sus contraseñas en un gestor/almacén seguro y conservar una copia independiente. No guardarlos en Git ni enviarlos por chat. Activar Play App Signing en el flujo de Google.
5. Configurar los secretos del entorno GitHub `android-release`: `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Si se desea push, añadir `ANDROID_GOOGLE_SERVICES_BASE64` del proyecto Firebase que registre ese mismo identificador; configurar el servidor conforme a `TMS_EVOLUTION_PHASE7_ANDROID.md`.
6. Ejecutar Actions → Android release con versionCode `3` y versión `1.2.0` para esta primera publicación (si se sube otra antes, usar un código mayor). Descargar el artefacto privado de CI antes de su caducidad de siete días. Un archivo etiquetado UNSIGNED o debug no se sube a Play.
7. Subir el AAB firmado primero a la pista interna. Probar con Android real: permisos aceptados/denegados, cámara/recorte, firmas, jornada, conjunto, viaje multiparada, pantalla apagada, batería, modo avión, cierre remoto, PDF, notificaciones y cambio de cuenta. Guardar evidencia y corregir antes de solicitar producción.
8. Completar icono, capturas y ficha con funciones realmente habilitadas; enviar a revisión. La aprobación y posibles pruebas adicionales dependen de Google y del tipo de cuenta.

Google exige [API 36 para nuevas apps y actualizaciones](https://support.google.com/googleplay/android-developer/answer/11926878?hl=es). Las [cuentas personales nuevas](https://support.google.com/googleplay/android-developer/answer/14151465) requieren una prueba cerrada con al menos 12 probadores durante 14 días consecutivos antes de solicitar acceso a producción. No se promete publicación inmediata.

## Comandos de compilación

Desde `transgest-bloque6-backend/transgest-frontend`, con Node 22+, JDK 21, SDK 36 y las herramientas Android instaladas:

```powershell
npm ci
$env:CI='false'
$env:GENERATE_SOURCEMAP='false'
npm run mobile:android:prepare
cd android
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:bundleRelease --no-daemon
```

Las variables de firma local son `TRANSGEST_ANDROID_KEYSTORE`, `TRANSGEST_ANDROID_STORE_PASSWORD`, `TRANSGEST_ANDROID_KEY_ALIAS` y `TRANSGEST_ANDROID_KEY_PASSWORD`. Para exigir firma también localmente: `TRANSGEST_ANDROID_REQUIRE_SIGNING=true`. Las contraseñas no se escriben literalmente en comandos guardados o historial.

`app/build/outputs/apk/debug/app-debug.apk` permite una prueba por USB; está firmado con clave de desarrollo, no es la versión comercial. `app/build/outputs/bundle/release/app-release.aab` requiere comprobar la firma con `jarsigner -verify` antes de entregar a Play. Cada actualización nativa requiere reconstruir, incrementar versionCode, firmar y volver a subir; desplegar la web no actualiza el paquete instalado.

## Pendientes externos

Cuenta, identidad de publicación, política aprobada, clave de subida, dispositivo físico y aceptación de Google. Firebase solo si se activa push. No se ha publicado ni enviado una app a Google desde esta tarea.
