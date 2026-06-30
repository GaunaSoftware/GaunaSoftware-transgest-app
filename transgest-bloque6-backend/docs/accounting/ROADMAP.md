# TransGest Contabilidad - Roadmap

Fecha: 2026-06-12

## Estado global estimado

Estimacion de finalizacion del modulo completo: **45%**.

Esta cifra mide TransGest Contabilidad frente al objetivo de una solucion contable profesional para pymes espanolas, no solo frente a la Fase 1 tecnica. El avance actual cubre fundacion SaaS, SSO, multiempresa, RBAC, auditoria, outbox, plan contable manual, ejercicios/periodos, Diario manual, Mayor, informes preliminares, terceros, cartera manual de vencimientos, tesoreria bancaria manual, importacion CSV manual de extractos con historial de lotes, conciliacion manual exacta uno-a-uno, sugerencias asistidas de conciliacion, reverso auditado de conciliaciones, ignorar/reabrir movimientos bancarios con motivo e inmovilizado preliminar con plan de amortizacion lineal y generacion controlada de borradores de amortizacion. Quedan fuera todavia facturacion fiscal centralizada, IVA, facturas emitidas/recibidas, conciliacion bancaria automatica, importaciones bancarias normalizadas como Cuaderno 43, contabilizacion masiva de amortizaciones, bajas contables completas, cierres avanzados, adaptadores regulatorios y validacion legal externa.

No se declara cumplimiento legal por el estado del codigo. Cualquier ambito fiscal, VERI*FACTU, factura electronica B2B, SII o conservacion documental requiere confirmacion con fuente oficial aplicable, asesor fiscal y/o revision juridica.

El roadmap se divide en entregas pequenas para reducir riesgo. Cada entrega debe quedar desplegable, con migraciones versionadas, tests minimos y documentacion de rollback.

## Entrega 0 - Fundacion tecnica

Objetivo:

- Crear estructura de servicios contables y fiscal billing sin modificar comportamiento productivo.
- Definir contratos internos y eventos versionados.

Alcance:

- Carpetas `transgest-accounting-api`, `transgest-accounting-frontend`, `fiscal-billing-service` o ADR si se aplaza la creacion.
- Docker Compose local extendido con BD contable aislada.
- Migrador contable con checksum.
- Health checks.
- Contratos JSON para eventos iniciales.

Criterios de aceptacion:

- `docker compose` puede levantar TransGest y servicios contables en local.
- Accounting API responde `/health`.
- BD contable existe con usuario SQL propio.
- No hay escritura directa desde `transgest-api` a tablas contables.
- Documentado rollback: apagar servicios nuevos y eliminar volumen contable local sin afectar TransGest.

Estado Fase 1:

