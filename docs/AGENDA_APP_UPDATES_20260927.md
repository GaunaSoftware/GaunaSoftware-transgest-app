# Agenda personal, novedades y actualización de Android

## Alcance y comportamiento

Rama aislada `codex/agenda-and-app-updates`, base `2af012d`. Se conserva el checkout ajeno. El usuario ha autorizado continuar publicando en live; esta entrega no crea instancias de ensayo alojadas ni clones de producción.

- Agenda conserva sus reuniones, llamadas, tareas, responsables, visibilidad, estados y aplazamientos. La vista principal solicita `origen=manual`; no borra incidencias ni históricos. Los demás consumidores de la API mantienen el contrato anterior si no pasan ese parámetro. Los resúmenes al iniciar sesión también consultan tareas manuales.
- «Configurar agenda» guarda las categorías elegidas por usuario y empresa en el servidor. Por defecto ninguna: solo calendario. Hay sugerencias según el perfil, limitadas por los permisos actuales. Los avisos se presentan en un bloque plegable separado, con hasta 20 resultados y acceso a Avisos para el conjunto completo.
- Las incidencias de pedidos existentes se consultan en Avisos → Tráfico y pedidos. Se conserva su resolución automática por causa y sus enlaces al pedido. Facturas, vehículos, conductores y plataformas reutilizan el centro de avisos existente. Un aviso de factura abre su factura, no un listado genérico.
- El Dashboard distingue «Mi agenda de hoy» de «Cargas y descargas de hoy». Se conserva la asignación del proveedor en la operativa.
- Las referencias de usuario, pedido y vehículo de una tarea se validan contra la empresa en el servidor, así como inicio/finalización.
- Novedades muestra un catálogo editorial en lenguaje de usuario, filtrado por permisos/rol. «Ahora no» cierra esta sesión; «No mostrar más esta actualización» persiste el identificador de la actualización para la cuenta, independientemente del dispositivo o empresa activa. Una novedad posterior tiene un identificador nuevo. No se usan decisiones de localStorage para esta preferencia. La respuesta lleva `Cache-Control: private, no-store`.

## Android y web

Android 1.3.0 / código 5 incorpora `@capgo/capacitor-updater` 8.51.25, MPL-2.0, autohospedado. No se contrata Capgo Cloud. URLs de estadísticas, canales y actualizaciones del proveedor vacías, modo automático del proveedor desactivado. El puente nativo se registra directamente, sin cargar su implementación web ni sus modificaciones del historial.

Cada build de producción de Vercel genera `app-version.json` y un ZIP de activos con `mobile-updates/latest.json`. JSZip ya se utiliza en el backend; se reutiliza la misma biblioteca para empaquetar en frontend. El APK consulta únicamente `https://transgest.app/mobile-updates/latest.json` por HTTPS. Valida aplicación, formato, tamaño máximo, revisión, huella nativa y URL exacta; el plugin verifica SHA-256 del ZIP antes de instalar. No son paquetes firmados con una clave OTA independiente: la confianza procede del dominio HTTPS y de la cuenta de despliegue. No se carga un `server.url` remoto en Capacitor.

La huella incorpora versiones de plugins, configuración y fuentes Android. Una combinación nativa distinta no recibe ese paquete web. La actualización queda preparada para reiniciar completamente la app, sin recargar al abrir la cámara, firmar o pasar temporalmente a segundo plano. Se confirma la salud cuando React ha montado; si no lo hace, el plugin revierte al paquete funcional anterior. Un paquete marcado fallido no se reinstala en bucle. Un fallo de red conserva la versión instalada.

**Es necesario instalar una vez este nuevo APK sobre el anterior.** Los APK 1.2.x no contenían actualizador. Después reciben cambios compatibles de interfaz/lógica web. Cambios de plugins, permisos, SDK o código Java siguen requiriendo nuevo APK o actualización por Google Play. No hay todavía publicación en Play ni validación en un teléfono físico conectado.

La web obtiene archivos actuales al abrirla. Una pestaña que lleva tiempo abierta comprueba nuevas versiones y ofrece «Actualizar ahora», sin forzar la pérdida de formularios. Si hay acciones sin sincronizar se impide esa recarga. Los fallos de fragmentos de una versión antigua explican que hay que recargar o comprobar la conexión.

