# TransGest Contabilidad - Ejecucion local Fase 1

Fecha: 2026-06-04

Esta fase implementa el esqueleto funcional, un Diario manual v1, Mayor por cuenta, balance inicial de sumas y saldos, informes preliminares de Balance/PyG, maestro basico de terceros, cartera manual de vencimientos, tesoreria bancaria manual y exportacion CSV auditada de consultas operativas. No incluye facturas, VERI*FACTU, asientos automaticos, importacion bancaria normalizada, conciliacion automatica, exportaciones PDF ni informes legales cerrados. No se declara cumplimiento legal.

## Supuestos

- Contabilidad se ejecuta como aplicacion paralela.
- La base local reutiliza la instancia PostgreSQL de TransGest y crea el esquema `accounting`.
- El aislamiento de escritura se consigue con roles SQL por proceso: la API escribe datos de aplicacion y el worker solo actualiza el outbox e inserta marcas idempotentes.
- El SSO reutiliza el JWT actual de TransGest para emitir un token corto `accounting_sso`.
- El modulo de permiso en TransGest se llama `contabilidad`.
- En local el frontend contable se expone en `http://localhost:8080`.

## Servicios

- TransGest API: `http://localhost:3001`
- TransGest frontend: `http://localhost`
- Accounting API: `http://localhost:3011`
- Accounting frontend: `http://localhost:8080`
- Accounting worker: proceso interno sin puerto HTTP.
- Accounting migrator: proceso one-shot con credencial administradora.
- Accounting DB provisioner: proceso one-shot que configura los roles runtime de API y worker.

## Arranque con Docker Compose

Desde `transgest-backend`:

```powershell
docker compose up -d --build
docker compose ps
```

La cadena de arranque contable ejecuta:

```text
accounting-migrator -> node scripts/migrate.js up
accounting-db-provisioner -> node scripts/provision-runtime-role.js
accounting-api -> node src/server.js
accounting-worker -> node src/worker.js
```

Migrador y provisioner deben finalizar correctamente antes de arrancar Accounting API.

## Roles PostgreSQL contables

- `transgest_user`: credencial administradora local usada solo por migrador y provisioner.
- `transgest_accounting_api`: rol runtime usado por Accounting API.
- `transgest_accounting_worker`: rol runtime usado por Accounting worker.
- `transgest_accounting_app`: rol legacy compartido; el provisioner revoca sus permisos sobre `accounting`.

Ambos roles runtime:

- No son superusuarios.
- No pueden crear bases de datos ni roles.
- Tienen `USAGE`, pero no `CREATE`, sobre el esquema `accounting`.
- No pueden consultar tablas operativas como `public.empresas`.

El rol de API puede ejecutar el DML de aplicacion requerido, solo puede leer `schema_migrations` y solo puede consultar e insertar en `audit_log`.

El rol de worker solo puede leer y actualizar `outbox_events`, y leer e insertar en `processed_events`. No puede consultar el resto de tablas contables.

El provisioner falla si API, worker y rol legacy no son distintos, o si alguno reutiliza la credencial administradora.

Variables:

```text
ACCOUNTING_API_DB_USER=transgest_accounting_api
ACCOUNTING_API_DB_PASSWORD=CAMBIA_ESTA_CONTRASENA_API_CONTABLE
ACCOUNTING_WORKER_DB_USER=transgest_accounting_worker
ACCOUNTING_WORKER_DB_PASSWORD=CAMBIA_ESTA_CONTRASENA_WORKER_CONTABLE
ACCOUNTING_LEGACY_RUNTIME_DB_USER=transgest_accounting_app
```

La contraseña local por defecto de Compose solo sirve para desarrollo y debe reemplazarse fuera de local.

## Migraciones contables

Aplicar migraciones:

```powershell
cd ..\transgest-accounting-api
npm run migrate
```

Revertir la ultima migracion:

```powershell
cd ..\transgest-accounting-api
npm run migrate:rollback
```

La migracion inicial crea:

- `accounting.accounting_tenants`
- `accounting.accounting_companies`
- `accounting.accounting_users`
- `accounting.accounting_roles`
- `accounting.accounting_permissions`
- `accounting.accounting_role_permissions`
- `accounting.accounting_user_roles`
- `accounting.fiscal_years`
- `accounting.accounting_periods`
- `accounting.audit_log`
- `accounting.outbox_events`
- `accounting.processed_events`

