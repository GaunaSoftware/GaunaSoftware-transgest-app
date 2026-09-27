# Chófer, pedidos y preparación del correo — 27/09/2026

## Alcance

Cambios sobre `208699f`, en `codex/driver-inbox-workflow-fixes`, conservando el checkout ajeno. El usuario mantiene la autorización para publicar correcciones en live. No se crean instancias alojadas ni clones de la base productiva. La agenda se analiza, pero **no se modifica**, por petición expresa.

## Cambios de comportamiento

- Chófer: «Abrir mapas · próxima parada» navega al próximo punto operativo pendiente, usando coordenadas válidas o su dirección. El navegador de mapas resuelve el origen actual; ya no se usa la posición del chófer como destino. Se conserva el mapa interno. Sin destino válido o sin progreso cargado se informa y no se inventa una ruta.
- Se retiran «Mi ubicación» y «Variación». Al confirmar la mercancía, una diferencia respecto al peso de tráfico pide escribir `confirmo`. Se conserva el peso previsto antes de sustituir los totales por los reales y se registra diferencia, confirmación y fecha en el progreso/auditoría existentes. No cambia el pedido a incidencia. En varias cargas, sin peso previsto por punto no se compara contra el total de todo el viaje.
- «Foto de la mercancía» aparece tras finalizar una carga según sus eventos, no solo por el estado general del pedido. El aviso de incidencia real se conserva.
- Pedidos: al pasar a en curso en otra fecha se puede conservar la fecha original, registrar la carga de hoy o cancelar. Conservar no fabrica una hora de carga observada. El servidor conserva la confirmación antigua para clientes anteriores; los eventos reales del chófer mantienen su marca temporal.
- Se retira el acceso visible «Pedido rápido». «Bandeja IA» abre exclusivamente la bandeja existente, con su revisión humana; la planificación conserva su navegación independiente.

## Configurar el correo cuando se conozcan los datos

Gerencia dispone de **Configuración → Mi empresa → Correo / Bandeja IA**. El envío SMTP está separado de la recepción IMAP. No se ha conectado ningún buzón real ni enviado pruebas de correo en esta tarea.

1. Introducir servidor SMTP, puerto cifrado, usuario, clave autorizada, remitente y, si procede, correo de respuesta. Guardar y enviar una prueba a un destinatario elegido expresamente. La prueba exige el SMTP de esa empresa; no presenta como éxito un correo simulado o enviado por la plataforma.
2. En Pro Intelligence, guardar los datos de recepción: dirección del buzón, proveedor, servidor IMAP, usuario, contraseña de aplicación y carpeta. Puede guardarse incompleto y desactivado.
3. Probar la conexión. La primera prueba fija el punto de inicio sin importar correos históricos. Activar después expresamente. Se recomienda una carpeta dedicada a pedidos.
4. Se comprueba cada cinco minutos; «Recoger correos ahora» permite solicitarlo. Se leen nuevos mensajes sin borrarlos ni marcarlos leídos. Cada pasada avanza como máximo 40 identificadores UID; un mensaje debe ocupar como máximo 6 MB. Si uno excede el límite, se detiene en él y explica cómo dividir/subir sus adjuntos y apartarlo de la carpeta para continuar.
5. Los mensajes quedan en Pedidos → Bandeja IA. El análisis y la creación siguen requiriendo revisión; la recepción no consume IA ni crea pedidos por sí sola.

La implementación utiliza IMAP TLS/993 mediante `imapflow` 2.1.0 (MIT) y reutiliza mailparser, la bandeja cifrada y el SMTP existentes. No incluye todavía OAuth de Microsoft/Google: si el proveedor exige ese método, mantener desactivado y completar su conexión cuando se conozca el proveedor. No se promete compatibilidad real de un buzón que todavía no se ha facilitado. Se pueden seguir subiendo EML y adjuntos manualmente.

Las claves se cifran con el servicio existente, nunca se devuelven al navegador ni se guardan en localStorage. Configuración y logs se limitan a la empresa autenticada. Configurar/recoger exige gerente, plan IA y módulos autorizados. El servidor valida DNS/IP públicos, TLS y tiempos máximos. Una concesión temporal en base evita sincronizaciones concurrentes; Message-ID/contenido evitan repetir entradas. Cambiar datos desactiva la recepción y exige verificar de nuevo. Si el buzón cambia sus identificadores, se detiene y solicita nuevo inicio explícito.

## Agenda: propuesta pendiente de aprobación

El modelo actual ya permite reuniones, llamadas, tareas asignadas al equipo, recordatorios y visibilidad personal/equipo. Conviene reutilizarlo: agenda centrada por defecto en esos eventos, avisos automáticos en Avisos con acceso al pedido, factura o ficha correspondiente. Como opción posterior, capas de avisos según preferencias y permisos: cargas/descargas para tráfico, vencidos para contabilidad y resumen para gerencia. Activar una capa no concedería nuevos permisos. No se han cambiado ni el calendario ni sus avisos en esta entrega.

## Pruebas reales ejecutadas

