# TransGest Contabilidad - Arquitectura

Fecha: 2026-06-04

Esta propuesta no afirma cumplimiento legal. Define una arquitectura tecnica para construir un modulo contable y fiscal verificable, auditable y preparado para validacion por BOE, AEAT, asesoria fiscal, revision juridica y, cuando proceda, certificacion externa.

## Resumen de arquitectura actual detectada

- Backend actual: `transgest-backend`, Node.js 20, Express, JavaScript, API REST bajo `/api/v1`, PostgreSQL mediante `pg`, JWT bearer y middleware de permisos por rol, modulo y plan.
- Frontend actual: `transgest-frontend`, React 18 con Create React App, AuthContext, token en `localStorage`, carga lazy de modulos y cliente API centralizado.
- Despliegue local: `transgest-backend/docker-compose.yml` levanta `postgres`, `api` y `frontend` en una red Docker `tg_net`.
- Base de datos actual: una BD PostgreSQL `transgest`; aislamiento multiempresa por columna `empresa_id` en tablas operativas. Hay script `npm run audit:tenant`.
- Migraciones: `scripts/migrate.js` aplica SQL versionado en `scripts/migrations` con checksum. Aun existen DDL en arranque (`ALTER TABLE/CREATE TABLE ... catch`) dentro de `src/server.js` y algunos servicios.
- Autenticacion/autorizacion: login con JWT firmado, roles (`gerente`, `contable`, `trafico`, etc.), permisos JSON por modulo y validacion server-side con `requireModulePermission`.
- Auditoria: `audit_log_saas` registra acciones API mutables y login; existen eventos operativos como `pedido_eventos`, `vehiculo_eventos` y eventos fiscales.
- Facturacion actual: modulo operativo `facturas`, `factura_lineas`, `factura_pedidos`, IVA por porcentaje/regimen, cobros/reclamaciones y documentos vinculados. No hay motor contable de partida doble.
- Servicio fiscal actual: configuracion fiscal por empresa en `empresas.configuracion`, tablas `factura_registros_fiscales`, `factura_envios_fiscales`, `factura_eventos_fiscales`, cola de envio, proveedor Verifacti y webhook. Es una base util, pero debe extraerse y endurecerse como componente central.
- No se detecta un transactional outbox general ni consumidores idempotentes transversales.
- No se detecta repositorio Git en la raiz analizada; la estructura parece una copia de trabajo sin `.git` accesible.

## Riesgos tecnicos y deuda relevante

- El dominio de facturacion mezcla operaciones TMS, cobro, configuracion fiscal y colas regulatorias; conviene extraer un servicio central de facturacion fiscal.
- El DDL en arranque dificulta trazabilidad, rollback y ambientes reproducibles.
- El token en `localStorage` es practico, pero aumenta exposicion ante XSS. Para SSO entre apps se recomienda token exchange corto y cookies HttpOnly por servicio.
- Los permisos existen, pero son de modulo TransGest. Contabilidad necesita permisos mas finos por empresa, ejercicio, funcionalidad y accion.
- La multiempresa depende de disciplina de queries. Para contabilidad se necesita reforzar con roles SQL, tests de aislamiento y, si se mantiene una BD compartida, RLS o vistas/policies.
- No hay separacion fuerte entre nucleo contable y adaptadores regulatorios.
- La auditoria actual es valiosa, pero no es append-only estricta con proteccion tecnica contra UPDATE/DELETE.
- No existe motor de asientos, bloqueo de periodos, trazabilidad asiento-documento-evento ni controles de partida doble.
- No hay outbox transaccional general para propagar eventos desde facturacion, pedidos, cobros o fiscal.
- La compatibilidad legal no puede inferirse del codigo actual: debe validarse contra BOE/AEAT y asesoria externa.

## Arquitectura objetivo

Recomendacion: crear una aplicacion paralela e interconectada, con dominios separados y contratos explicitos.

### Referentes funcionales revisados

La organizacion de trabajo toma como referencia funcional, sin copiar interfaces ni asumir equivalencia legal:

- TeamSystem CONTASOL: trabajo multiempresa/multiejercicio, plan de cuentas, diario, tesoreria, cierres e informes.
- Sage 50: integracion entre gestion y contabilidad, automatismos, conciliacion, amortizaciones y trabajo con asesoria.
- Holded: plan contable por plantilla, bloqueo de periodos, punteo y acceso rapido a informes.
- Anfix: bandeja de revision, automatizacion, conciliacion y supervision antes de contabilizar.