## Proceso obligatorio de publicación

1. Mantener `transgest-backend/src/data/productReleases.json` como catálogo único. Añadir al principio un identificador nuevo, fecha, título, introducción y mejoras entendibles. Conservar entradas previas para versiones de la app todavía instaladas. No copiar mensajes técnicos de Git ni incluir datos de clientes.
2. CI `check_release_notes.cjs` exige una entrada nueva si una PR cambia código de producto respecto a su base. Cada compilación prepara la identidad de la versión. No compilar y ejecutar `pretest` simultáneamente en el mismo directorio, porque ambos preparan esa identidad.
3. Ejecutar regresiones, build y comprobación ZIP. Publicar solo tras CI correcto. Vercel publica manifiesto y paquete en el mismo despliegue, con manifiestos sin caché y ZIP inmutable por hash. Los previews no publican paquetes OTA salvo bandera de ensayo local explícita.
4. Comprobar `/health`, esquema listo, `/app-version.json`, manifiesto y descarga ZIP; confirmar que la revisión publicada coincide. En Android probar inicio conectado/desconectado, reinicio con actualización, compatibilidad y firma del APK.

## Migración y reversión

`20260930_user_experience_preferences.sql` añade dos tablas pequeñas: `agenda_preferences` y `user_release_acknowledgements`. Claves por usuario/empresa o usuario/actualización; sin reescribir datos de negocio. Aplicada dos veces en PostgreSQL sintético (PGlite), sin efectos destructivos. Se aplica mediante el mecanismo de migraciones del servicio antes del arranque. No se restaura una copia en el disco productivo.

Revertir API/web conjuntamente a la revisión anterior conservando las tablas. El frontend anterior ignora estas preferencias. Para revertir una OTA ya descargada, publicar los activos funcionales anteriores con la misma huella compatible y una identidad de compilación nueva; conservar el aviso editorial correcto. Cambiar únicamente el código backend no revierte un paquete ya instalado. La reversión automática nativa cubre fallo de arranque, no todas las regresiones de negocio.

## Evidencia de validación

- `npm run agenda:regression`: aprobado; ciclo de incidencias, historial, SQL real, migración repetida, cuenta entre sesiones, dos empresas, permisos revocados, referencias ajenas rechazadas, fechas y consulta HTTP real del calendario manual.
- `node scripts/notice_center_check.cjs`: aprobado; documentos, facturas, permisos, fechas Madrid y lectura de avisos.
- `npm run check`: aprobado con permisos para subprocesos locales. El primer intento quedó bloqueado por `EPERM` de Windows al lanzar la prueba de fechas; no era un fallo funcional.
- `npm run security:regression`: aprobado; HTTP, autenticación, CORS móvil, tenant, SQL, SMTP local y secretos. Sin envíos externos.
- Frontend: 75 suites / 188 pruebas aprobadas, incluidas preferencias de agenda, fallo al guardar, descartes entre sesiones/cuentas, manifiestos incompatibles, checksum fallido, reinicio diferido y paquete anteriormente fallido.
- ZIP: comprobación de hash y tamaño, `index.html`, referencias a activos y exclusión de fuentes/mapas, datos QA y ZIP anidados.
- Primera compilación Gradle con plugin: `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug`, aprobada, 493 tareas. El primer intento offline carecía de dependencias Android nuevas; descargadas de repositorios oficiales y compiladas después.
- Navegador local con datos sintéticos identificados: novedades, descarte persistido, configuración de avisos y navegación de agenda. Vista 390 px sin desbordamiento de página. El calendario semanal mantiene su desplazamiento interno y la vista inicial móvil pasa a día.
- Limitaciones: no se acredita OTA extremo a extremo en teléfono físico ni Google Play; la firma de distribución comercial continúa pendiente del titular. Persisten advertencias de herramientas y dependencias anteriores, sin aplicar actualizaciones mayores indiscriminadas.

El resultado final de despliegue y la identificación del APK se consignan al verificarlos.
