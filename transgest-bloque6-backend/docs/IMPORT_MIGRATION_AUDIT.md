# Auditoría y plan de migración de datos

Estado: auditoría terminada sobre `origin/main` (`6dca5de`), rama aislada `codex/import-migration-audit`. Las nueve fases se implementaron en esta rama; la evidencia de pruebas y limitaciones actuales está en [IMPORT_MIGRATION_VALIDATION.md](IMPORT_MIGRATION_VALIDATION.md). No se han consultado datos de producción.

## Estado actual y reutilización

| Área | Hallazgo verificado | Decisión |
| --- | --- | --- |
| Lectura | `Importacion.js` usa `FileReader.readAsText` y acepta CSV/TSV/TXT; no XLSX. | Sustituir la lectura por un parser canónico CSV/TSV/XLSX en el servidor. |
| Ejecución | La página invoca `apiFn(row)` secuencialmente por fila. No existen lotes ni filas persistidos en el TMS. | Crear `import_batches`, `import_rows` y procesamiento reanudable en backend. |
| Cabeceras | `matchHeaders` asigna mediante `includes` en ambos sentidos. | Aceptar solo claves y alias publicados, o mapeo manual por lote. |
| Históricos | La plantilla de viajes usa la creación ordinaria de `pedidos`; la de facturas pendientes crea borradores de facturación. | Aislar los históricos para evitar notificaciones, numeración y efectos fiscales. |
| Costes | Existen repostajes y gastos recurrentes de estructura; falta un modelo general de gastos operativos importados. | Añadir movimientos operativos con procedencia y sin inventar repostajes. |
| Documentos | `Documentos.js` guarda DataURL/Base64 en `file_url`; las tablas de documentos existentes admiten metadatos limitados. | Añadir proveedor de almacenamiento y metadatos, conservando enlaces anteriores. |
| Calidad | La preparación de maestros procede de `/informes/datos-maestros-readiness`, sujeta a KPIs avanzados. | Exponerla con permiso de empresa en Mi Empresa, sin abrir los informes restringidos. |
| Acceso | `importacion` está limitada por plan; `gastos_estructura` figura en navegación y en una lista de bloqueo, pero no en el catálogo de permisos del servidor. | Separar autorización de importación del plan premium y sincronizar el permiso específico. |

Se reutilizan autenticación con `empresa_id`, permisos modulares, productos de empresa, tablas maestras, servicios de pedidos y facturas solo como referencias de esquema, migraciones numeradas y pruebas de regresión existentes. La importación histórica no invocará las rutas operativas ni fiscales normales.

## Migraciones aditivas previstas

1. Lotes, filas, identidad lógica y eventos/auditoría de importación, con claves e índices por empresa.
2. Procedencia e índices de deduplicación donde el modelo existente la admita; registro central de identidades para evitar alterar de forma destructiva tablas antiguas.
3. `gastos_operativos` y movimientos históricos reales de estructura separados del presupuesto/recurrente.
4. Facturas históricas y líneas en tablas distintas de `facturas` actuales, con número y serie de origen.
5. Metadatos documentales (`storage_key`, nombre, MIME, tamaño, SHA-256, fecha) sin reescribir `file_url` anterior.
6. Campos de procedencia histórica de viajes, si la inserción aislada en `pedidos` resulta segura tras auditar las dependencias; de otro modo tabla histórica separada.

Todas las migraciones serán aditivas e idempotentes. No se alterarán facturas fiscales ni documentos históricos para hacer cuadrar indicadores.

## Riesgos y mitigación

- **Efectos secundarios de pedidos y facturas:** no usar los endpoints ordinarios al importar históricos; pruebas de ausencia de emails, webhooks, DeCA y numeración.
- **Reintentos y duplicados:** clave `(empresa_id, entity_type, source_system, source_id)` o fingerprint estable, con revisión de conflictos y transacciones por bloque.
- **Aislamiento de empresas:** filtrar y autorizar lotes, filas, archivos y destinos siempre en servidor; pruebas con dos empresas.
- **Formato/seguridad:** tamaños máximos, MIME real, ZIP bomb, fechas Excel, decimales españoles, fórmulas sin evaluar y exportaciones protegidas.
- **Planes existentes:** probar códigos de plan reales y desconocidos; estos últimos no deben heredar Enterprise.
- **Permisos personalizados antiguos:** conservar denegaciones explícitas; para el módulo nuevo aplicar el preset del rol cuando no hay regla explícita.
- **Reversión:** solo registros creados por el lote y no usados/modificados después, con simulación previa.

## Orden de entregas

1. Auditoría, contrato y permisos.
2. Lotes, filas y API backend.
3. Formatos y validación canónica.
4. Datos maestros y metadatos documentales.
5. Gastos, repostajes y estructura.
6. Histórico de facturas y líneas.
7. Asistente de importación y traslado de calidad de datos.
8. Carga documental masiva.
9. Reintentos, reversión, informes y pruebas de extremo a extremo.

Antes de cada fase se ejecutan las regresiones existentes pertinentes. Al cerrar cada fase se anotan archivos, migraciones, pruebas y riesgos. No se publicarán datos reales ni se adaptará el contrato a un Excel particular.
