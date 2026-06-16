# TransGest Contabilidad - Matriz inicial de cumplimiento

Fecha: 2026-06-04

Aviso: esta matriz no certifica cumplimiento legal. Es una matriz tecnica de diseno, pruebas y documentacion pendiente. Toda conclusion normativa debe confirmarse con BOE, AEAT, asesoria fiscal, revision juridica y, cuando aplique, certificacion o pruebas de homologacion.

## Fuentes oficiales base

- PGC: https://www.boe.es/eli/es/rd/2007/11/16/1514
- PGC PYMES: https://www.boe.es/eli/es/rd/2007/11/16/1515
- Codigo de Comercio: https://www.boe.es/buscar/act.php?id=BOE-A-1885-6627
- Ley IVA: https://www.boe.es/eli/es/l/1992/12/28/37/con
- Reglamento de facturacion RD 1619/2012: https://www.boe.es/eli/es/rd/2012/11/30/1619
- SIF/VERI*FACTU RD 1007/2023: https://www.boe.es/eli/es/rd/2023/12/05/1007
- Orden HAC/1177/2024: https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138
- FAQ AEAT VERI*FACTU: https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes.html
- Ley 18/2022: https://www.boe.es/buscar/act.php?id=BOE-A-2022-15818
- RD 238/2026 factura electronica B2B: https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295
- SII RD 596/2016: https://www.boe.es/eli/es/rd/2016/12/02/596
- RGPD: https://eur-lex.europa.eu/legal-content/ES/ALL/?uri=CELEX:32016R0679
- LOPDGDD: https://www.boe.es/eli/es/lo/2018/12/05/3/con
- ENS: https://www.boe.es/eli/es/rd/2022/05/03/311

## Matriz