La migracion `002_audit_log_append_only` protege `accounting.audit_log` con un trigger PostgreSQL que bloquea:

- `UPDATE`
- `DELETE`
- `TRUNCATE`

El rollback elimina el trigger y su funcion, sin borrar registros de auditoria.

La migracion `004_chart_templates` crea:

- `accounting.accounting_standards`
- `accounting.chart_templates`
- `accounting.chart_template_accounts`
- `accounting.chart_template_imports`

No carga contenido PGC o PGC PYMES. Su rollback elimina solo estas tablas y debe ejecutarse con backup si ya contienen plantillas o importaciones relevantes.

La migracion `005_journal_engine` crea:

- `accounting.journal_entries`
- `accounting.journal_lines`
- `accounting.source_links`

Su rollback elimina estas tablas y, por tanto, todos los borradores y asientos contabilizados que contengan. Solo debe ejecutarse con backup y autorizacion en un entorno con datos relevantes.

La migracion `006_ledger_read_permission` crea o actualiza el permiso:

- `ledger.read`

Tambien lo concede a `accounting_admin`, `accounting_user` y `accounting_viewer`. Su rollback retira el permiso de los roles y elimina el permiso. No borra asientos ni saldos.

La migracion `007_journal_entry_cancellation` permite cancelar borradores sin borrado fisico:

- Anade `cancelled_at`, `cancelled_by` y `cancel_reason`.
- Amplia `journal_entries.status` con `cancelled`.
- Mantiene checks para que un borrador cancelado no tenga numero ni fecha de contabilizacion y conserve motivo.
- Su rollback falla si existen borradores cancelados, para no reactivar anulaciones auditadas.

La migracion `011_accounting_banks` crea:

- `accounting.accounting_bank_accounts`
- `accounting.bank_transactions`

Tambien crea los permisos `banks.read` y `banks.write`. Su rollback elimina movimientos, cuentas bancarias y permisos, por lo que en entornos con datos requiere backup y autorizacion.

## SSO

TransGest expone:

```text
GET /api/v1/accounting/launch-token
```

Requisitos:

- Usuario autenticado.
- Permiso de modulo `contabilidad`.

Respuesta:

- `launch_url` hacia el frontend contable con `sso_token` temporal.

El frontend contable intercambia el token en:

```text
POST /api/v1/auth/sso/exchange
```

Si el usuario no tiene permiso, TransGest devuelve 403.

## Estado de la conexion con TransGest

Conexion disponible en Fase 1:

- Enlace al modulo desde el frontend TransGest.
- El acceso desde TransGest abre un lanzador interno con boton/enlace para abrir Contabilidad en pestana independiente y mantener la pestana principal del programa.
- La app contable muestra un enlace de vuelta a TransGest para navegadores que fuercen la apertura en la pestana actual.
- Login principal mantenido en TransGest.
- Token SSO corto emitido por TransGest e intercambiado por una sesion contable.
- Sincronizacion al entrar de usuario, tenant, empresa y rol contable inicial.
- Seleccion limitada a empresas autorizadas.
- Evaluacion de permisos en ambos backends.
- Auditoria append-only de selecciones autorizadas y de intentos cross-company denegados.

Conexion todavia no implementada:

- Publicacion de eventos operativos desde el outbox de TransGest.
- Sincronizacion de clientes, proveedores, pedidos, cobros o pagos.
- Contabilizacion automatica de facturas y otros documentos operativos.
- Escritura de Contabilidad sobre tablas operativas de TransGest.

La siguiente conexion tecnica sera el puente versionado de eventos TransGest -> Contabilidad. El plan contable configurable y el Diario manual v1 ya existen; la contabilizacion de datos operativos comenzara mediante casos de uso o eventos validados, nunca mediante escritura directa en tablas contables.

Comprobar la conexion actual de extremo a extremo:

```powershell
cd ..\transgest-backend
npm run accounting:connection-check
```

El comprobador valida health, login, SSO, contexto de empresa, seleccion autorizada, respuestas 403 y auditoria del rechazo cross-company. No crea facturas ni asientos.

## Tests

Backend contable:

```powershell
cd ..\transgest-accounting-api
npm test
npm run check
```

Backend TransGest:

```powershell
cd ..\transgest-backend
npm run check
npm run accounting:connection-check
```

Frontend TransGest:

```powershell
cd ..\transgest-frontend
npm run check
```

