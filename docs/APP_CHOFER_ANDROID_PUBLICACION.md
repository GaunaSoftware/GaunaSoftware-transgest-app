# App del chófer: Android y publicación

## Estado de esta entrega

La app web comparte el código de la app Android. Se han preparado el proyecto Capacitor, el botón Atrás, compartir documentos, apertura nativa de enlaces, permisos de ubicación en primer plano y configuración de firma por variables de entorno. La navegación, formularios y reglas de jornada se comprueban con pruebas locales y navegador.

No se ha generado ni firmado un APK/AAB en este equipo: faltan Android Studio, Android SDK y la clave de firma. Tampoco se ha probado todavía en un teléfono físico. La sincronización de Capacitor no equivale a compilar una aplicación Android.

## Preparar el equipo

1. Instala Node.js 22 o posterior y Android Studio Otter 2025.2.1 o posterior. En el gestor SDK instala Android SDK Platform 36, sus herramientas de compilación y Platform Tools. Usa el JDK de Android Studio para Gradle. Son los requisitos de [Capacitor 8](https://capacitorjs.com/docs/updating/8-0).
2. Abre una terminal en `transgest-bloque6-backend/transgest-frontend` y ejecuta `npm ci`.
3. Para la nube, ejecuta `npm run mobile:android:prepare`. El código utiliza `https://api.transgest.app` por defecto. Si se prepara una instalación diferente, define `REACT_APP_API_URL` con su API HTTPS **antes** de compilar. No introduzcas claves SMTP, IA ni secretos del servidor en variables `REACT_APP_*`.
4. Ejecuta `npm run mobile:open:android`. Espera a que termine la sincronización de Gradle. No cambies el identificador `com.gaunasoftware.transgest` si ya hay una aplicación publicada con ese identificador.

## Prueba antes de distribuir

Conecta un móvil Android con depuración USB y pulsa Run en Android Studio. Comprueba con una cuenta de pruebas:

- Login, cerrar sesión y cambiar de empresa sin conservar datos de la anterior.
- Abrir jornada confirmando tractora/remolque y kilómetros. El cierre con la misma lectura debe rechazarse; con un incremento de al menos 1 km, aceptarse.
- Jornada cerrada: consultar documentación permitido; iniciar o avanzar un viaje bloqueado para chóferes internos.
- Crear viaje desde el catálogo de clientes y sus puntos, avanzar por el formulario, generar y abrir el DCD, QR y compartir.
- Cámara/archivos, firma, albarán y permisos de ubicación: aceptar, denegar y reintentar.
- Progreso de cargas/descargas y colores del mapa. Ubicación externa reciente; si falta, ubicación de la app con permiso y en primer plano.
- Modo avión, recuperar conexión y sincronizar únicamente los pendientes del usuario original.
- Atrás en cada paso del formulario, detalle del viaje y secciones; rotación, teclado y barra inferior.
- Avisos, historial, datos personales, taller y vacaciones según permisos. Los conductores externos no deben acceder a funciones laborales internas.

El seguimiento de la app es en **primer plano**; no hay servicio de localización en segundo plano ni notificaciones push añadidas en esta entrega. La ubicación externa requiere un proveedor conectado que envíe posiciones recientes. Las pantallas de tiempos conservan el asistente existente y no sustituyen al tacógrafo.

## Generar el archivo para Google Play

1. En Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle**. Crea o selecciona la clave de subida. Guarda una copia segura del almacén de claves y sus contraseñas fuera del repositorio.
2. Para compilaciones automatizadas, `android/app/build.gradle` admite `TRANSGEST_ANDROID_KEYSTORE` (ruta absoluta), `TRANSGEST_ANDROID_STORE_PASSWORD`, `TRANSGEST_ANDROID_KEY_ALIAS` y `TRANSGEST_ANDROID_KEY_PASSWORD`. Configúralas como secretos del entorno de compilación; nunca las guardes en Git.
3. Define `TRANSGEST_ANDROID_VERSION_CODE` con un entero superior al último publicado y `TRANSGEST_ANDROID_VERSION_NAME` con la versión visible. Los valores iniciales preparados son `2` y `1.1.0`; contrástalos con Play Console si ya existe una publicación.
4. Compila la variante release. En terminal, desde `android`: `./gradlew.bat bundleRelease`. Con las variables de firma configuradas se genera el AAB firmado en `app/build/outputs/bundle/release/app-release.aab`. Sin firma no es un archivo listo para publicar. Google explica el [proceso de subida del bundle](https://developer.android.com/studio/publish/upload-bundle).

## Subir y actualizar

1. En Google Play Console crea la aplicación o abre la existente. Completa nombre, ficha, icono, capturas, contacto, política de privacidad, acceso para revisión, clasificación y declaraciones de datos/permisos según el funcionamiento real. Sigue la [configuración oficial de Play Console](https://support.google.com/googleplay/android-developer/answer/9859152).
2. Publica primero el AAB en una pista de pruebas internas, añade probadores y repite el circuito anterior desde la instalación de Google Play. Atiende los requisitos de prueba que Play Console indique para tu cuenta.
3. Si todo funciona, crea la versión de producción y envíala a revisión. Su aprobación depende de Google.
4. Cada actualización de interfaz nativa requiere reconstruir los archivos web, sincronizar Capacitor, aumentar `versionCode`, firmar con la misma identidad y subir un AAB nuevo. Las actualizaciones del backend llegan desde el servidor; los archivos web incluidos en el APK no se actualizan por desplegar la web.

## Correo de colaboradores

Configura y prueba el SMTP de la empresa para enviar desde su propia dirección. Si no tiene SMTP utilizable, se utiliza el remitente de plataforma, con el correo de empresa como Reply-To si está disponible. Tener solamente una dirección escrita en la ficha no autoriza a enviar desde ella. El logo corporativo debe estar guardado en PNG/JPEG; el logo TransGest va incluido. La entrega real depende también del proveedor SMTP y de la configuración del dominio.
