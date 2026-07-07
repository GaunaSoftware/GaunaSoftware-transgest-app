# TransGest Contabilidad - Modelo inicial de datos

Fecha: 2026-06-04

El modelo separa contabilidad financiera, facturacion fiscal y adaptadores regulatorios. Los nombres son iniciales y deben ajustarse durante diseno fisico y migraciones.

## Principios

- Todas las tablas contables incluyen `tenant_id` y `company_id`.
- El `company_id` contable referencia una empresa juridica contable, no solo una cuenta SaaS.
- Las tablas contables viven en BD o esquema aislado.
- Solo `transgest-accounting-api` puede escribir en ledger.
- Otros modulos publican eventos o llaman casos de uso; nunca insertan asientos directamente.
- No hay borrado fisico de asientos. Correcciones mediante reversos, rectificativos o regularizaciones.
- Todos los importes usan `NUMERIC(18,6)` en lineas y redondeo controlado para informes.
- Trazabilidad obligatoria: documento fuente, evento fuente, usuario/proceso, request id y version de esquema.

## Identidad, empresa y permisos

### `accounting_tenants`

- `id`
- `source_system`
- `source_tenant_id`
- `name`
- `created_at`

### `accounting_companies`

- `id`
- `tenant_id`
- `source_company_id`
- `legal_name`
- `tax_id`
- `country`
- `accounting_standard_id`
- `default_currency`
- `status`
- `created_at`
- `updated_at`

Relaciones:

- `accounting_tenants 1:N accounting_companies`
- `source_company_id` enlaza con `empresas.id` de TransGest mediante referencia logica, no FK cross-db.

### `accounting_users`

- `id`
- `source_user_id`
- `email`
- `display_name`
- `status`
- `created_at`

### `accounting_company_memberships`

- `id`
- `tenant_id`
- `company_id`
- `user_id`
- `role`
- `permissions jsonb`
- `created_at`
- `updated_at`

Unicidad:

- `(company_id, user_id)`

## Ejercicios y periodos

### `fiscal_years`

- `id`
- `tenant_id`
- `company_id`
- `year_label`
- `start_date`
- `end_date`
- `status` (`draft`, `open`, `closing`, `closed`, `archived`)
- `closed_at`
- `closed_by`

Unicidad:

- `(company_id, year_label)`

### `accounting_periods`

- `id`
- `tenant_id`
- `company_id`
- `fiscal_year_id`
- `period_number`
- `name`
- `start_date`
- `end_date`
- `status` (`open`, `locked`, `closed`)
- `locked_reason`
- `closed_at`
- `closed_by`

Unicidad:

- `(fiscal_year_id, period_number)`

Al cerrar un periodo se registran `closed_at` y `closed_by`. Al reabrirlo se limpia ese sello y queda la accion en `audit_log`/outbox con motivo obligatorio.

## Plan contable

### `accounting_standards`

- `id`
- `code`
- `name`
- `jurisdiction`
- `source_url`
- `source_checksum`
- `version_label`
- `effective_from`
- `effective_to`
- `status` (`draft`, `validated`, `retired`)
- `review_notes`

No se insertan estandares oficiales hasta validar fuente, version efectiva y revision externa.

### `chart_templates`

- `id`
- `tenant_id` y `company_id` para plantillas internas de empresa; nulos para futuras plantillas de sistema
- `standard_id`
- `template_scope` (`system`, `company`)
- `code`
- `version_label`
- `name`
- `status` (`draft`, `published`, `retired`)
- `source_type` (`company_snapshot`, `validated_standard`, `manual`)
- `source_url`
- `source_checksum`
- `effective_from`
- `created_by`
- `created_at`
- `published_at`

### `chart_template_accounts`

- `id`
- `template_id`
- `code`
- `name`
- `account_type`
- `parent_code`
- `is_postable`
- `notes`

### `chart_template_imports`