- `node scripts/driver_workflow_fixes_check.cjs`: aprobado; fechas Europe/Madrid/cambio horario, conservar/hoy/cancelación inválida, compatibilidad anterior, protección de eventos reales del chófer, variación confirmada, peso previsto y varias cargas sin base comparable.
- `node scripts/order_mailbox_check.cjs`: aprobado con PGlite y servidor IMAP simulado; borrador incompleto, activación explícita, cifrado, cursor inicial, lectura acotada, duplicados, aislamiento A/B, plan, concesiones, mensaje grande, reinicio de identificadores y migración idempotente.
- `node scripts/order_mailbox_http_check.cjs`: aprobado con autenticación/red sintéticas y middleware real de rol/plan; anónimo/chófer/Go rechazados, gerente autorizado, suplantación por parámetros ignorada, no-store, logs por empresa y sin falso éxito SMTP.
- `npm run driver:regression`, `npm run ai:regression`, `npm run security:regression`, `node scripts/fiscal_accounting_regression_check.js`: aprobados.
- Backend `npm run check`: aprobado (salida 0). Primer intento en sandbox Windows falló por `spawnSync node EPERM`; el mismo comando autorizado fuera del sandbox pasó. Incluye regresiones existentes de BI, tráfico, facturación, importación, documentos, Planner y chófer. Tras el último ajuste de bloqueo IMAP se repitieron sus pruebas de servicio y HTTP: aprobadas.
- Frontend `CI=true npm test -- --watchAll=false --runInBand`: **72 suites, 179 pruebas aprobadas**, incluidas las nuevas de mapa/fotos/peso, configuración de correo y las tres opciones de confirmación.
- `npm run build` y `CI=false GENERATE_SOURCEMAP=false npm run mobile:android:prepare`: aprobados. Permanecen advertencias de lint y dependencia dinámica anteriores; no se han ocultado errores. El preflight confirma API HTTPS, SDK 36 y activos sincronizados.
- Navegador local con empresa sintética identificada: configuración accesible para gerente, estados pendientes/botones coherentes, revisión visual a 390 y 1440 px, sin desbordamiento horizontal; diseño con componentes y tema actuales. No se probó cámara/GPS ni navegación física de Android.

## Verifacti: ensayo externo

Prueba exclusiva con clave de TEST facilitada y NIF de ensayo B75777847, Empresa de prueba SL. Se verificó la identidad/entorno antes de emitir una factura sintética de 100 + 21 = 121 euros sin operación comercial. UUID `c6c325f9-5451-4ba8-abb1-905e9c3031ab`: aceptado; XML oficial recuperado; repetición idempotente devuelve el mismo UUID. No se cambió la configuración fiscal de clientes ni se creó una factura en la base de TransGest.

`scripts/verifacti_sandbox_workflow.cjs` es una herramienta manual, ajena a CI, que exige clave TEST e identidad esperada, conserva el intento antes del envío y reconcilia sin reemitir. La clave no se guarda en Git ni en el informe. Evidencia privada: `outputs/driver-inbox-fixes/verifacti-synthetic-report.json`. Esto valida ese flujo sintético; no acredita todos los casos fiscales ni una configuración de producción.

Referencias utilizadas: [documentación Verifacti](https://www.verifacti.com/docs), [IMAPFlow](https://imapflow.com/docs/api/imapflow-client/), [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).

## Migración, Android y reversión

Migración aditiva `20260928_company_order_mailbox.sql`: tabla de configuración por empresa, vacía y desactivada de origen. No modifica facturas, pedidos históricos ni correos anteriores. La prueba aplica el SQL dos veces. Se ejecuta con el mecanismo de migraciones existente antes del arranque del servicio. No se restaura una copia de seguridad en el disco de producción.

Android pasa a 1.2.1, versionCode 4. La web se incluye en el APK: hay que actualizar el paquete instalado para recibir las nuevas pantallas y la confirmación escrita de peso que exige el servidor. No se declara una publicación en Google Play; cuenta, firma comercial y revisión siguen pendientes del titular. El APK de esta entrega es de pruebas y conserva la firma de desarrollo anterior cuando se verifique su certificado.

Para revertir un problema de correo, desactivar la recepción de la empresa; conservar tabla, claves, cursor y entradas. Volver al código anterior no exige borrar la tabla aditiva. Conservar auditorías/pesos ya registrados. Revertir solo el frontend después de exigir confirmación escrita puede impedir registrar diferencias desde APK anteriores: coordinar las versiones o corregir hacia delante.

Gradle `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug --offline --no-daemon --max-workers=2`: aprobado en 3 min 35 s; 453 tareas, 51 ejecutadas, 402 actualizadas; lint conserva 17 advertencias. `apksigner verify` confirma firma válida y mismo certificado SHA256 que el APK 1.2.0 entregado anteriormente. `aapt dump badging` confirma versión 1.2.1/código 4, SDK mínimo 24 y destino 36. Permite actualizar aquella instalación sin desinstalarla.

Artefacto privado: `outputs/driver-inbox-fixes/TransGest-1.2.1-android-pruebas.apk`, SHA256 `9281360d65251039d58274b2ff083a5eb69ad36a365083ade561041a87043bed`. No se versionan binarios de compilación ni claves. No hay un teléfono físico conectado para comprobar la navegación final en Google Maps.

El resultado del despliegue se consigna tras comprobarlo; la compilación local no se considera prueba de publicación.