- Implementado esqueleto de `transgest-accounting-api`.
- Implementado esqueleto de `transgest-accounting-frontend`.
- Implementado SSO inicial desde TransGest.
- Implementado lanzador desde TransGest con apertura en pestana independiente y enlace de retorno para conservar acceso a la aplicacion principal.
- Implementado smoke test de conexion TransGest -> Contabilidad para login, SSO, empresa y permisos.
- Implementada auditoria de seleccion de empresa y de intentos cross-company denegados.
- Implementado primer centro de trabajo contable con resumen de preparacion y accesos directos.
- Implementado plan contable configurable manual por empresa y ejercicio: consulta, filtro, alta y activacion/desactivacion auditada.
- Implementados eventos `AccountingAccountCreated` y `AccountingAccountStatusChanged`.
- Implementado maestro basico de terceros contables: clientes, proveedores y otros terceros, con RBAC, auditoria, edicion controlada, CSV auditado, outbox y sin facturas ni asientos automaticos.
- Implementados eventos `AccountingPartyCreated`, `AccountingPartyUpdated` y `AccountingPartyStatusChanged`.
- Implementada cartera manual de vencimientos de cobro y pago, con RBAC, auditoria, CSV auditado, outbox y sin remesas, bancos ni asientos automaticos.
- Implementados eventos `AccountingMaturityCreated` y `AccountingMaturityStatusChanged`.
- Implementada tesoreria bancaria manual: cuentas bancarias por empresa, movimientos de entrada/salida, filtros, CSV auditado, RBAC, auditoria y outbox.
- Implementados eventos `AccountingBankAccountCreated` y `AccountingBankTransactionCreated`.
- Implementada conciliacion bancaria manual v1: movimiento bancario pendiente contra vencimiento pendiente, uno-a-uno, misma empresa, direccion compatible e importe exacto.
- Implementadas sugerencias asistidas de conciliacion: candidatos de vencimiento por importe exacto, direccion compatible, proximidad de fechas y coincidencias de texto, siempre con confirmacion manual del usuario.
- Implementado evento `AccountingBankTransactionReconciled`; la conciliacion liquida el vencimiento y encola tambien `AccountingMaturityStatusChanged`.
- Implementado reverso auditado de conciliacion bancaria: anula la conciliacion sin borrado fisico, devuelve el movimiento a pendiente, reabre el vencimiento y emite `AccountingBankReconciliationReversed`.
- Implementada importacion CSV manual de extractos bancarios, con lote trazable, deduplicacion por fila normalizada, auditoria y evento `AccountingBankStatementImported`.
- Implementado historial de lotes CSV en Bancos, con consulta por empresa seleccionada y contadores de filas, movimientos insertados, duplicados y errores.
- Implementado cambio auditado de estado de movimientos bancarios para ignorar y reabrir movimientos con motivo, emitiendo `AccountingBankTransactionStatusChanged`.
- Implementado registro preliminar de inmovilizado: altas manuales por ejercicio, filtros, CSV auditado, cambio de estado, vista de plan de amortizacion lineal y eventos `AccountingFixedAssetCreated` y `AccountingFixedAssetStatusChanged`.
- Implementada generacion controlada de borradores de amortizacion desde inmovilizado: exige activo vigente, periodo abierto, cuentas configuradas e idempotencia por activo/periodo; crea `depreciation_runs`, asiento borrador y `source_links`.
- Pendiente contabilizacion masiva, cancelacion/reversion especifica de ejecuciones de amortizacion, bajas contables completas, integracion con facturas recibidas y validacion externa de criterios fiscales/contables.
- Pendiente conciliacion automatica, importacion Cuaderno 43 u otros formatos normalizados, conciliaciones parciales, remesas y generacion de asientos desde bancos.
- Implementado catalogo versionado de plantillas internas creadas desde un ejercicio existente.
- Implementadas vista previa e importacion transaccional/idempotente de plantillas sin sobrescribir cuentas existentes.
- Implementados eventos `AccountingChartTemplateCreated` y `AccountingChartTemplateImported`.
- Implementado Diario manual v1 con borradores editables de forma controlada, consulta filtrable y detalle.
- Implementado caso de uso explicito de contabilizacion con partida doble exacta, numeracion secuencial por ejercicio y rechazo de periodos no abiertos.
- Implementada edicion transaccional de borradores no contabilizados, con reemplazo completo de lineas, auditoria y outbox.
- Implementada cancelacion controlada de borradores con motivo, auditoria, outbox y sin borrado fisico.
- Implementada idempotencia de borradores mediante clave y hash de peticion, con auditoria y eventos `AccountingJournalEntryDraftCreated`, `AccountingJournalEntryDraftUpdated`, `AccountingJournalEntryDraftCancelled` y `AccountingJournalEntryPosted`.
- Implementado Mayor por cuenta y balance inicial de sumas y saldos calculados desde asientos contabilizados.
- Implementados informes preliminares de Balance de situacion y PyG desde saldos por tipo de cuenta, con CSV auditado y aviso de no validez legal cerrada.
- Implementada migracion `006_ledger_read_permission` para permiso `ledger.read`.
- Implementada exportacion CSV auditada de Mayor y sumas/saldos desde la API y la UI contable.
- Pendiente importar plantillas PGC/PGC PYMES desde una fuente oficial validada y versionada.
- Implementadas migraciones `up/down` para entidades base.
- Implementada apertura transaccional de ejercicios con periodos mensuales, auditoria y outbox.
- Implementadas transiciones basicas de periodo (`lock`, `unlock`, `close`, `reopen`) con RBAC, motivo obligatorio, auditoria y outbox.
- Implementada consulta read-only de `audit_log` con permiso `audit.read`, filtros basicos y aislamiento por empresa seleccionada.
- Implementado `accounting-worker` para consumo outbox con lease, reintentos, backoff y deduplicacion mediante `processed_events`.
- Implementados contratos v1 de eventos, enqueue centralizado y verificacion SHA-256 de integridad del payload.
- Implementada operacion administrativa del outbox con listado aislado por empresa y reintento auditado exclusivo para eventos `failed`.
- Implementada proteccion append-only de `audit_log` mediante trigger reversible contra `UPDATE`, `DELETE` y `TRUNCATE`.
- Separados migrador/provisioner del runtime contable; API y worker usan roles PostgreSQL distintos, sin DDL ni acceso a tablas operativas, y el worker queda limitado a outbox e idempotencia.
- Pendiente evolucionar a BD contable separada en produccion si se aprueba esa decision.
- Pendiente retirar privilegios de superusuario al backend TransGest existente para aislamiento SQL completo.
- Siguiente incremento de conexion: outbox de TransGest y puente de eventos versionados, inicialmente sin generar asientos.
- La conexion financiera de facturas/cobros comenzara tras implementar plan contable y motor de asientos.

