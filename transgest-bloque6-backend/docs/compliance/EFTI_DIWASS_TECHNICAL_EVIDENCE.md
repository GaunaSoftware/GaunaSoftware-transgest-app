# TransGest - Evidencia tecnica eFTI / eCMR / DIWASS

Fecha: 2026-06-25

Este documento resume la evidencia tecnica disponible para auditoria, proveedor certificado o asesoria juridica.

## Modulos implicados

| Modulo | Funcion |
| --- | --- |
| `transgest-backend/src/services/documentoControl.js` | Construye DCD/DeCA, export interoperable, eCMR preparatorio, DIWASS/eAnnex VII preventivo, paquete firma eIDAS y PDF |
| `transgest-backend/src/services/regulatoryCore.js` | Crea nucleo regulatorio, payloads eFTI/eCMR/DIWASS, documentos versionados, audit logs, integraciones externas y transmisiones |
| `transgest-backend/src/routes/pedidos.js` | Expone endpoints DCD, repositorio, export, dossier, payload y borrador de transmision |
| `transgest-backend/src/routes/informes.js` | Panel de cumplimiento europeo, senales ADR/ZBE/tacografo/DIWASS y prioridades |
| `transgest-frontend/src/pages/Pedidos.js` | UI de generacion DeCA, export eFTI/eCMR, dossier, checklist y borrador eFTI |
| `transgest-frontend/src/pages/Informes.js` | Panel operativo de cumplimiento y viajes a revisar |
| `transgest-frontend/src/pages/AppChofer.js` | DCD disponible para chofer, revision, impresion, descarga, compartir enlace y apertura de paradas en Maps |

## Modelo de datos regulatorio

El backend crea o actualiza automaticamente estas tablas si no existen:

- `regulatory_parties`
- `regulatory_locations`
- `regulatory_goods`
- `regulatory_waste_details`
- `regulatory_dangerous_goods_details`
- `regulatory_documents`
- `regulatory_document_versions`
- `regulatory_payloads`
- `regulatory_audit_logs`
- `regulatory_external_integrations`
- `regulatory_transmissions`
- `documento_control_repositorio`
- `documento_control_repositorio_historial`

## Datos estructurados cubiertos

| Requisito | Cobertura |
| --- | --- |
| Identificadores de pedido, codigo de control y verificacion | Cubierto |
| Cargador contractual | Cubierto |
| Transportista efectivo | Cubierto |
| Destinatario | Cubierto |
| Origen, destino, cargas y descargas | Cubierto |
| Fechas, horas y ventanas | Cubierto |
| Mercancia, peso y bultos | Cubierto parcial: depende de datos introducidos |
| Vehiculo tractor y remolque | Cubierto parcial: depende de asignacion |
| Chofer | Cubierto en operativa, pendiente de exponer en payload certificado segun proveedor |
| Internacional/eCMR/eFTI | Deteccion y payload interno |
| ADR | Deteccion y validacion preventiva |
| Residuos/DIWASS/eAnnex VII | Deteccion, payload interno y campos base |
| Firma/eIDAS | Paquete preparatorio, proveedor pendiente |
| Auditoria y versiones | Cubierto internamente |

## Controles de seguridad y trazabilidad

- Aislamiento por `empresa_id`.
- Acceso autenticado por JWT/RBAC en endpoints internos.
- Enlaces publicos DCD tokenizados con codigo de verificacion.
- Cabeceras `no-store` y pagina no indexable en soporte publico.
- Hash SHA-256 de documentos, payloads y paquetes.
- Historial de versiones y eventos por pedido.
- Bloqueo de remision formal incompleta salvo confirmacion de gerencia.
- Control de cambios posteriores a firma con confirmacion expresa de gerencia.

## Estados y limitaciones declaradas

TransGest prepara datos y evidencias internas. La aceptacion oficial debe confirmarse con:

- Proveedor o plataforma eCMR/eFTI certificada.
- Proveedor de firma electronica/eIDAS.
- Sistema DIWASS/eAnnex VII o plataforma conectada cuando aplique.
- Revision juridica de documentos, clausulas, retencion y rol de cada parte.

## Evidencias por endpoint

| Evidencia | Endpoint | Uso en auditoria |
| --- | --- | --- |
| Documento de control digital | `GET /api/v1/pedidos/:id/documento-control-digital` | Estado operativo, faltantes, avisos y soporte |
| DeCA PDF archivado | `POST /api/v1/pedidos/:id/documento-control-digital/generar` | Genera PDF, hashes, historial y repositorio |
| Export interoperable | `GET /api/v1/pedidos/:id/documento-control-digital/export` | Muestra schema DCD/eCMR/eFTI-ready |
| Paquete de firma | `GET /api/v1/pedidos/:id/documento-control-digital/firma-paquete` | Payload a firmar y evidencias esperadas |
| Paquete regulatorio | `GET /api/v1/pedidos/:id/regulatory-core/export` | Dossier JSON completo por viaje |
| Dossier PDF | `GET /api/v1/pedidos/:id/regulatory-core/dossier.pdf` | Documento legible para auditoria |
| Payload eFTI/eCMR/DIWASS | `GET /api/v1/pedidos/:id/regulatory-core/payload/:type` | Validacion especifica por proveedor |
| Borrador transmision | `POST /api/v1/pedidos/:id/regulatory-core/transmission-draft` | Idempotencia y preparacion de conectores |

## Muestras necesarias para la solicitud

Preparar al menos 5 viajes de prueba:

1. Nacional ordinario con DeCA completo.
2. Internacional con eCMR/eFTI.
3. ADR.
4. Residuo nacional.
5. Residuo transfronterizo con eAnnex VII/DIWASS.

Cada muestra debe incluir:

- Pedido completo.
- DeCA/DCD PDF archivado.
- Export JSON.
- Dossier regulatorio PDF.
- Payload `efti`, `ecmr` y, si aplica, `diwass`.
- Eventos de consulta, descarga, remision y firma si existen.