Decision de producto: TransGest Contabilidad debe combinar una superficie de trabajo densa y predecible para contables con una supervision clara para gerencia. La automatizacion nunca debe saltarse validaciones, permisos, auditoria ni trazabilidad.

Servicios propuestos:

- `transgest-api`: API actual TMS. Publica eventos de dominio y abre Contabilidad mediante SSO. No escribe asientos.
- `transgest-frontend`: UI actual. Muestra acceso a Contabilidad si el usuario tiene permiso.
- `transgest-accounting-api`: backend Node.js/Express independiente para contabilidad financiera.
- `transgest-accounting-frontend`: frontend React independiente para libros, informes, cierres, conciliacion y administracion contable.
- `accounting-migrator`: proceso one-shot con credencial administradora que aplica migraciones versionadas.
- `accounting-db-provisioner`: proceso one-shot que configura privilegios separados para los roles runtime de API y worker.
- `fiscal-billing-service`: servicio centralizado de facturacion fiscal. Unico responsable de emitir facturas fiscales, generar registros fiscales, huellas, QR, colas y adaptadores.
- `regulatory-adapters`: librerias o paquetes versionables para VERI*FACTU, factura electronica B2B y SII opcional. No contienen reglas contables de negocio.
- `accounting-worker`: consumidor idempotente inicial para eventos internos y outbox contable. En Fase 1 solo confirma eventos conocidos; los efectos de negocio se incorporaran mediante casos de uso explicitos.
- `postgres-transgest`: BD actual de operaciones.
- `postgres-accounting`: BD aislada para contabilidad, o esquema `accounting` aislado si se requiere una sola instancia.

## Diagrama textual de servicios

```text
Usuario
  -> transgest-frontend
      -> transgest-api (/api/v1)
      -> SSO launch hacia transgest-accounting-frontend

transgest-accounting-frontend
  -> transgest-accounting-api (/api/internal/v1/accounting)

transgest-api
  -> transactional_outbox_operational
  -> fiscal-billing-service para emitir facturas fiscales

fiscal-billing-service
  -> fiscal DB/schema
  -> regulatory-adapters/verifactu
  -> regulatory-adapters/einvoice-b2b
  -> regulatory-adapters/sii opcional
  -> transactional_outbox_fiscal

event-worker
  -> lee outbox operacional/fiscal
  -> valida evento
  -> llama casos de uso explicitos de accounting-api
  -> registra consumer_offsets e idempotency_keys

transgest-accounting-api
  -> accounting DB/schema
  -> audit_append_only
  -> ledger_entries / journal_entries / journal_lines
```

## Monorepo frente a repositorios separados

Decision recomendada: monorepo inicial con separacion estricta por paquetes/servicios.

Motivos:

- El equipo puede evolucionar rapido contratos, Docker Compose, migraciones y tests E2E sin coordinar multiples repos.
- El stack actual ya convive en una estructura comun backend/frontend.
- Facilita snapshots locales y pruebas de integracion TransGest -> Fiscal -> Contabilidad.
- Permite extraer a repos separados cuando el dominio contable tenga API estable, versionado y CI propio.

Estructura propuesta:

```text
transgest-bloque6-backend/
  transgest-backend/
  transgest-frontend/
  transgest-accounting-api/
  transgest-accounting-frontend/
  fiscal-billing-service/
  packages/
    contracts/
    regulatory-adapters/
    event-schemas/
  docs/accounting/
```

Criterio de extraccion futura: separar repos cuando haya equipos distintos, SLAs distintos, versionado independiente de adaptadores regulatorios o necesidad de auditoria externa por componente.

## Estrategia de autenticacion y SSO

Fase 1:

- TransGest mantiene login principal.
- El usuario pulsa "Contabilidad" y `transgest-api` emite un `accounting_sso_code` de un solo uso, TTL 60-120 segundos.
- `transgest-accounting-frontend` intercambia el codigo contra `transgest-accounting-api`.
- `accounting-api` valida el codigo llamando a `transgest-api` o mediante firma asimetrica, crea sesion propia HttpOnly/SameSite y carga claims.
- Claims minimos: `user_id`, `empresa_id`, `tenant_id`, `roles`, `permissions`, `plan`, `impersonation`, `session_id`, `issued_at`.

Fase 2:

- Migrar a OIDC interno o proveedor de identidad si TransGest crece.
- Usar claves rotables JWKS y scopes: `accounting:read`, `accounting:write`, `accounting:close_period`, `fiscal:issue_invoice`, `fiscal:admin`.

Reglas:

- El frontend contable nunca debe confiar solo en permisos cliente.
- Toda accion contable debe validar empresa, usuario, rol, permiso funcional, periodo abierto y origen.
- Las sesiones de Contabilidad deben poder revocarse desde TransGest.

## Estrategia multitenant

Recomendacion principal: BD contable separada (`transgest_accounting`) en la misma instancia local al principio, con usuario SQL propio y sin permisos de escritura desde `transgest-api`.

Modelo:

- `tenant_id`: identificador SaaS global.
- `company_id`: empresa juridica/contable.
- `source_company_id`: referencia a `empresas.id` de TransGest.
- Todas las tablas contables incluyen `tenant_id` y `company_id`.
- Un usuario puede tener permisos diferentes por `company_id`.
- Indices compuestos por `(tenant_id, company_id, ...)`.
- Unicidades siempre acotadas por empresa y ejercicio.

Controles:

- Pool SQL exclusivo para `accounting-api`.
- Rol SQL de lectura para informes externos, sin INSERT/UPDATE/DELETE.
- Si se usa esquema compartido, activar RLS para tablas contables criticas.
- Tests automaticos de fuga tenant: lectura, escritura, eventos e informes.

## Estrategia de eventos e idempotencia

Estado de conexion:

- Fase 1 conecta TransGest y Contabilidad mediante enlace de UI, SSO, sincronizacion de usuario/empresa y RBAC.
- El smoke test `npm run accounting:connection-check` valida esa cadena sin generar efectos contables.
- El siguiente incremento incorporara un outbox en TransGest y un puente de eventos internos versionados.
- Los eventos operativos no generaran asientos hasta que existan el plan contable y el motor de partida doble.
- Ningun paso de la integracion concede a TransGest escritura directa sobre tablas contables.

Patron obligatorio: transactional outbox.

Productores:

- TransGest operaciones: pedidos entregados, facturas fiscales emitidas, cobros registrados, pagos a colaboradores, documentos adjuntos.
- Fiscal Billing: factura emitida, factura rectificada, registro VERI*FACTU aceptado/rechazado, factura electronica enviada/aceptada/rechazada.
- Accounting: asiento creado, periodo cerrado, conciliacion confirmada.

Outbox:

- Cada cambio de negocio y su evento se guardan en la misma transaccion.
- Campos: `event_id`, `event_type`, `aggregate_type`, `aggregate_id`, `tenant_id`, `company_id`, `schema_version`, `payload`, `occurred_at`, `available_at`, `published_at`, `status`, `attempts`, `trace_id`.
- Los workers publican o consumen con bloqueo `FOR UPDATE SKIP LOCKED`.
- La escritura de eventos contables se centraliza en `enqueueOutboxEvent`; los casos de uso no insertan directamente en `outbox_events`.
- Los contratos se versionan por `event_type` y `schema_version`.
- Productor y consumidor verifican un SHA-256 calculado sobre JSON canonico del payload.
- La operacion manual solo permite reintentar eventos `failed`, exige permiso y motivo, y registra auditoria append-only.
- La UI operativa muestra metadatos y errores, pero no expone ni permite editar payloads.

Idempotencia:

- Cada consumidor registra `consumer_name`, `event_id`, `event_type`, `processed_at`, `payload_hash`, `result_ref`.
- Cada caso de uso contable acepta `idempotency_key`.
- Fase 1 implementa `accounting-worker` con `FOR UPDATE SKIP LOCKED`, lease mediante `available_at`, backoff y restriccion unica `(consumer_name, event_id)`.
- El Diario manual v1 usa una clave idempotente y un hash canonico de peticion; la misma clave solo puede devolver el mismo borrador.

Separacion SQL implementada en Fase 1:

- Accounting API usa `transgest_accounting_api`, sin superusuario, DDL ni acceso a tablas operativas.
- Accounting worker usa `transgest_accounting_worker` y solo accede a `outbox_events` y `processed_events`.
- El provisioner revoca permisos actuales y por defecto del antiguo rol compartido `transgest_accounting_app`.
- Migraciones y provisionado se ejecutan antes del runtime con la credencial administradora.
- `schema_migrations` es read-only para la API e inaccesible para el worker.
- `audit_log` permite solo `SELECT` e `INSERT` a la API, es inaccesible para el worker y mantiene el trigger append-only.
- Limitacion pendiente: el backend TransGest historico aun usa una credencial superusuario y debe migrarse a un rol limitado antes de considerar aislamiento SQL completo.
- Claves recomendadas: `source_system:event_id`, `fiscal_invoice:invoice_id:version`, `payment:payment_id`.
- Reintentos seguros: si ya existe asiento para `source_event_id`, devolver el asiento existente y no crear otro.

## Reglas de dominio contable

- Ningun modulo externo inserta en `journal_entries` o `journal_lines`.
- Todo asiento se crea mediante caso de uso: `PostJournalEntry`, `PostInvoiceIssued`, `PostSupplierInvoiceAccepted`, `RegisterPayment`, `PostDepreciation`, `ClosePeriod`.
- Partida doble obligatoria: suma Debe = suma Haber por asiento, misma divisa y precision definida.
- Periodos cerrados o bloqueados no aceptan asientos ordinarios.
- Reaperturas y regularizaciones requieren permiso especifico, motivo y auditoria.
- Trazabilidad obligatoria desde asiento y linea hasta documento fuente, evento fuente y usuario/proceso.
- La anulacion se hace con asiento reverso o rectificativo, no con borrado fisico.

Estado implementado del ledger:

- `CreateManualJournalDraft` crea un borrador y sus lineas dentro de una transaccion.
- `UpdateManualJournalDraft` permite editar borradores no contabilizados ni cancelados, reemplazando cabecera y lineas en una transaccion, recalculando periodo y registrando auditoria/outbox.
- `PostManualJournalEntry` es el unico caso de uso que contabiliza actualmente.
- La contabilizacion bloquea asiento, ejercicio y periodo, valida cuentas activas/postables, exige Debe = Haber y asigna numero secuencial por ejercicio.
- `CancelManualJournalDraft` permite cancelar borradores con motivo, auditoria y outbox. No borra lineas y no permite cancelar asientos contabilizados.
- `CreateJournalReversalDraft` genera un borrador reverso desde un asiento contabilizado, invierte Debe/Haber, exige motivo y periodo abierto, y enlaza el asiento original mediante `source_links`.
- Creacion, edicion, cancelacion, reverso y contabilizacion registran auditoria y outbox.
- `source_links` enlaza reversos internos; los enlaces desde eventos y documentos externos siguen pendientes.
- No existen asientos automaticos, exportaciones PDF ni afirmacion de cumplimiento legal.
- Mayor y sumas/saldos se calculan de forma read-only desde asientos `posted`; no existe todavia tabla fisica de saldos.
- Las consultas soportan filtro opcional por periodo validado contra empresa y ejercicio.
- Las exportaciones CSV de Mayor y sumas/saldos reutilizan los mismos filtros, requieren `ledger.read` y registran auditoria append-only. El paquete PDF y exportaciones avanzadas para asesorias siguen pendientes.

## Separacion nucleo contable y adaptadores regulatorios

Nucleo contable:

- Plan de cuentas, asientos, libros, balances, cierres, conciliacion, inmovilizado.
- No conoce XML/servicios AEAT, VERI*FACTU, Facturae o SII.

Servicio de facturacion fiscal:

- Unico punto para emitir facturas fiscales.
- Genera evento validado `FiscalInvoiceIssued` para Contabilidad.
- Mantiene trazabilidad fiscal y estado regulatorio.

Adaptadores regulatorios:

- Versionados por norma y esquema.
- API interna estable: `buildPayload`, `validatePayload`, `submit`, `parseResponse`, `getStatus`.
- Version de adaptador guardada en cada envio.
- Cambios normativos se absorben en adaptadores sin modificar el ledger.

## APIs internas necesarias

TransGest -> Accounting:

- `POST /api/internal/v1/accounting/sso/exchange`
- `GET /api/internal/v1/accounting/context`
- `POST /api/internal/v1/accounting/events`
- `GET /api/internal/v1/accounting/source-documents/:sourceType/:sourceId`

Accounting:

- `POST /api/internal/v1/accounting/journal-entries`
- `GET /api/internal/v1/accounting/journal-entries`
- `GET /api/internal/v1/accounting/ledger/accounts/:accountId`
- `GET /api/internal/v1/accounting/reports/trial-balance`
- `GET /api/internal/v1/accounting/reports/balance-sheet`
- `GET /api/internal/v1/accounting/reports/profit-loss`
- `POST /api/internal/v1/accounting/periods/:id/close`
- `POST /api/internal/v1/accounting/periods/:id/reopen`
- `POST /api/internal/v1/accounting/bank-statements/import`
- `POST /api/internal/v1/accounting/reconciliations`

Fiscal Billing:

- `POST /api/internal/v1/fiscal/invoices`
- `POST /api/internal/v1/fiscal/invoices/:id/issue`
- `POST /api/internal/v1/fiscal/invoices/:id/rectify`
- `GET /api/internal/v1/fiscal/invoices/:id/status`
- `POST /api/internal/v1/fiscal/adapters/verifactu/send`
- `POST /api/internal/v1/fiscal/adapters/einvoice/send`
- `POST /api/internal/v1/fiscal/adapters/sii/send`

## Eventos de dominio iniciales

- `CompanyAccountingEnabled`
- `AccountingFiscalYearOpened`
- `AccountingPeriodClosed`
- `AccountingPeriodReopened`
- `ChartOfAccountsImported`
- `JournalEntryPosted`
- `JournalEntryReversed`
- `TransportOrderDelivered`
- `FiscalInvoiceDrafted`
- `FiscalInvoiceIssued`
- `FiscalInvoiceRectified`
- `CustomerPaymentRegistered`
- `SupplierInvoiceAccepted`
- `SupplierPaymentRegistered`
- `BankStatementImported`
- `BankTransactionReconciled`
- `FixedAssetCreated`
- `DepreciationPosted`
- `VerifactuRecordQueued`
- `VerifactuRecordAccepted`
- `VerifactuRecordRejected`
- `EInvoiceSent`
- `EInvoiceAccepted`
- `EInvoiceRejected`
- `SiiRecordSent`
- `SiiRecordAccepted`
- `SiiRecordRejected`

## Migraciones y rollback

- Migraciones SQL versionadas por servicio, con checksum y sin edicion de migraciones aplicadas.
- Separar migraciones de TransGest, Accounting y Fiscal.
- Migraciones reversibles cuando sea posible; cuando no lo sean, documentar rollback operacional.
- Para cambios destructivos: expand/contract, feature flags, backfill idempotente y snapshots previos.
- Prohibir DDL en arranque salvo checks de salud no mutables.

## Estrategia de pruebas

- Unitarias: motor de asientos, reglas de partida doble, permisos, calculos IVA, mapeos de cuentas.
- Integracion: PostgreSQL real con migraciones, outbox, idempotencia, periodos cerrados, SSO.
- E2E: flujo desde TransGest, emision fiscal centralizada, evento, asiento, libro diario, informe.
- Contratos: esquemas JSON versionados para eventos y APIs internas.
- Seguridad: aislamiento tenant, permisos por empresa, intentos de escritura directa, auditoria append-only.
- Regulatorio: fixtures oficiales o validados externamente para VERI*FACTU, factura electronica B2B y SII cuando proceda.

## Fuentes oficiales consultadas

- PGC: https://www.boe.es/eli/es/rd/2007/11/16/1514
- PGC PYMES: https://www.boe.es/eli/es/rd/2007/11/16/1515
- Codigo de Comercio: https://www.boe.es/buscar/act.php?id=BOE-A-1885-6627
- Reglamento de facturacion: https://www.boe.es/eli/es/rd/2012/11/30/1619
- IVA: https://www.boe.es/eli/es/l/1992/12/28/37/con
- SIF/VERI*FACTU RD 1007/2023: https://www.boe.es/eli/es/rd/2023/12/05/1007
- Orden HAC/1177/2024: https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138
- FAQ AEAT VERI*FACTU: https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes.html
- Ley 18/2022: https://www.boe.es/buscar/act.php?id=BOE-A-2022-15818
- RD 238/2026 factura electronica B2B: https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295
- SII RD 596/2016: https://www.boe.es/eli/es/rd/2016/12/02/596
- RGPD: https://eur-lex.europa.eu/legal-content/ES/ALL/?uri=CELEX:32016R0679
- LOPDGDD: https://www.boe.es/eli/es/lo/2018/12/05/3/con
- ENS: https://www.boe.es/eli/es/rd/2022/05/03/311
