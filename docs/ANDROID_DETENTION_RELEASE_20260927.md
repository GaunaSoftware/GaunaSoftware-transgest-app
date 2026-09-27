# Android, paralizaciones y publicación del 27/09/2026

## Alcance y autorización

El usuario autoriza terminar Android, preparar prefacturas de paralización sin IVA, desplegar los PR pendientes y ampliar PostgreSQL si el fallo es de capacidad. Confirma primera publicación, sin cuenta Play ni clave. Esta autorización posterior sustituye la prohibición anterior de aumentar almacenamiento. Se conserva el trabajo ajeno y no se crean instancias de ensayo alojadas ni clones sobre producción.

## Cambios

- Pedido → Paralización / prefactura: intervalo real, causa, cálculo en servidor y PDF privado enlazado al viaje. Referencia legal, primera hora excluida, 10 horas por periodo, incrementos de días sucesivos e IPREM verificado. Acuerdo superior explícito. La propuesta no constituye ingreso aceptado ni factura fiscal; se documenta y revisa en el flujo existente antes de facturar. No se modifican facturas históricas.
- Android: preflight de identidad, HTTPS, permisos y activos; CI exige firma. Compilación SDK 36 con app web incluida. Guía del titular en `ANDROID_FIRST_PUBLICATION.md`. No se genera una clave comercial sin su custodia ni se publica automáticamente.
- Integración del PR fiscal #15 sobre las protecciones actuales: se conservan claim/lease antes de llamadas externas, claves anteriores, ventana segura, bloqueo de estados finales e identidad fiscal. QR oficial tardío se conserva sin reemitir; reconciliación de respuesta perdida y bandeja contable ordenada. XML oficial por factura; se retira el botón obsoleto de lote interno.
- Clavei API sigue explícitamente no disponible hasta recibir contrato real. XML requiere códigos confirmados de la instalación. Retenciones IRPF continúan bloqueadas en envío Verifacti hasta validar ese contrato; no se elimina la protección existente para satisfacer una prueba antigua.

## Pruebas y resultados reales

- Backend `npm run check`: aprobado, salida 0. Windows bloqueó inicialmente spawn con EPERM; el mismo comando autorizado fuera del sandbox pasó. Incluye BI, rutas, pedidos, documentos, permisos, estructura, Planner y chófer.
- `node scripts/detention_quote_check.cjs`: 17 comprobaciones aprobadas, incluyendo Madrid/cambio horario, importes, periodo y datos inválidos.
- `node scripts/fiscal_accounting_regression_check.js`: aprobado. QR tardío, originales, XML normal/abono, retención no admitida, HMAC, idempotencia, respuesta perdida, aislamiento y exportación ordenada.
- `node scripts/audit_connectors_check.cjs`: aprobado, respuestas remotas simuladas; no se enviaron mensajes ni facturas reales.
- `CI=true npm test -- --watchAll=false --runInBand`: 67 suites / 167 pruebas aprobadas. Primer pase: una prueba buscaba el nombre anterior del botón; se actualizó al rótulo visible.
- `CI=false GENERATE_SOURCEMAP=false npm run mobile:android:prepare`: aprobado, preflight y sincronización Android. Limitación local de trabajadores, sin añadirla al producto. Advertencias de lint existentes.
- Gradle `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:bundleRelease --offline --no-daemon --max-workers=2`: aprobado; lint 0 errores y 17 advertencias (recursos/iconos). AAB sin firma de publicación y APK debug; no son una publicación en Play.
- Auditoría HTTP en PostgreSQL local: 141 comprobaciones principales y subbaterías, incluidas 44 operativas y 26 fiscales. 70 migraciones aplicadas, segunda ejecución intacta; cero errores de esquema. Copia/restauración sintética de 199 tablas / 860 filas verificada por huellas. Un fixture horario justo en un límite de minuto produjo 9 frente a 10; se desplazó 30 segundos dentro del minuto sin cambiar el cálculo real.
- PDF sintético generado con PDFKit, renderizado con Poppler e inspeccionado: una página A4, tildes/ñ/€, filas y avisos legibles. Ejemplo local `output/pdf/prefactura-paralizacion-sintetica.pdf` (no se versionan datos de ensayo).
- Navegador local: acceso sintético, pedido y prefactura en componentes comunes; formulario a 390/768/1440/1920 px sin desbordamiento horizontal (390,4 por redondeo; anchos de modal 720/840/840 en los restantes). El control automatizado no logró completar el selector nativo datetime-local; cálculo/guardado/PDF sí comprobados por API y pruebas de React. No se afirma validación manual completa del selector en iPhone/Android.
- `adb devices`: ningún dispositivo conectado. Cámara física, GPS foreground/batería, permisos y push requieren teléfono real.

## Infraestructura

PostgreSQL Render estaba suspendido por almacenamiento. Se reanudó y amplió de 1 a 5 GB (mínimo admitido), conservando Basic-256mb, CPU y memoria. Precio mostrado: almacenamiento 1,50 USD/mes; total 7,50 USD/mes; incremento aproximado 1,20 USD/mes. No se puede reducir después. API HTTP 200, schema ready/db connected a las 15:41 UTC, release previo 365028b. Métricas Render todavía no ofrecían mediciones del nuevo disco; no se inventa porcentaje libre.

La copia previa se solicita con Recovery → Create export de Render, sin restaurarla en el disco compartido. La restauración verificada arriba es únicamente local y sintética.

## Compatibilidad y reversión

Migraciones aditivas 022_fiscal_accounting_delivery y 20260929_detention_prefacturas, además de las ya documentadas en los PR #27–29. No se rellenan históricos. Preservar tablas, snapshots, auditorías y claves incluso al volver a un código anterior. Tras uso de prefacturas/solicitudes fiscales no permitir que una versión anterior edite esos registros; preferir corrección hacia delante. No borrar ni repetir envíos contables para recuperar una operación incierta.

## Pendientes del titular

Cuenta y verificación Play, política de privacidad aprobada, clave custodiada/secretos de CI, ficha, cuenta limitada para revisión y prueba física. Firebase es opcional; sin él se mantienen avisos internos pero no push. No se afirma publicación Android ni validación fiscal externa real.

## Estado del despliegue

Pendiente de registrar el resultado real de la fusión y de los despliegues, no inferirlo de un push.


### Cierre de regresiones tras integración

`npm run security:regression` y `npm run audit:regression`: aprobados con salida 0. CI inicial detectó un esquema mínimo de seguridad sin `provider_uuid`; se actualizó al campo aditivo real. La auditoría de combustible detectó que dos identificadores ausentes se comparaban como una coincidencia de paralización: se exige enlace explícito y se rechaza un importe de paralización sin identidad de pedido. Los tests existentes de combustible individual/agrupado/PDF y los nuevos fiscales pasan. No se deshabilitó ninguna comprobación.

Artefactos locales (no versionados): APK debug SHA256 `10395fb4e7c6f08033754b0bf9e4e97d4955715d31ea22925f3bcb6f5ec0d727`; AAB sin firma SHA256 `938d6f9552f2762e8f24d95a228de0b1e46b286bb52411843bde9ec05c81cb40`. `jarsigner -verify` confirma expresamente que el AAB no está firmado. Último Gradle: BUILD SUCCESSFUL, 844 tareas (77 ejecutadas, 767 actualizadas). Las pruebas nativas sin cambios reutilizan los resultados de Gradle; no equivalen a ejecutar en un teléfono.