## Entrega 1 - SSO, empresas, ejercicios, periodos y RBAC

Objetivo:

- Abrir Contabilidad desde TransGest con contexto de empresa y permisos.

Alcance:

- SSO one-time code.
- `accounting_companies`, `fiscal_years`, `accounting_periods`.
- Roles/permisos contables por empresa.
- Auditoria append-only basica.

Criterios de aceptacion:

- Usuario con permiso `accounting:access` entra a Contabilidad sin reloguear.
- Usuario sin permiso recibe 403.
- Permisos se evalua en backend contable.
- Se puede crear ejercicio y periodos para una empresa.
- Periodos tienen estados `open`, `locked`, `closed`.
- Acceso cross-company falla en API y queda auditado.

## Entrega 1.1 - Puente de eventos TransGest -> Contabilidad

Objetivo:

- Conectar datos de dominio de TransGest con Contabilidad mediante contratos versionados, sin generar todavia asientos ni efectos fiscales.

Alcance:

- Outbox transaccional propio en TransGest.
- Autenticacion servicio-a-servicio independiente del token de usuario.
- Publicacion inicial de `CompanyAccountingEnabled` y un evento operativo piloto aprobado.
- Ingesta validada e idempotente en Contabilidad.
- Correlacion mediante `event_id`, `trace_id`, `source_system`, `source_type` y `source_id`.
- Reintentos, cuarentena de eventos invalidos y observabilidad.

Criterios de aceptacion:

- TransGest guarda el cambio de negocio y su evento en la misma transaccion.
- Contabilidad rechaza contratos o versiones desconocidas.
- Reentregar el mismo evento no duplica efectos.
- Un evento de otra empresa no puede cruzar el contexto tenant.
- El fallo temporal del consumidor no bloquea la operacion principal de TransGest.
- No existe escritura directa de TransGest sobre tablas contables.
- Ningun evento de esta entrega crea facturas fiscales ni asientos.

Estado:

- Siguiente entrega tecnica pendiente de aprobacion.

## Entrega 2 - Plan contable PGC/PGC PYMES

Objetivo:

- Configurar un plan de cuentas por empresa con plantillas PGC y PGC PYMES.

Alcance:

- `accounting_standards`, `chart_templates`, `accounts`.
- Importacion de plantilla.
- Cuentas activas/inactivas, jerarquia y mapeos a informes.
- Validacion de codigos y unicidad por empresa.

Criterios de aceptacion:

- Una empresa puede elegir PGC o PGC PYMES al abrir ejercicio.
- Se importa plan base versionado.
- No se puede borrar una cuenta con movimientos.
- Se puede anadir subcuentas.
- La opcion PGC PYMES queda marcada como decision de la empresa, no como recomendacion legal automatica.

Estado parcial:

- Implementadas las tablas `accounting_standards`, `chart_templates`, `chart_template_accounts` y `chart_template_imports`.
- Implementadas plantillas de alcance empresa mediante instantanea inmutable de cuentas activas.
- Implementada vista previa con altas, coincidencias y conflictos.
- La importacion no sobrescribe cuentas existentes y solo puede aplicarse una vez por plantilla y ejercicio.
- Pendiente cargar cualquier plantilla PGC/PGC PYMES hasta disponer de fuente oficial, version efectiva y validacion externa.

