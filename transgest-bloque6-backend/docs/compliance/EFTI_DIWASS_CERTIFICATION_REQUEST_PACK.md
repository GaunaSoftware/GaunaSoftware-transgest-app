# TransGest - Paquete para solicitud de integracion y certificacion eFTI / eCMR / DIWASS

Fecha de preparacion: 2026-06-25

Este paquete esta preparado para abrir una solicitud formal con proveedores certificados, auditores tecnicos o asesoria juridica. No declara que TransGest este certificado todavia. Define el alcance tecnico existente, las evidencias disponibles, las pruebas que deben ejecutarse y las decisiones externas pendientes.

## Objetivo de la solicitud

Solicitar evaluacion, integracion y, cuando proceda, certificacion o conformidad de TransGest para:

- Documento de Control Digital / DeCA en operativa nacional.
- eCMR para carta de porte electronica.
- eFTI para intercambio estructurado de informacion de transporte.
- DIWASS / eAnnex VII para traslados de residuos cuando aplique.
- Firma electronica avanzada / eIDAS mediante proveedor externo.

## Estado actual de TransGest

| Area | Estado TransGest | Evidencia tecnica | Validacion externa pendiente |
| --- | --- | --- | --- |
| DeCA / DCD | Implementado como modulo operativo interno | PDF nativo, repositorio, QR/URL tokenizada, hash SHA-256, historial y retencion minima | Confirmacion legal y pruebas con flujo oficial/proveedor si aplica |
| eCMR | Payload interno preparatorio | `transgest.documento_control.interoperable` y payload `ecmr` versionado | Proveedor eCMR/firma, acuerdo de partes, evidencias de firma y conformidad |
| eFTI | Payload interno preparatorio | Payload `transgest.efti.internal.v1`, export por API, dossier regulatorio | Plataforma eFTI certificada o proceso formal de certificacion |
| DIWASS / residuos | Deteccion y payload interno preparatorio | Payload `transgest.diwass.internal.v1`, waste details, checklist de faltantes | Conector DIWASS/eAnnex VII, operador, documentos oficiales y pruebas externas |
| Auditoria | Implementada internamente | Eventos de pedido, `regulatory_audit_logs`, versiones y hashes | Revision de inmutabilidad, retencion y accesos por tercero |
| Seguridad | Base multiempresa y enlaces tokenizados | `empresa_id`, JWT/RBAC, token publico DCD, no-store/noindex | Revision seguridad, DPA, pentest si el proveedor lo exige |

## Evidencias que se pueden entregar

1. Export JSON DCD/eCMR/eFTI-ready de un pedido.
2. Paquete regulatorio JSON por viaje.
3. Dossier regulatorio PDF por viaje.
4. Payload individual `efti`, `ecmr` o `diwass`.
5. Historial de eventos DCD y regulatory core.
6. Capturas de pantalla de:
   - Pedidos > bloque DeCA/DCD/eFTI.
   - Informes > cumplimiento europeo.
   - App chofer > DCD revisado/disponible.
   - Mi Empresa > Documento de Control Digital y diagnostico de integraciones.

## Endpoints disponibles para demostracion

Base produccion prevista: `https://app.gauna.es`

| Uso | Metodo y ruta | Estado |
| --- | --- | --- |
| Consultar DCD de pedido | `GET /api/v1/pedidos/:id/documento-control-digital` | Operativo |
| Generar y archivar DeCA/DCD | `POST /api/v1/pedidos/:id/documento-control-digital/generar` | Operativo |
| Export DCD/eCMR/eFTI-ready | `GET /api/v1/pedidos/:id/documento-control-digital/export` | Operativo |
| Paquete firma eIDAS preparatorio | `GET /api/v1/pedidos/:id/documento-control-digital/firma-paquete` | Operativo |
| Paquete regulatorio JSON | `GET /api/v1/pedidos/:id/regulatory-core/export` | Operativo |
| Dossier regulatorio PDF | `GET /api/v1/pedidos/:id/regulatory-core/dossier.pdf` | Operativo |
| Payload por tipo | `GET /api/v1/pedidos/:id/regulatory-core/payload/:type` | Operativo para `efti`, `ecmr`, `diwass` |
| Borrador de transmision | `POST /api/v1/pedidos/:id/regulatory-core/transmission-draft` | Borrador, sin envio externo |
| Repositorio DeCA/DCD | `GET /api/v1/pedidos/documento-control-repositorio` | Operativo |

## Adjuntos recomendados para la primera solicitud

- `docs/compliance/EFTI_DIWASS_TECHNICAL_EVIDENCE.md`
- `docs/compliance/EFTI_DIWASS_PROVIDER_QUESTIONNAIRE.md`
- `docs/compliance/EFTI_DIWASS_CERTIFICATION_TEST_PLAN.md`
- `docs/compliance/efti-diwass-integration-request.json`
- Un paquete real exportado desde produccion o preproduccion:
  - `transgest-regulatory-package-<pedido>.json`
  - `transgest-efti-payload-<pedido>-v1.json`
  - `transgest-diwass-payload-<pedido>-v1.json`
  - `transgest-dossier-regulatorio-<pedido>.pdf`

## Email base para proveedor o auditor

Asunto: Solicitud de integracion y evaluacion eCMR/eFTI/DIWASS para TransGest

Hola,

Somos TransGest, TMS desplegado en `https://app.gauna.es`. Queremos iniciar la evaluacion tecnica para integrar nuestro sistema con una plataforma certificada eCMR/eFTI y, cuando proceda, DIWASS/eAnnex VII para traslados de residuos.

Actualmente TransGest genera DeCA/DCD, repositorio documental, QR/URL tokenizada, payloads internos `eFTI`, `eCMR` y `DIWASS`, dossier regulatorio, versiones, hashes y auditoria por pedido. Necesitamos validar el encaje con vuestro proceso certificado, las pruebas de conformidad, requisitos de firma/eIDAS, estado de transmisiones y webhooks/API de retorno.

Adjuntamos:

- Resumen tecnico de TransGest.
- Cuestionario de integracion.
- Plan de pruebas propuesto.
- Manifiesto JSON de solicitud.
- Muestras exportadas de payload y dossier regulatorio.

Solicitamos una reunion tecnica para confirmar:

- Requisitos exactos de alta como integrador/proveedor.
- Formatos soportados y mapeo de campos.
- Flujo de autenticacion, sandbox, pruebas y certificacion.
- Gestion de estados, errores, reintentos e idempotencia.
- Evidencias legales y tecnicas que debemos conservar.
- Costes, plazos, contrato, soporte y SLA.

Gracias.

TransGest

## Decision pendiente antes de enviar

Antes de enviar este paquete hay que elegir estrategia:

1. Integracion con proveedor certificado: opcion recomendada para salida mas rapida.
2. Certificacion propia de TransGest: requiere proceso mas largo, auditoria y pruebas de conformidad.
3. Modelo mixto: proveedor certificado para eFTI/eCMR/DIWASS y TransGest como sistema maestro operativo.

Recomendacion tecnica actual: empezar con proveedor certificado y mantener TransGest como sistema maestro de pedidos, documentos, evidencias, conductor y facturacion.