Frontend contable:

```powershell
cd ..\transgest-accounting-frontend
npm run check
```

## Validacion manual minima

1. Iniciar Docker Compose.
2. Entrar a `http://localhost`.
3. Iniciar sesion con un usuario con permiso `contabilidad`.
4. Abrir el modulo "Contabilidad".
5. Verificar que aparece el lanzador de Contabilidad dentro de TransGest, sin salir del programa.
6. Pulsar "Abrir en nueva pestana" y confirmar que `http://localhost:8080` conserva la sesion SSO y muestra la empresa autorizada.
7. Confirmar que existe enlace "Volver a TransGest" en la app contable.
8. En "Ejercicios y periodos", abrir un ejercicio y confirmar que se crean periodos mensuales.
9. Bloquear, cerrar o reabrir un periodo segun permisos y confirmar que se pide motivo.
10. Entrar en "Auditoria" con gerente y confirmar que se listan eventos.
11. Probar con usuario sin permiso de auditoria y confirmar 403.
12. Entrar en "Diario", crear un borrador balanceado y contabilizarlo.
13. Crear un borrador descuadrado y confirmar que la contabilizacion se rechaza.
14. Bloquear el periodo correspondiente y confirmar que un borrador balanceado no puede contabilizarse.

## Apertura de ejercicios

La Fase 1 permite crear un ejercicio desde la app contable:

```text
POST /api/v1/fiscal-years
```

Cuerpo:

```json
{
  "year_label": "2026",
  "start_date": "2026-01-01",
  "end_date": "2026-12-31"
}
```

El backend usa una transaccion para:

- Crear `fiscal_years`.
- Crear periodos mensuales en `accounting_periods`.
- Registrar `audit_log`.
- Encolar `AccountingFiscalYearOpened` en `outbox_events`.

No se crean asientos ni movimientos contables.

## Estados de periodo

La Fase 1 permite transiciones basicas de periodos desde la app contable:

```text
PATCH /api/v1/periods/:id/status
```

Cuerpo:

```json
{
  "action": "lock",
  "reason": "Motivo operativo"
}
```

Acciones disponibles:

- `lock`: `open` -> `locked`, requiere `periods.write`.
- `unlock`: `locked` -> `open`, requiere `periods.write`.
- `close`: `open|locked` -> `closed`, requiere `periods.write`.
- `reopen`: `closed` -> `open`, requiere `periods.reopen`.

Cada cambio:

- Bloquea la fila del periodo con `FOR UPDATE`.
- Se ejecuta en transaccion.
- Registra `audit_log`.
- Encola un evento `AccountingPeriod*` en `outbox_events`.

La reapertura queda reservada inicialmente a `accounting_admin`. Esto es una decision tecnica de Fase 1, no una declaracion de cumplimiento normativo.

## Plan contable configurable

La app permite preparar un plan de cuentas manual por empresa y ejercicio:

```text
GET /api/v1/accounts
POST /api/v1/accounts
PATCH /api/v1/accounts/:id/status
```

Controles:

- Requiere `accounts.read` para consulta y `accounts.write` para cambios.
- Los codigos contienen entre 1 y 20 digitos y son unicos por empresa y ejercicio.
- El alta y el cambio de estado usan transacciones, auditoria y outbox.
- Las cuentas se activan o desactivan con motivo; no existe borrado desde la API.
- No se generan movimientos, saldos ni asientos.
- No se incluye todavia una plantilla PGC/PGC PYMES. Su contenido y version deben validarse con fuente oficial antes de importarlo.

Migracion:

```text
003_chart_of_accounts
```

## Plantillas internas de plan contable

La app permite reutilizar un plan preparado entre ejercicios mediante:

```text
GET /api/v1/chart-templates
POST /api/v1/chart-templates/from-fiscal-year
GET /api/v1/chart-templates/:id/preview
POST /api/v1/chart-templates/:id/import
```

Controles:

- `templates.read` permite listar y previsualizar.
- `templates.write` permite crear instantaneas e importar.
- Una instantanea incluye solo cuentas activas del ejercicio origen.
- Cada plantilla conserva codigo, version y checksum SHA-256 de su contenido.
- La vista previa clasifica altas, coincidencias y conflictos.
- La importacion se ejecuta en transaccion, requiere `idempotency_key` y nunca sobrescribe cuentas existentes.
- Las relaciones padre de las cuentas nuevas se enlazan en una segunda pasada dentro de la misma transaccion.
- Una plantilla solo puede importarse una vez en el mismo ejercicio.
- Creacion e importacion registran auditoria y outbox.
- No se declara que una plantilla interna equivalga a PGC, PGC PYMES o cualquier estandar oficial.