## Entrega 3 - Motor de asientos y Libro Diario

Objetivo:

- Registrar asientos de partida doble con trazabilidad.

Alcance:

- `journal_entries`, `journal_lines`, `source_links`.
- Caso de uso `PostJournalEntry`.
- Validacion Debe = Haber.
- Idempotency key.
- Libro Diario filtrable.

Criterios de aceptacion:

- Un asiento descuadrado se rechaza.
- Un asiento en periodo cerrado se rechaza.
- Reintentar la misma idempotency key no duplica.
- Cada asiento tiene `source_type`, `source_id` y `source_event_id` cuando procede.
- No hay endpoints que permitan insertar lineas sin caso de uso.

Estado parcial:

- Implementadas las tablas `journal_entries`, `journal_lines` y `source_links`.
- Implementada creacion transaccional de borradores manuales mediante caso de uso explicito; no existe endpoint de escritura directa de lineas.
- Implementada edicion controlada de borradores mediante `PUT /api/v1/journal-entries/:id/draft`; no permite cambiar el ejercicio, editar contabilizados ni editar cancelados.
- Implementada contabilizacion transaccional con bloqueo de asiento, ejercicio y periodo, validacion exacta Debe = Haber y numeracion secuencial por ejercicio.
- Implementadas consulta filtrable y vista de detalle del Diario, incluyendo filtros por ejercicio, estado, concepto/numero y rango de fechas.
- Implementada exportacion CSV auditada del Diario con los mismos filtros del listado.
- Implementada idempotencia de creacion mediante `idempotency_key` y `request_hash`; reutilizar una clave con contenido distinto se rechaza.
- Implementado borrador reverso desde asientos contabilizados, con inversion Debe/Haber, motivo, idempotencia, auditoria, outbox y `source_links` al asiento original.
- Implementada exposicion read-only de `source_links` en el detalle del Diario y visualizacion del origen tecnico del asiento en la UI.
- Implementadas auditoria y outbox para creacion de borrador, edicion de borrador, cancelacion de borrador, reverso y contabilizacion.
- Pendientes source links procedentes de eventos externos e integraciones automaticas.
- El estado parcial es tecnico y no acredita cumplimiento contable o legal.

## Entrega 4 - Libro Mayor y balance de sumas y saldos

Objetivo:

- Consultar movimientos por cuenta y saldos acumulados.

Alcance:

- Mayor por cuenta.
- Balance de sumas y saldos.
- Export CSV/PDF inicial.
- Indices por empresa, ejercicio, cuenta y fecha.

Criterios de aceptacion:

- Mayor cuadra con Diario.
- Sumas Debe/Haber coinciden con asientos.
- Filtros por periodo no mezclan empresas.
- Exportacion conserva filtros y queda auditada.

Estado parcial:

- Implementado endpoint `GET /api/v1/ledger/accounts/:accountId` para movimientos contabilizados por cuenta, con saldo acumulado.
- Implementado endpoint `GET /api/v1/reports/trial-balance` para sumas Debe/Haber y saldos deudor/acreedor por cuenta.
- Implementados endpoints `GET /api/v1/reports/balance-sheet` y `GET /api/v1/reports/profit-loss` como informes preliminares calculados desde cuentas contabilizadas.
- Implementadas exportaciones CSV con `format=csv` para Mayor y sumas/saldos, manteniendo filtros y registrando auditoria append-only.
- Implementadas exportaciones CSV auditadas de Balance y PyG.
- Implementada pantalla "Mayor" con filtros por ejercicio, periodo, cuenta y rango de fechas.
- Implementada pantalla "Informes" con filtros por ejercicio, periodo y rango de fechas.
- Las consultas usan solo asientos `posted`; los borradores no afectan saldos.
- Pendientes epigrafes oficiales PGC/PGC PYMES, exportacion PDF, paginacion/colas para exportaciones grandes y optimizaciones/indices especificos si crece el volumen.
- El estado parcial es tecnico y no acredita cumplimiento contable o legal.

## Entrega 5 - Integracion facturas emitidas y servicio fiscal central

Objetivo:

- Centralizar emision fiscal y contabilizar facturas emitidas mediante eventos.

Alcance:

- `fiscal-billing-service` como unico emisor fiscal.
- Evento `FiscalInvoiceIssued`.
- Consumidor contable idempotente.
- Mapeo configurable cliente/IVA/cuentas.
- Asiento automatico de venta e IVA repercutido.

Criterios de aceptacion:

- TransGest no emite facturas fiscales por su cuenta fuera del servicio central.
- Una factura emitida genera un unico asiento.
- Rectificaciones generan asiento rectificativo/reverso segun caso de uso.
- El asiento enlaza factura, evento fiscal y documento.
- Cambiar adaptador fiscal no cambia el asiento ya registrado.

## Entrega 6 - Clientes, proveedores, facturas recibidas, IVA y vencimientos

Objetivo:

- Cubrir ciclo basico de cuentas por cobrar y pagar.

Alcance:

- `accounting_parties`, `supplier_invoices`, `receivables`, `payables`.
- IVA soportado y repercutido.
- Vencimientos.
- Importacion de facturas recibidas.

Criterios de aceptacion:

- Factura recibida aceptada crea asiento proveedor/gasto/IVA soportado.
- Vencimientos se generan y se pueden consultar.
- Cuentas por cobrar/pagar cuadran con saldos contables.
- Reglas de IVA quedan parametrizadas y documentadas como pendientes de validacion fiscal.

Estado parcial:

- Implementado maestro basico `accounting_parties` para clientes, proveedores y otros terceros.
- Implementados filtros, alta, edicion, activacion/desactivacion y CSV auditado desde la UI contable.
- Implementada cartera manual `accounting_maturities` para cobros y pagos previstos.
- Pendientes facturas emitidas/recibidas, IVA, remesas, bancos, cobros/pagos reales y contabilizacion automatica.
- El estado parcial no acredita cumplimiento contable, fiscal ni documental.

## Entrega 7 - Cobros, pagos y conciliacion bancaria

Objetivo:

- Registrar tesoreria y conciliar movimientos bancarios.

Alcance:

- `bank_accounts`, `bank_statements`, `bank_transactions`, `reconciliations`.
- Import SEPA/CSV inicial.
- Matching manual y sugerencias simples.
- Asientos de cobro/pago.

Criterios de aceptacion:

- Un cobro reduce cuenta por cobrar y mueve banco.
- Un pago reduce cuenta por pagar y mueve banco.
- Una transaccion bancaria conciliada no puede conciliarse dos veces.
- Conciliacion queda trazada con usuario, fecha y asiento.

## Entrega 8 - Informes financieros

Objetivo:

- Balance de situacion y cuenta de perdidas y ganancias.

Alcance:

- Mapeos de cuentas a epigrafes.
- Informes por ejercicio/periodo.
- Comparativas.
- Exportaciones para asesorias.

Criterios de aceptacion:

- Informes se generan desde ledger, no desde facturas directamente.
- Informes no incluyen periodos bloqueados de forma inconsistente.
- Exportaciones quedan auditadas.
- Plantillas PGC/PGC PYMES son versionadas.

## Entrega 9 - Inmovilizado y amortizaciones

Objetivo:

- Gestionar activos y asientos periodicos de amortizacion.

Alcance:

- `fixed_assets`, `depreciation_plans`, `depreciation_runs`.
- Altas, bajas, amortizacion periodica.
- Integracion con facturas recibidas.

Criterios de aceptacion:

- Plan de amortizacion genera asientos balanceados.
- No se duplica una amortizacion del mismo periodo.
- Baja de activo queda trazada.
- Parametros fiscales/contables requieren validacion externa.

Estado parcial:

- Implementada tabla `accounting_fixed_assets` con aislamiento por tenant, empresa y ejercicio.
- Implementados permisos `fixed_assets.read` y `fixed_assets.write`.
- Implementadas altas manuales de inmovilizado desde caso de uso/API contable, con transaccion, auditoria append-only y outbox.
- Implementadas consulta, filtros, exportacion CSV auditada, cambio de estado (`active`, `inactive`, `disposed`) con motivo y plan de amortizacion lineal calculado bajo demanda.
- Implementada tabla `depreciation_runs` para bloquear duplicados por activo/periodo e idempotencia.
- Implementada creacion de borrador de Diario de amortizacion con Debe en gasto y Haber en amortizacion acumulada, enlazado al activo mediante `source_links` y evento `AccountingFixedAssetDepreciationDraftCreated`.
- No se contabiliza automaticamente, no hay amortizacion masiva, no hay baja contable completa, no hay integracion automatica con facturas recibidas y no se declara cumplimiento contable/fiscal.

