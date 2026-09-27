# Fase 9 — Importador 2.0

26/09/2026. Evolución sobre el importador por lotes existente; datos sintéticos locales exclusivamente. No se adapta a una empresa concreta ni se modifica producción.

## Contraste del alcance

| Requisito | Implementación reutilizada y evidencia |
| --- | --- |
| 15 formatos canónicos | `importCatalog.js`: Clientes, Conductores, Vehiculos, Colaboradores, Tarifas, Docs_Conductores, Docs_Vehiculos, Viajes_Historicos, Viajes_Pendientes, Facturas_Historicas, Facturas_Lineas, Facturas_Pendientes, Gastos_Operativos, Repostajes, Gastos_Estructura. Plantillas CSV y pack XLSX descargables por API. |
| Separar calidad e importación | Importación tiene vista propia `ImportacionWizard`; Calidad de datos permanece en Mi empresa. No se duplica su formulario. |
| UX y validación | Datos maestros / Operativa / Finanzas / Documentación / Migración completa. Archivo, validación/revisión, simulación/confirmación, importación y resultado. CSV/TSV/XLSX; mapeo explícito, rechazo de fórmulas, formato y procedencia conservados. |
| Proceso de servidor | `import_batches`, `import_rows`, `import_events`, `import_identities`; bloques de preparación de 500, procesamiento transaccional por fila, recuperación al arrancar. El navegador no dirige la ejecución. |
| Identidad y reintentos | Empresa + entidad + sistema de origen + source_id o fingerprint. Identidades sin source_id requieren revisión según el formato. No se sobrescribe una ficha existente. Reintento de errores procesables y continuación de lotes detenidos. |
| Dry-run y reversión | Simulación sin escrituras en tablas operativas; confirmación posterior. Reversión solo de destinos intactos con snapshot y sin referencias posteriores, en orden inverso. Cambios posteriores bloquean la reversión. |
| Documentos | PDFs múltiples o ZIP, asociación por DNI/matrícula, tipos reconocidos y ambigüedad explícita. Originales privados en `DocumentStorageProvider`; hash, MIME/tamaño, aislamiento y reversión comprobados. |
| Histórico sin efectos operativos | Viajes/facturas/líneas/saldos históricos en tablas de importación. Conservan número y total originales: no inventan desglose de IVA ni se suman a KPI actuales sin conciliación. No llaman a emisión, correo, push, WhatsApp, DeCA, webhooks o fiscalidad. Viajes pendientes se crean expresamente en la operativa por inserción controlada y trazada. |
| Informes | Errores CSV/XLSX e informe XLSX por lote, autorización de descarga y protección de textos interpretables como fórmula. Detalle paginado por separado. |

## Defectos reproducidos y corregidos

1. Un `source_id` anteriormente importado con otro contenido se clasificaba como existente sin avisar. La regresión falló con `0 !== 1` en filas a revisar (`phase9-reproduction.log`). El motor ahora compara el fingerprint antes de evaluar cualquier entidad, tanto en simulación como al escribir: contenido distinto o huella anterior no verificable queda a revisión y no altera el destino.
2. Respuestas de detalle/filas/informe de un lote anterior podían reemplazar el lote elegido después. Se añadió generación de vista y descarte de peticiones obsoletas, limpieza del detalle al cambiar y polling sin peticiones solapadas. Regresión React resuelve las respuestas en orden inverso y conserva exclusivamente el lote actual.
3. Los pasos no nombraban la simulación/confirmación y los estados por fila se mostraban en inglés. Se han aclarado las etiquetas sin cambiar la navegación ni los permisos.

## Pruebas y medidas reales

- `npm run import:regression`: salida 0. Ejecuta los once scripts existentes de acceso, batches, parser, HTTP, schema/maestros, motor, costes, históricos, documentos y viajes. Incluye Go/Pro/Intelligence, denegación por permisos/empresa, pack real, OOXML con namespace, fechas Excel, decimales españoles, revisión documental permanente, rollback y reintento.
- `npm run import:engine:regression`: salió 1 antes de corregir el conflicto de identidad; salida 0 después. Conserva el cliente original.
- `node scripts/import_scale_check.cjs` (nuevo alias `npm run import:scale`): salida 0 con 10.001 clientes sintéticos completos. 738 ms de preparación, 24.003 ms de simulación y 89.015 ms de proceso recuperado de un estado `running` persistido, sin navegador. 130.340 consultas instrumentadas, 50 filas de detalle y 10.001 destinos/identidades; empresa B con cero registros. Segunda ejecución sin duplicados. Son medidas PGlite locales, no SLA ni benchmark de Render. Hay coste por fila; no se introducen índices sin un plan PostgreSQL medido.
- `npm run check`: salida 0 tras el cambio de motor; suites operativas, BI, Planner y chófer conservadas.
- Frontend `CI=true npm test -- --watchAll=false --runInBand`: 51 suites / 125 pruebas correctas, incluida la nueva regresión de cambio de lote.
- Frontend `CI=false REACT_APP_LOCAL_SERVER=true npm run build`: compilación local, salida 0 con avisos previos de ESLint.
- Navegador local: catálogo con los 15 formatos, lote guardado, simulación, confirmación y resultado completado con una fila omitida por existencia previa (sin duplicar cliente). 390 px sin desbordamiento de la página; tablas con desplazamiento interno y acciones visibles. Las pruebas automatizadas específicas del motor incluyen el nuevo control de huellas; el proceso de navegador utilizó la API local ya abierta para la prueba anterior.

## Migraciones, compatibilidad y límites

Esta fase no añade tablas ni cambia históricos. Requiere las migraciones aditivas existentes `20260924_import_*.sql` (lotes, maestros, documentos, simulaciones, aislamiento, costes, históricos, viajes y reversión); comprobarlas con el runner habitual en una copia aislada. API de lotes y contratos CSV/XLSX v1 conservados. Para revertir el código, conservar las tablas, identidades y originales; la reversión de datos siempre usa el control de referencias/snapshots, nunca un borrado masivo.

Límites reales: archivo 20 MB y 100.000 filas; Excel 70 columnas, límites ZIP y fórmulas rechazadas. Documentación: 256 archivos por paquete, 5 MB por PDF y 20 MB de carga; lotes separados para volúmenes mayores. No se ha reimportado ningún Excel real de clientes en esta fase. Tampoco se ha medido concurrencia multinodo, latencia Render ni un apagado físico durante una fila: la recuperación probada parte de un estado persistido y las transacciones/rollback se prueban localmente. Un origen modificado requiere conciliación humana; no se inventa un ID nuevo ni se actualizan documentos fiscales.
