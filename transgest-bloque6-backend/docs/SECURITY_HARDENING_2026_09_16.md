# Seguridad: cambios y puesta en servicio

Rama: `security/hardening-2026-09-14`. PR #1 en borrador. No autoriza merge ni despliegue. La instalación mediante EXE y sus actualizaciones quedan fuera de este trabajo.

Resultado remoto verificado: los ocho jobs de [Seguridad y CI, ejecución 35113662476](https://github.com/GaunaSoftware/GaunaSoftware-transgest-app/actions/runs/35113662476) finalizaron correctamente para `ad958ecb38dc111ecfcc7e601c0d9bec58aa77f4`. Después se activó y releyó la protección de `main`: PR obligatorio, ocho checks obligatorios vinculados a GitHub Actions y rama actualizada, aplicada también a administradores, sin force-push ni borrado. No se exige una segunda persona aprobadora; sí pasar por un PR. No se modificó código de main ni se fusionó el PR.

## Implementado

- MapLibre 6.10.0, importación ESM y distribución local del worker **y de su módulo compartido**. El build y el arranque de desarrollo preparan ambos ficheros versionados. Nginx sirve `.mjs` como JavaScript. La ruta se añade cuando está disponible el estilo; no espera a todas las teselas remotas. Se conservan los colores de estado incorporados en main y los popups usan texto.
- Actualización compatible de Nodemailer/Express y dependencias transitivas mediante npm, sin `audit fix --force`. Los dos informes `npm audit --omit=dev` locales dan cero vulnerabilidades. Esto no afirma que las dependencias de desarrollo carezcan de avisos.
- Webhooks salientes: HTTPS, sin credenciales en URL, validación DNS de todas las respuestas, bloqueo de direcciones privadas/reservadas IPv4/IPv6, conexión fijada a una IP validada, validación TLS del nombre original, tiempo límite y máximo de tres redirecciones. Se rechazan redirecciones a otro origen para no reenviar cuerpos firmados a un tercero. Debe configurarse directamente la URL final del receptor.
- Contraseñas nuevas, cambios, activaciones y resets: 12 caracteres, mayúsculas/minúsculas/número, máximo 72 bytes UTF-8. El login existente no exige cambiar contraseñas legacy. Los resets de usuarios conservan el historial e invalidan sus tokens como antes. Las contraseñas temporales de usuarios y portales emplean aleatoriedad criptográfica; las demos nuevas sin contraseña indicada reciben una aleatoria.
- GPS y fiscal priorizan cabeceras. Una cabecera explícita pero inválida no permite recurrir al secreto de la URL. Logs HTTP sin consultas y redacción de credenciales en logs estructurados. Se elimina una exposición de contraseña en la auditoría de modificación de administradores.
- Claves de proveedor fiscal y webhook fiscal cifradas al guardar con el AES-256-GCM existente y `API_KEYS_ENCRYPTION_SECRET`. Las respuestas de empresa de SuperAdmin ocultan también las claves fiscales históricas. Ninguna clave fiscal se convierte en global.
- Migración versionada de tablas/índices de historial y webhooks; inventario separado de DDL runtime. Se mantienen los guardas de compatibilidad para instalaciones que aún no ejecutan todas las migraciones, pero sus errores de índice ya no se ocultan.
- Se integra main en esta rama conservando correcciones de facturación, eliminación de empresas, sesión temporal de soporte, productos Planner, estados y permisos. El wrapper de SuperAdmin sigue separado del núcleo funcional; las correcciones de main se incorporan al núcleo.

## Validación y límites

`npm run security:regression` añade pruebas SSRF, SQL real aislado (PGlite/PostgreSQL), HTTP SuperAdmin y SMTP local. Se conserva la suite anterior y se añade este comando a CI.

| Área | Prueba ejecutada |
|---|---|
| Entidades A/B | IDs reales distintos de clientes, pedidos, facturas, vehículos y conductores; lecturas cruzadas rechazadas; PATCH de cliente, PUT de imagen y borrados de cliente/factura de otra empresa |
| Facturas | POST con pedido real de otra empresa rechazado |
| Documentos/portal | Descarga privada propia válida, ajena rechazada; portal no obtiene factura ajena |
| Exportaciones | Lotes contables por empresa y borrado ajeno rechazado |
| GPS | Token A no actualiza matrícula B; token A contra empresa B rechazado; posición propia persiste |
| Claves y webhooks | Guardado separado A/B; listado y revocación de webhook ajeno rechazados |
| Fiscal | Guardado cifrado, lectura interna, respuesta enmascarada, migración dry-run/aplicación/idempotencia; UUID fiscal B invisible para A |
| ClaveiCon/SSO | Token contable usa la empresa autenticada, ignorando empresa manipulada en el cuerpo |
| SuperAdmin HTTP | Token con rol antiguo no eleva rol vigente; rol desconocido y cuenta desactivada rechazados; nueva contraseña débil rechazada |
| Correo | Servidor SMTP local, autenticación, MIME de recuperación/invitación/factura/notificación y adjunto; no se envían correos a personas |
| Mapas | Build real en Edge: ruta, worker, marcadores, popup, zoom/centrado, atribución, móvil y posición GPS al reabrir |

Las pruebas SQL invocan los handlers reales con contexto autenticado de prueba; la prueba HTTP de SuperAdmin sí atraviesa sus middlewares. No equivalen a un pentest exhaustivo de todos los endpoints ni a una prueba del proveedor SMTP, GPS o fiscal de producción. Electron y Capacitor necesitan smoke tests en sus dispositivos antes de distribuir nuevos instaladores; no se ha generado un EXE en esta entrega.

Se ejecutan además: `npm run check`, `npm run daily-plan:regression`, la comprobación estática de SuperAdmin, recuperación de permisos de gerente, borrado transaccional de empresas y productos por empresa; tests/build del frontend y sintaxis de ambos backends. Los avisos ESLint anteriores siguen pendientes de limpieza. Dos pruebas existentes se adaptan a la nueva ubicación del núcleo y a la nueva secuencia de middleware de Planner sin retirar sus aserciones.

## Preparación de despliegue

1. Revisar PR y CI; no fusionar automáticamente.
2. Mantener las claves de cifrado actuales. Confirmar que `API_KEYS_ENCRYPTION_SECRET` está disponible en todas las réplicas y en la recuperación de copias. No rotar la clave al desplegar este cambio.
3. Ejecutar `npm run migrate` sobre la instancia de destino durante la actualización habitual. Los tests comprobaron la nueva migración dos veces sobre una base aislada.
4. Revisar datos fiscales históricos con `node scripts/encrypt_fiscal_secrets.cjs` (solo recuentos, dry-run). Tras verificar la copia recuperable y la clave activa, ejecutar el mismo comando con `--apply`. Aplica en una transacción y conserva el resto de configuración. No se ha ejecutado sobre producción.
5. Desplegar backend y frontend del mismo commit. Usar `npm run build`, `npm run planner:build` o `npm run desktop:build`; los hooks preparan los módulos del mapa incluso tras `npm ci --ignore-scripts`. Con un CDN propio, los dos `.mjs` necesitan CORS y MIME JavaScript.
6. Comprobar login legacy, invitación, reset, email de prueba autorizado, mapa y documento en staging; después smoke de producción con cuentas de prueba autorizadas. No emitir facturas reales ni enviar mensajes a terceros como prueba implícita.

Si se revierte código después de cifrar datos fiscales, usar una versión que sepa descifrarlos. Una versión antigua que trata el cifrado como la API key no es un rollback válido. Conservar la clave y priorizar la corrección hacia delante; nunca imprimir claves para recuperarlas.

## Retirada de secretos en URL

Usar `X-TransGest-GPS-Token`, `X-Verifacti-Secret` / `X-TransGest-Fiscal-Secret`, o `Authorization: Bearer`. Mantener temporalmente `ALLOW_LEGACY_INTEGRATION_QUERY_SECRETS=true` (valor por defecto).

Plan propuesto, sujeto a confirmar los proveedores: inventario de emisores hasta 30/09/2026; cambio de cabeceras y prueba en staging hasta 15/10/2026; desactivación con `ALLOW_LEGACY_INTEGRATION_QUERY_SECRETS=false` el 31/10/2026 **solo si todos los emisores han migrado**. No hay un corte automático por fecha. Revisar también logs del proxy/hosting: la redacción de Node no elimina consultas ya recogidas aguas arriba. Revocar secretos antiguos tras migrar.

Los enlaces públicos de documentos/invitación y el SSO contable necesitan una migración propia: siguen siendo enlaces limitados por su flujo actual; no se ha cambiado su contrato a ciegas.

## Pendientes que bloquean el cierre completo

- **Planes:** `normalizePlan` continúa con el fallback anterior por instrucción explícita de no cambiarlo sin inventario real. El código reconoce lite/mini/transgest_lite/transgest_mini → lite; basic/basico → basico; profesional/professional → profesional; enterprise → enterprise. Stripe construye IDs desde plan/ciclo; los nombres comerciales no prueban equivalencia. La modalidad Planner se guarda separadamente en `empresa_productos`. Falta el recuento de valores reales de `empresas.plan`, incluyendo NULL y vacíos. La consulta de solo lectura fue rechazada por la revisión automática al agotarse su cuota; no se ejecutó ni se intentó por otra vía. Tras el inventario: aliases explícitos, casos reales en tests y rechazo de valores desconocidos sin revocar planes históricos válidos accidentalmente.
- **Backups:** se entrega diseño y prueba de aceptación en el documento de arquitectura. No se ha activado cifrado de copias sin completar dump → cifrado → descifrado → restauración real.
- **JWT/cookies:** propuesta separada, sin cambiar el almacenamiento de sesión de esta versión.
- **Producción:** configuración real, migración de claves antiguas, pruebas con proveedores y dispositivos no verificadas. CI local verde no certifica producción.
- **DDL:** la extracción masiva no se realiza; continuar gradualmente con autenticación y fiscal usando el inventario.

Referencia de la actualización: [guía oficial MapLibre v5 → v6](https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/). Esta actualización requiere WebGL2; se mantiene el mensaje de mapa no disponible cuando el navegador no puede crearlo.
