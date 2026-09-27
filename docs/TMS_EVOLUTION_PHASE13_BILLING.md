# Fase 13 — Facturación operativa

## Implementación

Integrada en Facturación → Facturas → Preparación y excepciones; no sustituye la revisión/emisión existente. Reglas generales y específicas por cliente, editables por gerencia: entrega o salida real registrada, POD/albarán/CMR, DeCA por envío y bloqueo de incidencia. Defaults conservan entrega y POD; no se exige DeCA a históricos por una migración implícita. La salida no se infiere del estado cargado, fecha planificada ni GPS. Facturar una salida no registra una entrega.

El centro muestra excepciones y servicios pendientes de revisión, permite abrir su corrección existente y confirmar tarifa, combustible, suplementos, documentos e incidencias. Revisión humana con huella: cambia cualquiera de esos datos o una regla y deja de estar listo. Fuentes: pedidos, pasos del chófer/salida del colaborador, soportes, envíos y versiones documentales. La revisión de la factura comprueba nuevamente las reglas en servidor antes de emitir.

El lote seleccionado de un solo cliente prepara un borrador reutilizando el creador existente: líneas de transporte y recargo de combustible separadas, bases/impuestos del cliente; nunca emisión o envío automáticos. Hasta 200 servicios por petición, selección paginada de 30. Un reintento con la misma población y revisión devuelve el mismo borrador. Esperas y suplementos conservan sus vías existentes de extracostes/revisión: no se estiman ni se añaden silenciosamente.

## Defectos corregidos

- Validación y asociación del pedido dentro de la misma transacción, con bloqueo ordenado. Se revalidan cliente, hito y facturas tanto directas como enlaces inversos; ya no se omiten silenciosamente pedidos cambiados.
- Reutilización idempotente de borrador de lote; numeración usa el bloqueo existente por empresa/serie/año.
- La revisión de venta Planner toma el último albarán versionado y su hash, en lugar del primer original legacy.
- API privada y paginada, permisos de facturación, gerente/contable; reglas solo gerente. Fallos visibles y datos antiguos retirados al fallar una consulta.

## Evidencia local

`node scripts/audit_workflows_regression_check.cjs`: salida 0, esquema sin errores, 28 comprobaciones específicas. Incluye salida real frente a ausencia de evento, política por cliente, revisión caducada, reintento, combustible, emisión sin inventar entrega, otra empresa/rol rechazados y dos peticiones concurrentes con números diferentes. PGlite serializa transacciones: falta repetir concurrencia multiproceso sobre PostgreSQL de despliegue.

Frontend: 56 suites/130 pruebas correctas; selección solo de servicios listos, lote, error visible y retirada de datos obsoletos. Regresiones heredadas cubren revisión/rectificativas, correo fallido sin éxito ficticio, cobros y combustible. Comandos y logs de esta fase: `phase13-http-final.log`, `phase13-front-final.log`, `phase13-check.log`, `phase13-build-final.log`.

## Migración, límites y QA

Aplicar `20260927_invoice_operational_workflow.sql` antes del backend. Tablas nuevas de políticas/revisiones/eventos y deduplicación; no reescribe documentos históricos. Reversión: retirar UI y conservar estas tablas/auditoría; revertir también el consumidor de reglas solo tras revisar borradores en curso.

Los importes ausentes/cero/negativos bloquean el flujo ordinario hasta revisión de tarifa; abonos continúan por rectificativa, no por un servicio negativo. No certifica DeCA ni convierte una presencia de documento en entrega puntual. La resolución comercial de incidencias complejas y reparto de suplementos sigue siendo humana. No se ha enviado correo ni realizado alta fiscal externa. QA: crear servicio entregado sin POD → excepción; adjuntar soporte → revisar → lote → revisar factura → emitir; cambiar precio o regla entre pasos debe bloquear hasta nueva revisión.

Cierre: `npm run check` salida 0; `phase13-http-verified.log` salida 0 tras reforzar enlaces inversos y validación UUID. Build final `phase13-build-verified.log`: salida 0 con avisos heredados. QA en navegador local: centro conectado a 20 servicios sintéticos, filtros/reglas, errores identificados y controles de lote. A 390 px se detectó y corrigió la compresión de referencias: la tabla conserva anchura legible con desplazamiento dentro del panel; la página no desborda (390/390).