Migracion:

```text
004_chart_templates
```

## Auditoria read-only

La Fase 1 expone una consulta limitada del registro append-only:

```text
GET /api/v1/audit-log
```

Filtros soportados:

- `action`: accion exacta, por ejemplo `period.closed`.
- `entity_type`: entidad exacta, por ejemplo `accounting_period`.
- `limit`: entre 1 y 100, por defecto 25.

Restricciones:

- Requiere `audit.read`.
- Filtra siempre por la empresa seleccionada en el token contable.
- No permite crear, editar ni borrar registros de auditoria.
- `accounting_admin` tiene `audit.read` en Fase 1.
- `accounting_user` y `accounting_viewer` no tienen `audit.read`.
- PostgreSQL bloquea mutaciones sobre `accounting.audit_log`; la aplicacion solo puede insertar y consultar.

La proteccion por trigger no sustituye la separacion de roles SQL: un propietario o administrador de base de datos podria retirar el trigger. Produccion debe usar credenciales de aplicacion sin privilegios DDL.

Accounting API y worker usan credenciales SQL diferentes y de minimo privilegio. El provisioner revoca tambien los privilegios actuales y por defecto del antiguo rol compartido `transgest_accounting_app`.

Limitacion actual: `transgest_api` sigue usando el superusuario historico `transgest_user`, por lo que tecnicamente puede atravesar los permisos del esquema contable. Separar tambien el rol SQL del backend TransGest queda pendiente antes de produccion.

## Worker outbox e idempotencia

`accounting-worker` consume eventos de `accounting.outbox_events` y registra cada consumo en `accounting.processed_events`.

Comportamiento inicial:

- Reclama eventos con `FOR UPDATE SKIP LOCKED`.
- Usa `available_at` como lease para recuperar eventos abandonados en estado `processing`.
- Registra `(consumer_name, event_id)` con restriccion unica.
- Una reentrega ya procesada se reconoce como `duplicate` y no crea otra marca.
- Aplica backoff exponencial entre reintentos.
- Tras `ACCOUNTING_OUTBOX_MAX_ATTEMPTS`, deja el evento en estado `failed`.

Variables:

```text
ACCOUNTING_OUTBOX_CONSUMER_NAME=accounting-internal-v1
ACCOUNTING_OUTBOX_POLL_INTERVAL_MS=1000
ACCOUNTING_OUTBOX_LEASE_SECONDS=60
ACCOUNTING_OUTBOX_MAX_ATTEMPTS=5
```

Ejecucion manual de una iteracion:

```powershell
cd ..\transgest-accounting-api
npm run worker:once
```

Los handlers de Fase 1 solo validan y confirman eventos internos conocidos. No generan asientos, facturas, efectos fiscales ni publicaciones a un broker externo.

## Contratos de eventos

Los eventos contables internos se crean exclusivamente mediante el helper `enqueueOutboxEvent` del servicio contable.

Controles aplicados:

- `event_type` y `schema_version` deben tener un contrato conocido.
- Los campos obligatorios del payload se validan antes del `INSERT`.
- El payload se normaliza a JSON antes de persistirlo.
- `payload_hash` contiene SHA-256 del payload JSON canonico.
- El worker vuelve a validar contrato y hash antes de confirmar el evento.
- Los eventos legacy sin hash pueden ser validados y reciben hash durante su consumo.
- Un evento con hash presente pero incorrecto entra en reintento y finalmente `failed`.

Backfill controlado de hashes para eventos legacy ya procesados:

```powershell
cd ..\transgest-accounting-api
npm run outbox:backfill-hashes
```

El script valida cada contrato y solo actualiza `payload_hash` cuando esta ausente. No modifica payload, estado ni fechas del evento.

Contratos v1 implementados:

- `AccountingFiscalYearOpened`
- `AccountingPeriodLocked`
- `AccountingPeriodUnlocked`
- `AccountingPeriodClosed`
- `AccountingPeriodReopened`
- `AccountingAccountCreated`
- `AccountingAccountStatusChanged`
- `AccountingChartTemplateCreated`
- `AccountingChartTemplateImported`
- `AccountingPartyCreated`
- `AccountingPartyUpdated`
- `AccountingPartyStatusChanged`
- `AccountingMaturityCreated`
- `AccountingMaturityStatusChanged`
- `AccountingBankAccountCreated`
- `AccountingBankTransactionCreated`
- `AccountingBankTransactionStatusChanged`
- `AccountingBankStatementImported`
- `AccountingBankTransactionReconciled`
- `AccountingBankReconciliationReversed`
- `AccountingJournalEntryDraftCreated`
- `AccountingJournalEntryDraftUpdated`
- `AccountingJournalEntryDraftCancelled`
- `AccountingJournalEntryReversalDraftCreated`
- `AccountingJournalEntryPosted`

## Diario manual v1

La app permite preparar y contabilizar asientos manuales mediante:

```text
GET /api/v1/journal-entries
GET /api/v1/journal-entries/:id
POST /api/v1/journal-entries/drafts
PUT /api/v1/journal-entries/:id/draft
POST /api/v1/journal-entries/:id/post
POST /api/v1/journal-entries/:id/cancel
POST /api/v1/journal-entries/:id/reverse
```

Controles:

- `journal.read` permite consultar Diario y detalle.
- `journal.write` permite crear y editar borradores manuales antes de contabilizarlos o cancelarlos.
- `journal.post` permite contabilizar un borrador.
- El listado de Diario permite filtrar por ejercicio, estado, texto de concepto/numero y rango de fechas (`date_from`, `date_to`).
- Los mismos filtros pueden exportarse como CSV con `GET /api/v1/journal-entries?format=csv`; la exportacion registra `journal_entry.csv_exported` en auditoria.
- El borrador se crea en una transaccion junto con sus lineas, auditoria y evento outbox.
- La edicion de borrador reemplaza cabecera y lineas dentro de una transaccion, mantiene el mismo ejercicio e idempotency key, recalcula periodo y hash, y registra auditoria/outbox.
- Las cuentas deben pertenecer a la empresa y ejercicio seleccionados, estar activas y admitir apuntes.
- La contabilizacion bloquea el borrador, el ejercicio y el periodo con `FOR UPDATE`.
- Solo se contabiliza si ejercicio y periodo estan abiertos y Debe = Haber con precision decimal exacta.
- La numeracion se asigna al contabilizar y es secuencial dentro del ejercicio.
- La clave idempotente de borrador conserva un hash de la peticion; reutilizarla con otro contenido se rechaza.
- Las claves foraneas del ledger usan `ON DELETE RESTRICT`; eliminar empresa, tenant, ejercicio, periodo, cuenta, asiento o linea no puede borrar asientos en cascada.
- Los borradores pueden editarse o cancelarse con motivo mediante casos de uso explicitos. No se borran fisicamente ni afectan al Mayor.
- Los asientos contabilizados no pueden editarse ni cancelarse desde estos endpoints. Pueden generar un borrador reverso revisable mediante caso de uso explicito.
- El reverso solo se crea desde un asiento `posted`, invierte Debe/Haber, exige fecha, motivo, periodo abierto e idempotencia, y enlaza `source_links` al asiento original.
- El detalle del Diario expone el origen tecnico del asiento y los `source_links` asociados cuando existen.
- `source_links` enlaza los borradores reversos con su asiento original y las importaciones externas de diario con cada fila de origen aprobada.

Migracion:

```text
005_journal_engine
007_journal_entry_cancellation
008_journal_entry_reversal
```

## Terceros contables

La app permite mantener un maestro basico de clientes, proveedores y otros terceros mediante:

```text
GET /api/v1/parties
GET /api/v1/parties?format=csv
POST /api/v1/parties
PUT /api/v1/parties/:id
PATCH /api/v1/parties/:id/status
```

Controles:

- Requiere `parties.read` para consulta y `parties.write` para altas o cambios de estado.
- Cada tercero pertenece siempre a la empresa seleccionada en la sesion contable.
- El alta se ejecuta en transaccion, registra `audit_log` y encola `AccountingPartyCreated`.
- La edicion se ejecuta en transaccion, no permite cambiar el origen externo, registra `audit_log` y encola `AccountingPartyUpdated`.
- La activacion/desactivacion exige motivo, registra `audit_log` y encola `AccountingPartyStatusChanged`.
- La exportacion CSV conserva los filtros aplicados y queda auditada con `party.csv_exported`.
- Puede asociarse una cuenta contable operativa por defecto, validada contra la misma empresa.
- No crea facturas, vencimientos, saldos, asientos ni efectos fiscales.