- `id`
- `tenant_id`
- `company_id`
- `fiscal_year_id`
- `template_id`
- `idempotency_key`
- `template_checksum`
- `inserted_count`
- `matching_count`
- `conflict_count`
- `created_by`
- `created_at`

Unicidad:

- `(company_id, fiscal_year_id, template_id)`
- `(company_id, idempotency_key)`

### `accounts`

- `id`
- `tenant_id`
- `company_id`
- `fiscal_year_id`
- `code`
- `name`
- `account_type` (`asset`, `liability`, `equity`, `income`, `expense`, `memorandum`)
- `parent_account_id`
- `is_postable`
- `is_active`
- `report_mapping jsonb`
- `created_at`
- `updated_at`

Unicidad:

- `(company_id, fiscal_year_id, code)`

Reglas:

- Solo cuentas `is_postable=true` admiten lineas de asiento.
- No se borra una cuenta con movimientos.

## Ledger y asientos

### `journal_entries`

- `id`
- `tenant_id`
- `company_id`
- `fiscal_year_id`
- `period_id`
- `entry_number`
- `entry_date`
- `posting_date`
- `description`
- `status` (`draft`, `posted`, `cancelled`)
- `entry_type` (`manual`, `reversal`, `depreciation`, `fixed_asset_disposal`)
- `source_system`
- `source_type`
- `source_id`
- `source_event_id`
- `idempotency_key`
- `request_hash`
- `trace_id`
- `request_id`
- `created_by`
- `created_at`
- `cancelled_at`
- `cancelled_by`
- `cancel_reason`
- `reversed_by_entry_id`
- `reversal_of_entry_id`
- `reversal_reason`

Unicidad:

- `(company_id, fiscal_year_id, entry_number)`
- `(company_id, idempotency_key)` cuando `idempotency_key` no es nula.
- `(company_id, source_event_id)` cuando `source_event_id` no es nula y genera asiento unico.
- `(company_id, reversal_of_entry_id)` cuando `reversal_of_entry_id` no es nula.

### `journal_lines`

- `id`
- `tenant_id`
- `company_id`
- `journal_entry_id`
- `line_number`
- `account_id`
- `party_id`
- `debit_amount`
- `credit_amount`
- `currency`
- `description`
- `source_line_id`
- `tax_code_id`
- `cost_center_id`
- `created_at`

Checks:

- `debit_amount >= 0`
- `credit_amount >= 0`
- una linea no puede tener Debe y Haber simultaneos salvo que ambos sean cero y este prohibido por validacion de dominio.

Regla de transaccion:

- Antes de confirmar, el caso de uso valida que `SUM(debit_amount) = SUM(credit_amount)` por asiento.
- Los borradores pueden estar descuadrados para permitir preparacion y pueden editarse antes de contabilizarse o cancelarse.
- La edicion de un borrador reemplaza cabecera y lineas dentro de una transaccion, recalcula periodo y `request_hash`, y registra auditoria/outbox.
- Los borradores pueden cancelarse con motivo. La cancelacion cambia el estado a `cancelled`, registra auditoria y no borra lineas.
- La contabilizacion vuelve a validar cuentas, ejercicio, periodo e igualdad exacta de Debe y Haber.
- La numeracion se asigna solo al contabilizar y queda acotada por ejercicio.
- La idempotencia de borrador compara `idempotency_key` y `request_hash`.
- Un asiento contabilizado puede generar un unico borrador reverso. El reverso invierte Debe/Haber, exige motivo y periodo abierto, y queda enlazado mediante `reversal_of_entry_id`, `reversed_by_entry_id` y `source_links`.
- El detalle read-only del Diario devuelve `source_links` para mostrar trazabilidad de origen sin exponer endpoints de escritura directa.
- Las importaciones externas de diario crean solo borradores y enlazan cada linea importada mediante `source_links` con `source_type=external_import_journal_entry`.
- Las relaciones del ledger usan borrado restringido; no se permite eliminar asientos por cascada desde tenant, empresa, ejercicio, periodo o cuenta.

