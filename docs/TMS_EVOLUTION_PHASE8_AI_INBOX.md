# Fase 8 — Bandeja IA de pedidos

26/09/2026. Rama aislada; sin publicación ni datos reales.

## Resultado comprobado

- Entrada visible «Bandeja IA [N]» para gerente/tráfico con plan IA y permisos del módulo. El servidor comprueba los mismos límites. Contador de entradas pendientes independiente de la página; error no convertido en cero.
- Estados nuevo, revisar, listo, creado, descartado y error, con versión optimista y eventos. Interpretar o marcar listo nunca crea un pedido. El formulario operativo exige confirmación humana al guardar.
- Reutiliza `/pedidos/ai-inbox/parse`, `/runs` y `/status` y el parser de pedidos existente. EML se decodifica con `mailparser` 3.9.28 (dependencia justificada para MIME); DOCX y XLSX se extraen con JSZip/ExcelJS existentes. Se corrigió la extracción de Excel que perdía las etiquetas al leer índices de sharedStrings como texto.
- Originales cifrados mediante el servicio de secretos existente; descarga autenticada por empresa/rol/plan. Deduplicación por Message-ID y hash de contenido; un mismo Message-ID con contenido diferente devuelve 409, incluso si el contenido ya corresponde a otra entrada.
- El análisis tiene exclusión temporal y token de finalización. Reintentar devuelve el resultado persistido. Crear pedido y vincular entrada ocurre dentro de una transacción: reintento idéntico devuelve el mismo pedido; diferente contenido devuelve conflicto. No se repiten notificaciones por esta vía.
- Admite texto, EML, PDF, PNG/JPEG/WebP, DOCX, XLSX y varios adjuntos. Máximo 8 archivos, 6 MB por archivo y 7 MB totales, texto 20.000 caracteres. Comprobación de MIME, firma, nombre, base64 y expansión ZIP; Excel limitado a 2.000 filas/70 columnas por orden y sin fórmulas. Se quitaron del selector los formatos que no están soportados.
- Diálogo compartido: ancho 980 px en escritorio, adaptación móvil, foco contenido, Escape y restitución del foco. El borrador recuperado recibe foco para no quedar oculto debajo de la lista.

## Inbound y límites externos

Endpoint HMAC `POST /api/v1/inbound/orders`, formato JSON: `to`, `message_id`, `texto`, `attachments` (name, mediaType, base64). Firma `x-transgest-signature: sha256=<hex>` de `timestamp + "." + cuerpo crudo` con `x-transgest-timestamp` Unix en segundos, tolerancia 5 minutos. Se limita frecuencia y tamaño antes de procesar.

Configuración por entorno: `ORDERS_INBOUND_ENABLED=true`, `ORDERS_INBOUND_DOMAIN`, `ORDERS_INBOUND_WEBHOOK_SECRET` de al menos 32 caracteres. La dirección incluye la empresa, sin guiones en su UUID. El webhook únicamente recibe y conserva; no llama a IA ni crea pedidos automáticamente.

No se ha configurado DNS/MX ni un proveedor de correo real, ni probado una entrega exterior. La UI indica «pendiente de configurar» o que el conector depende del DNS/proveedor. No se presenta una dirección como buzón verificado. IA visual/OCR conserva el proveedor existente y requiere configuración; estas pruebas no enviaron archivos a un proveedor externo. Documentos complejos o protegidos requieren revisión manual; no se promete extracción perfecta.

## Evidencia

- `npm run check`: salida 0, suites existentes de seguridad por empresa, operativa, BI, Planner, documentos y chófer.
- `node scripts/order_inbox_check.cjs`: salida 0. Migración repetible, originales cifrados, conflictos Message-ID/hash, aislamiento, lease, revisión, rollback, reintento, límites y EML con adjunto, HMAC y caducidad.
- `node scripts/audit_workflows_regression_check.cjs`: salida 0, `passed: true`, `schemaErrors: []`; 26 comprobaciones HTTP de bandeja además de 98 del flujo de chófer y las demás comprobaciones existentes. Incluye DOCX y XLSX reales con origen/destino extraídos, descarga original exacta y denegación a otra empresa/chófer, planes Go/Pro, firma inbound inválida y replay.
- `npm run import:parser:regression`: salida 0 tras reutilizar la inspección ZIP con límites opcionales; incluye pack, Excel, OOXML con namespace y 10.001 filas.
- Frontend `CI=true npm test -- --watchAll=false --runInBand`: 50 suites, 124 pruebas, todas correctas. Incluye recuperación sin creación, error visible y descarte de respuesta obsoleta.
- Frontend `CI=false REACT_APP_LOCAL_SERVER=true npm run build`: salida 0 con avisos ESLint previos. Compilación destinada al banco local.
- Navegador local con datos sintéticos: lista y contador, recuperación de borrador, interpretación de texto, apertura del formulario con cliente/Madrid/Valencia/fecha/mercancía/peso/precio/referencia y salida sin creación. Escape devuelve foco al botón. 390/768/1440/1920 px: anchura de contenido del diálogo igual a la disponible, sin desbordamiento horizontal; revisión visual móvil realizada. No se alteró producción.

## Migración y reversión

Aplicar `scripts/migrations/20260926_ai_inbox.sql` con el runner existente antes de activar la nueva versión. Es aditiva y repetible; no modifica pedidos históricos. Mantener la clave de cifrado con la política vigente de secretos. Desactivar inbound permite detener nuevas recepciones sin borrar originales ni pedidos. Para revertir código, conservar las tablas y evidencia: no eliminar entradas enlazadas ni reconstruir pedidos desde el email.