| Ambito | Requisito | Norma o fuente oficial | Modulo responsable | Datos afectados | Controles tecnicos | Pruebas necesarias | Documentacion necesaria | Validacion externa pendiente | Estado |
|---|---|---|---|---|---|---|---|---|---|
| Contabilidad financiera | Contabilidad ordenada, trazable y con libros reproducibles | Codigo de Comercio; PGC RD 1514/2007 | Accounting API | Asientos, lineas, cuentas, ejercicios | Diario manual v1 con borradores editables antes de contabilizar, partida doble al contabilizar, periodos, auditoria y base de source links | Unitarias motor; integracion Diario/Mayor; validacion externa | Manual contable, ADR de asientos | Asesoria contable | Parcial tecnico; no acredita cumplimiento |
| Contabilidad financiera | Soporte PGC y PGC PYMES | RD 1514/2007; RD 1515/2007 | Accounting API | Planes, cuentas, mapeos informe | Plantillas versionadas, decision por empresa | Importacion y snapshots de balances | Version de plantillas y criterio de uso | Asesoria contable | No implementado |
| Contabilidad financiera | Libro Diario y Mayor | Codigo de Comercio; PGC | Accounting API | Journal entries/lines, periodos, exportaciones CSV | Diario manual v1; edicion, cancelacion y reverso de borradores/asientos controlados; Mayor por cuenta desde asientos contabilizados; filtro por periodo; CSV auditado; sin borrado API | Diario=Mayor; saldos por cuenta/periodo; ediciones/cancelaciones; reversos; exportaciones PDF/asesoria | Politica de correccion y exportacion | Asesoria contable | Parcial tecnico; no acredita cumplimiento |
| Contabilidad financiera | Balance de sumas y saldos, Balance y PyG | PGC/PGC PYMES | Accounting API | Saldos, periodos, epigrafes, mapeos, exportaciones CSV | Sumas y saldos desde ledger; Balance/PyG preliminares por tipo de cuenta; filtros por periodo/fecha; CSV auditado | Snapshot, comparativas, epigrafes oficiales, exportaciones y validacion externa | Catalogo de epigrafes y criterio de clasificacion | Asesoria contable | Parcial tecnico; Balance/PyG no son informes legales cerrados |
| Contabilidad financiera | Cierre y bloqueo de periodos | Buenas practicas contables; PGC | Accounting API | Periodos, asientos | Estados open/locked/closed; permisos; contabilizacion rechazada fuera de periodo abierto | Intentos de asiento en bloqueado/cerrado | Procedimiento cierre/reapertura | Asesoria contable | Parcial tecnico; pendiente workflow y validacion externa |
| Contabilidad financiera | Conservacion documental contable | Codigo de Comercio art. conservacion; RD 1619/2012 para facturas | Accounting + Fiscal Billing + Documents | Facturas, justificantes, asientos, exportaciones | Retencion, hashes, trazabilidad documento-asiento | Recuperacion, export, integridad | Politica de conservacion | Revision juridica | No implementado |
| Sistemas informaticos de facturacion | Integridad, conservacion, accesibilidad, legibilidad, trazabilidad e inalterabilidad de registros de facturacion | RD 1007/2023; Orden HAC/1177/2024 | Fiscal Billing Service | Facturas fiscales, registros, eventos | Servicio unico, huellas, eventos append-only, payload versionado | Fixtures SIF, auditoria anti-manipulacion | Declaracion responsable borrador, manual SIF | BOE/AEAT/asesoria/certificacion si aplica | Parcial en TransGest |
| Sistemas informaticos de facturacion | Ningun modulo emite factura fiscal fuera del servicio central | RD 1619/2012; RD 1007/2023 como marco | Fiscal Billing Service | Facturas, series, numeracion | API unica `IssueFiscalInvoice`, permisos SQL restringidos | Test bloqueo emision externa | Politica de emision fiscal | Revision juridica/fiscal | Parcial, requiere extraccion |
| Sistemas informaticos de facturacion | Numeracion y series correlativas | RD 1619/2012 | Fiscal Billing Service | Facturas, series | Bloqueos transaccionales, unicidad por empresa/serie/ejercicio | Concurrencia alta | Manual de series | Asesoria fiscal | Parcial en facturas actuales |
| Sistemas informaticos de facturacion | Facturas rectificativas | RD 1619/2012; Ley IVA | Fiscal Billing Service + Accounting | Facturas, rectificaciones, asientos | Caso de uso rectificar, enlace a original | Flujos de rectificacion | Politica de rectificativas | Asesoria fiscal | Parcial |
| VERI*FACTU | Registros de alta/anulacion y remision si se opta por modo VERI*FACTU | RD 1007/2023; Orden HAC/1177/2024; FAQ AEAT | Adapter VERI*FACTU | Registros fiscales, huellas, QR, envios | Adaptador versionado, cola, retries, estado | Validacion esquema, pruebas AEAT/proveedor | Manual adaptador, version normativa | AEAT/proveedor/revision fiscal | Parcial, no certificado |
| VERI*FACTU | Plazos de obligacion y modalidad aplicable | RD 1007/2023 modificado; FAQ AEAT | Fiscal Billing + Product | Config empresa, fechas, modo | Feature flags y calendario configurable | Tests por tipo obligado | Nota legal por cliente | Confirmacion BOE/AEAT actualizada | Pendiente |
| VERI*FACTU | Declaracion responsable del productor | Orden HAC/1177/2024 | Product/Legal + Fiscal Billing | Version software, productor, SIF | Versionado build, hash release, changelog | Revision de release | Declaracion responsable | Revision juridica externa | No implementado |
| Factura electronica B2B | Expedicion, transmision e interoperabilidad entre empresarios/profesionales | Ley 18/2022; RD 238/2026 | Adapter eInvoice B2B | Facturas, estados B2B, plataforma | Adaptador versionado, estados entrega/aceptacion/rechazo | Contratos con plataforma | Manual B2B | BOE/asesoria/proveedor | No implementado |
| Factura electronica B2B | Conservacion y acceso a factura electronica | RD 1619/2012; RD 238/2026 | Fiscal Billing + Documents | XML/PDF/metadata | Almacenamiento, hash, acceso, export | Recuperacion y firma/validacion | Politica documental | Revision juridica | No implementado |
| SII opcional | Suministro inmediato de libros registro IVA cuando proceda | RD 596/2016; normativa AEAT SII | Adapter SII | Facturas emitidas/recibidas, libros IVA | Activacion por empresa, colas, estados | Fixtures SII y entorno pruebas | Manual activacion SII | Asesoria fiscal/AEAT | No implementado |
| IVA | IVA repercutido y soportado | Ley 37/1992; RD 1619/2012 | Accounting + Fiscal Billing | Facturas, cuentas IVA, liquidaciones | Parametros regimen/tipo, mapeos cuentas | Casos tipo IVA, exento, cero | Criterios de IVA | Asesoria fiscal | Parcial operativo |
| Proteccion de datos | Licitud, minimizacion, seguridad y derechos | RGPD; LOPDGDD | Todos | Usuarios, clientes, proveedores, facturas, documentos | RBAC, minimizacion, logs redacted, retencion | Tests permisos y export/delete legal | Registro actividades, DPA, privacidad | DPO/revision juridica | Parcial |
| Seguridad | Control de acceso, minimo privilegio, trazabilidad | ENS como referencia; buenas practicas SaaS | Todos | Credenciales, sesiones, datos contables | SSO corto, roles SQL separados para API y worker contables, sin DDL ni acceso operativo; pendiente limitar rol SQL de TransGest | Pentest, SAST, tests RBAC y privilegios SQL | Politica seguridad | Revision seguridad externa | Parcial tecnico; no implica conformidad ENS |
| Seguridad | Segregacion de funciones | ENS como referencia; buenas practicas contables | Accounting API | Permisos, cierres, reaperturas | Roles `accountant`, `approver`, `auditor`, `admin` | Tests accion/rol | Matriz RBAC | Asesoria/auditoria | No implementado |
| Conservacion documental | Conservacion de facturas y justificantes | RD 1619/2012; Codigo de Comercio | Documents + Fiscal Billing + Accounting | Facturas, documentos adjuntos, asientos | Retencion, hash, descarga, no borrado silencioso | Restore/export | Politica conservacion | Revision juridica | Parcial |
| Auditoria | Registro append-only | RD 1007/2023 para registros/eventos facturacion; buenas practicas contables | Accounting + Fiscal Billing | Audit logs, eventos | `accounting.audit_log` protegido contra UPDATE/DELETE/TRUNCATE; API limitada a SELECT/INSERT y worker sin acceso; pendiente alcance fiscal | Intentos update/delete/truncate; revision privilegios | Politica auditoria | Revision externa | Parcial tecnico; no implica cumplimiento legal |
| Integracion | Eventos internos validados e idempotentes | Arquitectura interna | TransGest + Accounting + Fiscal | Outbox, offsets, idempotency | Outbox y consumidor idempotente contables; hash de peticion para borradores; puente TransGest pendiente | Reintentos, duplicados y misma clave con contenido distinto | Contratos eventos | Revision arquitectura | Parcial tecnico |