### `source_links`

- `id`
- `tenant_id`
- `company_id`
- `journal_entry_id`
- `journal_line_id`
- `source_system`
- `source_type`
- `source_id`
- `source_line_id`
- `source_event_id`
- `document_url`
- `payload_hash`
- `created_at`

Uso:

- Permite navegar desde asiento a factura, pedido, cobro, extracto, envio fiscal o documento.
- En importaciones externas de diario, `source_id` conserva la referencia externa del asiento y `source_line_id`/`payload_hash` conservan el hash de fila aprobada.

## Clientes, proveedores y vencimientos

### `accounting_parties`

- `id`
- `tenant_id`
- `company_id`
- `source_system`
- `source_party_id`
- `party_type` (`customer`, `supplier`, `customer_supplier`, `employee`, `tax_authority`, `bank`, `other`)
- `legal_name`
- `tax_id`
- `email`
- `phone`
- `default_account_id`
- `notes`
- `is_active`
- `created_by`
- `created_at`
- `updated_at`

Unicidad:

- `(company_id, source_system, source_party_id)`

Estado implementado:

- Tabla `accounting_parties` creada por `009_accounting_parties`.
- Permisos `parties.read` y `parties.write`.
- Endpoints read/write controlados por la API contable.
- Auditoria append-only y outbox en altas, ediciones y cambios de estado.
- Exportacion CSV auditada con los filtros aplicados.
- No genera facturas, vencimientos, impuestos ni asientos.

### `receivables`

- `id`
- `tenant_id`
- `company_id`
- `party_id`
- `source_invoice_id`
- `journal_entry_id`
- `due_date`
- `amount`
- `open_amount`
- `status`

### `payables`

- igual que `receivables`, orientado a proveedores.

### `accounting_maturities`

- `id`
- `tenant_id`
- `company_id`
- `party_id`
- `direction` (`receivable`, `payable`)
- `issue_date`
- `due_date`
- `document_ref`
- `description`
- `amount`
- `open_amount`
- `currency`
- `payment_method`
- `status` (`pending`, `settled`, `cancelled`)
- `source_system`
- `source_type`
- `source_id`
- `import_id`
- `notes`
- `settled_at`
- `settled_by`
- `cancelled_at`
- `cancelled_by`
- `status_reason`
- `created_by`
- `created_at`
- `updated_at`

Estado implementado:

- Tabla `accounting_maturities` creada por `010_accounting_maturities`.
- Permisos `maturities.read` y `maturities.write`.
- Endpoints controlados por la API contable para consulta, alta y cambio de estado.
- Auditoria append-only y outbox en altas y cambios de estado.
- Exportacion CSV auditada con filtros aplicados.
- No genera facturas, remesas bancarias, conciliacion, impuestos ni asientos.

## Impuestos

### `tax_codes`

- `id`
- `tenant_id`
- `company_id`
- `code`
- `name`
- `tax_type` (`vat_output`, `vat_input`, `withholding`, `other`)
- `rate`
- `account_id`
- `valid_from`
- `valid_to`
- `metadata jsonb`

### `tax_ledger`

- `id`
- `tenant_id`
- `company_id`
- `journal_entry_id`
- `journal_line_id`
- `tax_code_id`
- `tax_base`
- `tax_amount`
- `direction` (`input`, `output`)
- `source_invoice_id`
- `created_at`

## Facturacion fiscal centralizada

Estas tablas pueden vivir en `fiscal-billing-service`, no necesariamente en la BD contable.

### `fiscal_invoices`

- `id`
- `tenant_id`
- `company_id`
- `source_system`
- `source_document_type`
- `source_document_id`
- `series`
- `number`
- `issue_date`
- `customer_party_id`
- `status` (`draft`, `issued`, `rectified`, `cancelled`)
- `currency`
- `subtotal`
- `tax_total`
- `total`
- `regulatory_mode` (`none`, `verifactu`, `sii`)
- `created_by`
- `created_at`