## Entrega 10 - Cierres, reaperturas y regularizacion

Objetivo:

- Cerrar periodos y ejercicios de forma controlada.

Alcance:

- Bloqueo/cierre/reapertura.
- Asientos de regularizacion.
- Asiento de cierre/apertura.
- Workflow de autorizacion.

Criterios de aceptacion:

- Periodo cerrado bloquea asientos ordinarios.
- Reapertura requiere permiso y motivo.
- Cierre genera auditoria append-only.
- Informes cerrados pueden reproducirse.

## Entrega 11 - VERI*FACTU adapter

Objetivo:

- Convertir la base fiscal existente en adaptador versionable.

Alcance:

- Paquete `regulatory-adapters/verifactu`.
- Version de esquema y adaptador en cada envio.
- Validaciones tecnicas segun BOE/AEAT.
- Cola, reintentos, webhook y estados.

Criterios de aceptacion:

- El servicio fiscal puede operar en modo pruebas.
- Cada envio conserva payload, respuesta, hash y version del adaptador.
- El sistema no declara cumplimiento legal hasta revision externa.
- Cambios de adaptador no requieren cambiar el nucleo contable.

## Entrega 12 - Factura electronica B2B

Objetivo:

- Preparar adaptador futuro para factura electronica entre empresarios/profesionales.

Alcance:

- Modelo de estados B2B.
- Interoperabilidad/plataformas segun normativa aplicable.
- Registro de entrega, aceptacion, rechazo y pago cuando proceda.

Criterios de aceptacion:

- Factura fiscal emitida puede generar mensaje B2B sin duplicar factura.
- Estado B2B no altera el asiento salvo caso de uso definido.
- Adaptador versionado y documentado.
- Pendiente validacion BOE/asesoria antes de produccion.

## Entrega 13 - SII opcional

Objetivo:

- Soportar SII solo para empresas obligadas o que lo requieran.

Alcance:

- Activacion por empresa.
- Libros registro emitidas/recibidas.
- Cola y estados.

Criterios de aceptacion:

- SII esta desactivado por defecto.
- Activar SII requiere configuracion y permiso.
- No se mezcla con VERI*FACTU sin decision funcional documentada.
- Pendiente validacion fiscal externa.

## Entrega 14 - Asesoria, importaciones y exportaciones avanzadas

Objetivo:

- Facilitar trabajo con asesorias y traspasos.

Alcance:

- Exportaciones Diario, Mayor, balances, IVA, facturas, documentos.
- Importacion de asientos desde CSV/Excel con validacion.
- API de solo lectura para asesor.

Criterios de aceptacion:

- Importaciones descuadradas se rechazan.
- Exportaciones incluyen empresa, ejercicio, periodo, hash y filtros.
- Accesos de asesor son por empresa y quedan auditados.

## Estrategia de pruebas transversal

- Unitarias: dominio contable puro, sin BD.
- Integracion: BD real, migraciones, transacciones, outbox, idempotencia.
- E2E: SSO, factura, evento, asiento, informe.
- Contratos: JSON Schema por evento y API interna.
- Seguridad: RBAC, cross-tenant, periodos cerrados, escritura directa.
- Regulatorio: pruebas con fixtures oficiales o validados por experto.
- Regresion: snapshots de informes y saldos.

## Plan de migracion y rollback

- Fasear con feature flags: `accounting_enabled`, `fiscal_billing_service_enabled`, `outbox_enabled`.
- Backfill inicial solo lectura: importar empresas/clientes/facturas ya emitidas como documentos fuente, sin crear asientos definitivos hasta validacion.
- Reconciliacion: comparar totales facturacion existente con asientos generados.
- Rollback por entrega:
  - Apagar frontend contable.
  - Desactivar consumidores.
  - Mantener outbox sin publicar.
  - Restaurar snapshot de BD contable si la entrega afecta datos contables.
  - No borrar datos fiscales/contables auditables sin procedimiento aprobado.
- Cambios irreversibles: documentar antes de migrar y exigir backup verificado.
