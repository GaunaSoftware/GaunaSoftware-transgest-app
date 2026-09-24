# Validación de Importación canónica

Rama aislada: `codex/import-migration-audit`, base `origin/main` `6dca5de`. Datos de prueba **sintéticos** en PGlite; no se consultó producción, no se subió ni desplegó esta rama. El checkout principal y sus cambios ajenos permanecen intactos.

## Evidencia por fase

| Fase | Archivos / migraciones principales | Validación | Riesgo restante |
| --- | --- | --- | --- |
| 1. Auditoría y permisos | `IMPORT_MIGRATION_AUDIT.md`, `IMPORT_CANONICAL_FORMAT.md`, `auth.js`, catálogos de plan/rol | `import:access:regression` | Verificar configuraciones personalizadas en una implantación real. |
| 2. Lotes | `importBatches.js`, `routes/importacion.js`, `20260924_import_batches.sql` | `import:batches:regression`, `import:http:regression` | El límite de 20 MB exige dividir paquetes grandes. |
| 3. Formato | `importParser.js`, `importCatalog.js`, plantillas CSV/XLSX | `import:parser:regression` con 10.001 filas, fechas Excel, decimales y fórmulas rechazadas | Los libros con macros y cabeceras ajenas al contrato se rechazan deliberadamente. |
| 4. Maestros y metadatos | `importMasterData.js`, migraciones de campos/índices | `import:master:schema`, `import:master:data`, `import:engine:regression` | Las coincidencias ambiguas requieren revisión humana. |
| 5. Costes | `importCosts.js`, `20260924_import_costs.sql` | `import:costs:regression` | Costes agregados no se atribuyen a viajes sin evidencia. |
| 6. Facturación histórica | `importHistory.js`, `20260924_import_history.sql` | `import:history:regression`, `import:engine:regression` | Total fiscal de origen, base y cobros pueden diferir; no se mezclan con facturas nuevas. |
| 7. Interfaz | `ImportacionWizard.js`, CSS, `api.js`, calidad de datos en Mi Empresa | `npm run build`, ESLint acotado, 79 tests frontend | Falta una prueba visual en navegador autenticado a cuatro tamaños antes de desplegar. |
| 8. PDFs | `importDocuments.js`, `DocumentStorageProvider.js`, `20260924_import_document_blobs.sql` | `import:documents:regression` | El proveedor actual almacena PDFs en tabla privada; vigilar tamaño de BD. |
| 9. Viajes, reintentos, rollback e informes | `importTrips.js`, `importRollback.js`, `importReports.js`, `importHistoricalOverview.js`, migraciones `20260924_import_trips.sql` y `20260924_import_rollback.sql` | `import:trips:regression`, `import:engine:regression`, `import:documents:regression`, `import:http:regression` | El rollback se bloquea ante dependencias, cambios o huellas ausentes; requiere revisión manual en esos casos. |

`npm run check` del backend terminó con código 0, incluyendo auditoría estricta de empresa y regresiones de portal, geocodificación, IA, operativa, BI, producción, Planner y chófer. `CI=true npm test -- --watch=false --runInBand`: 28 suites y 79 pruebas aprobadas. `npm run build` del frontend terminó con código 0; sus avisos ESLint se sitúan en Agenda, Gestión de Tráfico, Mi Cuenta, Pedidos, Taller, Vehículos y `src/ui/index.js`, sin aviso nuevo de Importación. `npx eslint src/pages/ImportacionWizard.js src/pages/Documentos.js src/components/DataQuality.js` terminó con código 0.

La simulación y las pruebas HTTP verifican aislamiento A/B, importación repetida, cancelación, continuación, reintento tras error transitorio, reversión de conductor y documento, reversión de tarifa y ruta auxiliar, restauración de PDF unido a metadatos, protección frente a edición posterior y exportación de informe. Las pruebas de documento validan ZIP con ruta peligrosa, PDF privado y lectura solo dentro de la empresa.

## Compatibilidad y puesta en marcha futura

Ejecutar `npm run migrate` **en una copia de prueba de la base** antes de instalar esta rama. Son migraciones aditivas, pero las restricciones e índices de identidad pueden requerir resolver duplicados preexistentes. El startup reanuda trabajadores que estaban `running` y limpia PDFs no confirmados tras 30 días. Los documentos anteriores en `file_url` siguen siendo legibles. No hay migración destructiva ni modificación de facturas fiscales históricas.

Antes de producción faltan una prueba integral con una copia anonimizada de un cliente, revisión visual autenticada de la interfaz, medición de importación de 10.000 filas **confirmadas** contra PostgreSQL real y conciliación de una muestra con el software de origen. El parser sí ha superado 10.001 filas sintéticas. Las facturas y viajes históricos tienen una vista de importes de origen; todavía no alimentan KPI netos, cartera con cobros posteriores ni facturación fiscal actual, porque el contrato no garantiza base imponible, IVA aplicado ni aplicaciones bancarias. No se presenta como dato conciliado lo que no lo está.