### `fiscal_invoice_lines`

- `id`
- `invoice_id`
- `line_number`
- `description`
- `quantity`
- `unit_price`
- `tax_code`
- `tax_rate`
- `subtotal`
- `tax_amount`
- `total`
- `source_line_id`

### `fiscal_records`

- `id`
- `invoice_id`
- `tenant_id`
- `company_id`
- `adapter`
- `adapter_version`
- `schema_version`
- `record_type`
- `hash_previous`
- `fingerprint`
- `qr_text`
- `payload`
- `status`
- `created_at`

### `fiscal_submissions`

- `id`
- `record_id`
- `adapter`
- `adapter_version`
- `environment`
- `status`
- `attempt`
- `payload`
- `response`
- `error`
- `next_retry_at`
- `processed_at`
- `created_at`

### `fiscal_events`

- `id`
- `record_id`
- `invoice_id`
- `tenant_id`
- `company_id`
- `event_type`
- `detail`
- `created_at`

## Eventos e idempotencia

### `transactional_outbox`

- `event_id`
- `tenant_id`
- `company_id`
- `event_type`
- `aggregate_type`
- `aggregate_id`
- `schema_version`
- `payload`
- `payload_hash`
- `trace_id`
- `occurred_at`
- `available_at`
- `status`
- `attempts`
- `published_at`
- `last_error`

Indices:

- `(status, available_at)`
- `(tenant_id, company_id, occurred_at)`
- `(event_type, occurred_at)`

### `consumer_offsets`

- `id`
- `consumer_name`
- `event_id`
- `event_type`
- `payload_hash`
- `processed_at`
- `result_type`
- `result_id`
- `error`

Unicidad:

- `(consumer_name, event_id)`

### `idempotency_keys`

- `id`
- `tenant_id`
- `company_id`
- `key`
- `operation`
- `request_hash`
- `response_ref`
- `created_at`
- `expires_at`

Unicidad:

- `(company_id, operation, key)`

## Auditoria append-only

### `audit_events`

- `id`
- `tenant_id`
- `company_id`
- `actor_type`
- `actor_id`
- `actor_email`
- `action`
- `entity_type`
- `entity_id`
- `request_id`
- `trace_id`
- `before_hash`
- `after_hash`
- `detail`
- `created_at`

Controles propuestos:

- Triggers que rechacen UPDATE/DELETE.
- Rol SQL de aplicacion sin permiso para modificar filas antiguas.
- Hash encadenado opcional por empresa.
- Exportacion auditada.

## Bancos y conciliacion

### `accounting_bank_accounts`

- `id`
- `tenant_id`
- `company_id`
- `account_id` opcional hacia `accounts`
- `name`
- `bank_name`
- `iban`
- `swift_bic`
- `currency`
- `opening_balance`
- `is_active`
- `notes`
- `created_by`
- `created_at`
- `updated_at`

### `bank_transactions`

- `id`
- `tenant_id`
- `company_id`
- `bank_account_id`
- `transaction_date`
- `value_date`
- `description`
- `reference`
- `counterparty_name`
- `amount`
- `direction` (`inflow`, `outflow`)
- `status` (`unmatched`, `matched`, `ignored`)
- `source_system`
- `source_type`
- `source_id`
- `notes`
- `created_by`
- `created_at`
- `updated_at`

Estado implementado:

- Tablas `accounting_bank_accounts` y `bank_transactions` creadas por `011_accounting_banks`.
- Permisos `banks.read` y `banks.write`.
- Endpoints controlados por la API contable para consulta y alta manual.
- Auditoria append-only y outbox en altas.
- Cambio auditado de estado `unmatched` -> `ignored` y `ignored` -> `unmatched` con motivo obligatorio y evento `AccountingBankTransactionStatusChanged`.
- Exportacion CSV auditada de movimientos bancarios con filtros aplicados.
- Importacion CSV manual de extractos con lote trazable creada por `014_bank_statement_imports`.
- Conciliacion manual exacta contra vencimientos creada por `012_bank_reconciliations`.
- Reverso auditado de conciliaciones creado por `013_reversible_bank_reconciliations`.
- No importa todavia formatos bancarios normalizados como Cuaderno 43, no concilia automaticamente, no genera remesas y no crea asientos.