Migracion:

```text
009_accounting_parties
```

## Vencimientos y cartera manual

La app permite registrar cobros y pagos previstos de forma manual mediante:

```text
GET /api/v1/maturities
GET /api/v1/maturities?format=csv
POST /api/v1/maturities
PATCH /api/v1/maturities/:id/status
```

Controles:

- Requiere `maturities.read` para consulta y `maturities.write` para altas o cambios de estado.
- Cada vencimiento pertenece a la empresa seleccionada y se vincula a un tercero activo.
- Los tipos iniciales son `receivable` y `payable`.
- Los estados iniciales son `pending`, `settled` y `cancelled`.
- El alta se ejecuta en transaccion, registra `audit_log` y encola `AccountingMaturityCreated`.
- Liquidar, cancelar o reabrir exige motivo, registra `audit_log` y encola `AccountingMaturityStatusChanged`.
- La exportacion CSV conserva filtros y queda auditada con `maturity.csv_exported`.
- No genera facturas, remesas bancarias, conciliacion, saldos contables ni asientos.

Migracion:

```text
010_accounting_maturities
```

## Bancos y tesoreria manual

La app permite mantener cuentas bancarias contables y registrar movimientos manuales mediante:

```text
GET /api/v1/bank-accounts
POST /api/v1/bank-accounts
GET /api/v1/bank-transactions
GET /api/v1/bank-transactions?format=csv
POST /api/v1/bank-transactions
GET /api/v1/bank-statement-imports
PATCH /api/v1/bank-transactions/:id/status
GET /api/v1/bank-transactions/:id/reconciliation-suggestions
POST /api/v1/bank-transactions/:id/reconcile
```

Controles:

- Requiere `banks.read` para consulta y `banks.write` para altas.
- Cada cuenta bancaria y movimiento pertenece siempre a la empresa seleccionada.
- Una cuenta bancaria puede asociarse opcionalmente a una cuenta contable activa y operativa de la misma empresa.
- Los movimientos iniciales son `inflow` y `outflow`, con estado `unmatched`.
- Las altas se ejecutan en transaccion, registran `audit_log` y encolan `AccountingBankAccountCreated` o `AccountingBankTransactionCreated`.
- El cambio de estado se ejecuta con `PATCH /api/v1/bank-transactions/:id/status`; permite `ignore` desde `unmatched` a `ignored` y `reopen` desde `ignored` a `unmatched`, exige motivo, registra auditoria y encola `AccountingBankTransactionStatusChanged`.
- La importacion CSV manual se ejecuta con `POST /api/v1/bank-statement-imports`; acepta `bank_account_id`, `filename` y `csv_text`, crea un lote trazable, deduplica filas por hash estable, registra auditoria y encola `AccountingBankStatementImported`.
- El historial de importaciones se consulta con `GET /api/v1/bank-statement-imports`; requiere `banks.read`, respeta la empresa seleccionada y permite filtrar por `bank_account_id`.
- La exportacion CSV conserva filtros y queda auditada con `bank_transaction.csv_exported`.
- Las sugerencias de conciliacion se consultan con `GET /api/v1/bank-transactions/:id/reconciliation-suggestions`; solo leen datos de la empresa seleccionada, proponen vencimientos pendientes por importe exacto, direccion compatible, proximidad de fechas y texto, y no cambian estados.
- La conciliacion manual v1 exige movimiento pendiente, vencimiento pendiente, direccion compatible e importe exacto. Se ejecuta en transaccion, marca el movimiento como `matched`, liquida el vencimiento, registra auditoria y encola `AccountingBankTransactionReconciled` y `AccountingMaturityStatusChanged`.
- El reverso de conciliacion se ejecuta con `POST /api/v1/bank-reconciliations/:id/reverse`, exige motivo, anula la conciliacion sin borrado fisico, devuelve el movimiento a `unmatched`, reabre el vencimiento a `pending` y encola `AccountingBankReconciliationReversed` y `AccountingMaturityStatusChanged`.
- No importa todavia extractos bancarios normalizados como Cuaderno 43, no concilia automaticamente sin confirmacion del usuario, no genera remesas ni crea asientos.

Migracion:

```text
011_accounting_banks
012_bank_reconciliations
013_reversible_bank_reconciliations
014_bank_statement_imports
```

## Staging externo y diario importado

El endpoint `/api/v1/external-import-batches` acepta `import_type=journal_entries` para preparar lineas externas de diario sin escribir todavia en `journal_entries`. La previsualizacion exige `fiscal_year_id`, agrupa por `entry_ref`, resuelve cuentas por `account_id` o codigo, valida periodo abierto y exige Debe/Haber cuadrado.

La aplicacion de un lote aprobado crea solo borradores de diario. Cada linea creada queda enlazada en `source_links` con `source_type=external_import_journal_entry`, `source_id=entry_ref` y `source_line_id/payload_hash=row_hash`. La contabilizacion sigue requiriendo el caso de uso normal del Diario y permisos `journal.post`.

## Mayor y balance de sumas y saldos

La app permite consultar movimientos contabilizados y saldos iniciales mediante:

```text
GET /api/v1/ledger/accounts/:accountId
GET /api/v1/reports/trial-balance
GET /api/v1/reports/balance-sheet
GET /api/v1/reports/profit-loss
```

Tambien permite exportar ambas consultas en CSV manteniendo los mismos filtros:

```text
GET /api/v1/ledger/accounts/:accountId?period_id=...&format=csv
GET /api/v1/reports/trial-balance?fiscal_year_id=...&period_id=...&format=csv
GET /api/v1/reports/balance-sheet?fiscal_year_id=...&period_id=...&format=csv
GET /api/v1/reports/profit-loss?fiscal_year_id=...&period_id=...&format=csv
```

Controles:

- Requiere `ledger.read`.
- El Mayor filtra siempre por empresa seleccionada y por cuenta perteneciente a esa empresa.
- El balance exige `fiscal_year_id` y no mezcla empresas.
- `period_id` es opcional, se valida contra la empresa y ejercicio seleccionados, y se aplica tanto a la consulta como al CSV.
- Solo se consideran asientos `posted`; los borradores no afectan saldos.
- Los importes viajan como decimales textuales con seis decimales para evitar redondeos de JavaScript en API.
- La UI permite filtrar por ejercicio, periodo, cuenta y rango de fechas.
- Las exportaciones CSV se ejecutan dentro de la misma API contable, respetan RBAC y registran auditoria append-only con acciones `ledger.account_csv_exported` y `ledger.trial_balance_csv_exported`.
- Balance y PyG son informes tecnicos preliminares calculados desde saldos por tipo de cuenta (`asset`, `liability`, `equity`, `income`, `expense`) y registran CSV con acciones `ledger.balance_sheet_csv_exported` y `ledger.profit_loss_csv_exported`.
- No existen todavia exportaciones PDF, paginacion avanzada de exportaciones grandes ni paquete formal para presentacion legal.
- No se declara que Balance, PyG o sumas y saldos sean informes legales cerrados sin revision contable externa.

Migracion:

```text
006_ledger_read_permission
```

## Operacion administrativa del outbox

La app contable expone una vista administrativa "Eventos" y los endpoints:

```text
GET /api/v1/outbox-events
POST /api/v1/outbox-events/:id/retry
```

Permisos:

- `outbox.read`: consulta de metadatos, estado, intentos y ultimo error.
- `outbox.retry`: solicitud de reintento de eventos `failed`.
- Ambos permisos quedan reservados a `accounting_admin` en Fase 1.

Reglas de reintento:

- Solo se puede reintentar desde estado `failed`.
- Requiere motivo de al menos 5 caracteres.
- El cambio se ejecuta en transaccion y con bloqueo `FOR UPDATE`.
- Reinicia intentos, limpia el error y deja el evento en `pending`.
- Registra `outbox_event.retry_requested` en `audit_log`.
- No muestra ni permite editar el payload desde la UI.

## Fuera de alcance

- Facturas fiscales.
- VERI*FACTU.
- Factura electronica B2B.
- SII.
- Asientos automaticos.
- Fiscalidad o contabilizacion automatica desde terceros.
- Liquidacion bancaria, remesas SEPA y contabilizacion automatica desde vencimientos.
- Plan contable PGC/PGC PYMES.
- Exportaciones PDF y paquetes formales para asesorias.
- Informes contables legales cerrados: Balance de situacion/PyG con epigrafes oficiales validados, IVA, cierres y comparativas.