### `bank_statement_imports`

Implementado inicialmente para importaciones CSV manuales no normalizadas.

- `id`
- `tenant_id`
- `company_id`
- `bank_account_id`
- `source_type` (`csv_manual`)
- `original_filename`
- `request_hash`
- `row_count`
- `inserted_count`
- `skipped_count`
- `error_count`
- `imported_by`
- `created_at`

Reglas actuales:

- El endpoint controlado es `POST /api/v1/bank-statement-imports`.
- Requiere `banks.write`.
- Acepta CSV pegado con cabeceras como `fecha`, `fecha_valor`, `descripcion`, `referencia`, `contraparte`, `importe` y `tipo`.
- El signo del importe infiere `inflow` u `outflow` cuando `tipo` esta vacio.
- Cada fila importada genera un `source_id` hash estable y se deduplica por empresa, cuenta, origen y `source_id`.
- Repetir exactamente el mismo lote usa `request_hash` y devuelve el lote existente sin duplicar movimientos.
- El historial se consulta con `GET /api/v1/bank-statement-imports`, aislado por empresa seleccionada y con filtro opcional por cuenta bancaria.
- No interpreta Cuaderno 43, Norma 43, ficheros AEB ni otros formatos bancarios regulados o normalizados.

### `reconciliations`

Implementado inicialmente como `bank_reconciliations` para conciliacion bancaria manual uno-a-uno.

- `id`
- `tenant_id`
- `company_id`
- `bank_transaction_id`
- `maturity_id`
- `matched_amount`
- `matched_by`
- `matched_at`
- `reason`
- `status` (`active`, `voided`)
- `voided_at`
- `voided_by`
- `void_reason`
- `created_at`

Reglas actuales:

- Un movimiento bancario solo puede tener una conciliacion activa.
- Un vencimiento solo puede tener una conciliacion activa.
- Solo se concilian movimientos `unmatched` con vencimientos `pending`.
- `inflow` concilia con `receivable`; `outflow` concilia con `payable`.
- El importe debe coincidir exactamente con `open_amount`.
- Las sugerencias de conciliacion no se persisten como entidad: se calculan en lectura desde `bank_transactions`, `accounting_maturities` y `accounting_parties`.
- La puntuacion de sugerencias prioriza importe exacto, tipo compatible, cercania entre fecha bancaria y vencimiento, coincidencias de texto y contraparte.
- Conciliar marca el movimiento como `matched` y el vencimiento como `settled`.
- Revertir una conciliacion marca la fila como `voided`, conserva motivo y usuario, devuelve el movimiento a `unmatched` y reabre el vencimiento como `pending`.
- Los indices unicos activos son parciales sobre `status = 'active'`, por lo que una conciliacion anulada no impide una nueva conciliacion posterior del mismo movimiento y vencimiento.

## Inmovilizado

### `accounting_fixed_assets`

- `id`
- `tenant_id`
- `company_id`
- `fiscal_year_id`
- `asset_code`
- `name`
- `acquisition_date`
- `acquisition_cost`
- `residual_value`
- `useful_life_months`
- `depreciation_method` (`straight_line` en la version inicial)
- `asset_account_id`
- `accumulated_depreciation_account_id`
- `expense_account_id`
- `status` (`active`, `inactive`, `disposed`)
- `source_system`
- `source_type`
- `source_id`
- `notes`
- `disposed_at`
- `status_reason`
- `created_by`
- `created_at`
- `updated_at`

Unicidad:

- `(company_id, fiscal_year_id, asset_code)`

Estado implementado:

- Tabla creada por `018_fixed_assets`.
- Permisos `fixed_assets.read` y `fixed_assets.write`.
- Altas manuales, consulta filtrable, CSV auditado y cambio de estado con motivo desde la API contable.
- Plan de amortizacion lineal calculado bajo demanda; no se persiste como plan oficial ni genera asientos.
- Eventos `AccountingFixedAssetCreated` y `AccountingFixedAssetStatusChanged`.
- Las amortizaciones pueden preparar borradores de Diario mediante `depreciation_runs`, pero requieren revision y contabilizacion manual.
- La baja asistida comprueba pendientes de amortizacion, muestra valor neto estimado y bloquea la baja si existen borradores o reversos pendientes.
- La baja por retirada puede preparar un borrador en Diario con `entry_type='fixed_asset_disposal'`: Debe amortizacion acumulada, Debe perdida por valor neto si procede y Haber cuenta del activo.
- Al contabilizar ese borrador desde Diario, el activo pasa a `disposed` en la misma transaccion y se emiten eventos de baja contabilizada y cambio de estado.
- No hay integracion automatica con facturas recibidas, no hay baja por venta con ingreso y no se declara cumplimiento fiscal o contable.

### `depreciation_plans`

- `id`
- `fixed_asset_id`
- `method`
- `start_date`
- `end_date`
- `rate`
- `periodicity`
- `metadata`

### `depreciation_runs`

- `id`
- `tenant_id`
- `company_id`
- `fixed_asset_id`
- `fiscal_year_id`
- `period_id`
- `amount`
- `run_date`
- `plan_from_date`
- `plan_to_date`
- `plan_periods`
- `status` (`draft_created`, `posted`, `cancelled`, `reversal_draft_created`, `reversed`)
- `cancelled_at`
- `cancelled_by`
- `cancel_reason`
- `journal_entry_id`
- `reversal_journal_entry_id`
- `reversal_reason`
- `reversed_at`
- `reversed_by`
- `idempotency_key`
- `created_by`
- `created_at`

Unicidad:

- `(fixed_asset_id, period_id)`
- `(company_id, idempotency_key)`

Estado implementado:

- Tabla creada por `019_depreciation_runs`.
- Cancelacion creada por `020_depreciation_run_cancellation`; la unicidad por activo/periodo se mantiene solo para ejecuciones activas `draft_created`.
- Estado `posted` creado por `021_depreciation_run_posting`; la unicidad por activo/periodo cubre ejecuciones `draft_created` y `posted`.
- Estados de reverso creados por `022_depreciation_run_reversal`: `reversal_draft_created` mantiene bloqueado activo/periodo y `reversed` lo libera para rehacer la amortizacion si procede.
- Cada ejecucion crea un borrador en `journal_entries` con `entry_type='depreciation'`.
- La escritura exige `fixed_assets.write` y `journal.write`.
- El borrador tiene dos lineas: Debe en cuenta de gasto de amortizacion y Haber en cuenta de amortizacion acumulada.
- `source_links` enlaza el borrador con el inmovilizado y los periodos del plan usados.
- Cancelar una ejecucion marca tambien el borrador de Diario como `cancelled`, conserva motivo y emite evento `AccountingFixedAssetDepreciationDraftCancelled`.
- Contabilizar el borrador asociado desde Diario marca la ejecucion como `posted` y emite `AccountingFixedAssetDepreciationPosted`.
- Crear un reverso desde Diario sobre una amortizacion contabilizada marca la ejecucion como `reversal_draft_created`, guarda `reversal_journal_entry_id` y emite `AccountingFixedAssetDepreciationReversalDraftCreated`.
- Cancelar el reverso en borrador restaura la ejecucion a `posted` y emite `AccountingFixedAssetDepreciationReversalDraftCancelled`.
- Contabilizar el reverso marca la ejecucion como `reversed`, conserva `reversed_at`/`reversed_by` y emite `AccountingFixedAssetDepreciationReversed`.
- No existe contabilizacion automatica ni masiva; el usuario debe revisar y contabilizar desde Diario.

## Infraestructura de eventos implementada en Fase 1

### `outbox_events`

- Guarda el evento en la misma transaccion que el cambio de negocio.
- Estados iniciales: `pending`, `processing`, `retry`, `processed`, `failed`.
- `available_at` actua como fecha de disponibilidad y lease de procesamiento.
- `attempts` y `last_error` permiten reintentos y diagnostico.
- `schema_version` identifica el contrato versionado.
- `payload_hash` contiene SHA-256 del payload JSON canonico y permite verificar integridad.

### `processed_events`

- Registra el consumo idempotente por `consumer_name` y `event_id`.
- La unicidad `(consumer_name, event_id)` evita aplicar dos veces el mismo evento.
- `result_ref` conserva la referencia tecnica producida por el handler.

## Ledger implementado parcialmente

La migracion `005_journal_engine` implementa `journal_entries`, `journal_lines` y `source_links` para el Diario manual v1. La migracion `006_ledger_read_permission` habilita el permiso `ledger.read`. La migracion `007_journal_entry_cancellation` permite cancelar borradores sin borrado fisico.

El unico flujo de escritura disponible es:

```text
CreateManualJournalDraft -> PostManualJournalEntry
CancelManualJournalDraft
```

No existen endpoints para insertar lineas directamente. Facturas, cobros, pagos y otros modulos no generan asientos todavia. La correccion mediante reversos ya conserva enlaces internos en `source_links`; la trazabilidad desde eventos externos sigue pendiente.

Consultas read-only implementadas:

- `GET /api/v1/ledger/accounts/:accountId`: Mayor de una cuenta con movimientos `posted` y saldo acumulado.
- `GET /api/v1/reports/trial-balance`: balance inicial de sumas y saldos por ejercicio.
- `GET /api/v1/reports/balance-sheet`: Balance preliminar por tipos de cuenta `asset`, `liability` y `equity`.
- `GET /api/v1/reports/profit-loss`: PyG preliminar por tipos de cuenta `income` y `expense`.
- `period_id` opcional limita ambas consultas a un periodo del mismo ejercicio y empresa.
- `format=csv` en ambas consultas genera descarga CSV y registra `audit_log` con la accion de exportacion y los filtros aplicados.

No existe una tabla fisica de saldos en esta version. Los saldos y los informes preliminares se calculan desde `journal_lines`, `journal_entries` contabilizados y el `account_type` de cada cuenta. La clasificacion oficial por epigrafes PGC/PGC PYMES queda pendiente de fuente oficial validada y revision externa.

## Relaciones clave

```text
accounting_tenants 1:N accounting_companies
accounting_companies 1:N fiscal_years
fiscal_years 1:N accounting_periods
fiscal_years 1:N accounts
accounting_periods 1:N journal_entries
journal_entries 1:N journal_lines
journal_entries 1:N source_links
accounts 1:N journal_lines
accounts 1:N accounting_parties (default_account_id opcional)
accounting_parties 1:N receivables/payables
accounting_parties 1:N accounting_maturities
fiscal_invoices 1:N fiscal_invoice_lines
fiscal_invoices 1:N fiscal_records
fiscal_records 1:N fiscal_submissions
transactional_outbox 1:1..N consumer_offsets
```

## Casos de uso que escriben en ledger

- `PostManualJournalEntry`
- `PostFiscalInvoiceIssued`
- `PostFiscalInvoiceRectified`
- `PostSupplierInvoiceAccepted`
- `RegisterCustomerPayment`
- `RegisterSupplierPayment`
- `PostBankReconciliation`
- `PostDepreciation`
- `CloseAccountingPeriod`
- `ReopenAccountingPeriod`
- `ReverseJournalEntry`

Todos deben:

- Validar RBAC.
- Validar empresa y tenant.
- Validar periodo abierto.
- Validar idempotencia.
- Crear auditoria append-only.
- Guardar source links.
- Publicar evento si procede.
