# Integraciones externas de contabilidad

Fecha de investigacion: 2026-06-17.

Este documento no declara compatibilidad productiva, certificacion legal ni homologacion con ningun proveedor. Es una matriz tecnica inicial para empresas que quieran usar TransGest Contabilidad sin abandonar su programa contable actual.

## Criterio

No existe una fuente publica unica y auditada que ordene con precision los 10 programas de contabilidad mas usados por cuota real en pymes espanolas. Por eso se define un catalogo prioritario basado en presencia en el mercado espanol, encaje contable/facturacion, uso habitual en pymes o asesorias y disponibilidad visible de API, importacion o exportacion.

## Principios de integracion

- La gobernanza de integraciones externas pertenece a Superadmin. Desde ahi se consulta el catalogo, se priorizan conectores y se abre el modulo contable en pestana independiente.
- TransGest Contabilidad conserva la operacion diaria: exportaciones, paquetes de asesoria, staging de importaciones y futuras sincronizaciones bajo permisos contables.
- Superadmin mantiene una ficha por empresa con programa contable externo, estado, modo permitido, responsable, asesoria/partner, estado de mapeo y notas operativas.
- La ficha por empresa registra tambien los modulos mapeados: plan contable, terceros, impuestos, diario, bancos y documentos. Este avance es orientativo y no activa sincronizaciones automaticas.
- Superadmin permite filtrar empresas por programa, estado y busqueda libre, y muestra los ultimos cambios auditados de fichas contables.
- Superadmin permite exportar el seguimiento de integraciones contables a CSV desde `/api/v1/superadmin/integraciones/contabilidad/export.csv`, incluyendo el contador de modulos mapeados.
- TransGest no debe escribir asientos directamente en bases externas ni permitir que sistemas externos escriban directamente en las tablas contables de TransGest.
- Toda salida contable debe generarse desde casos de uso explicitos, con trazabilidad, idempotencia y auditoria.
- Toda entrada desde terceros debe pasar por una zona de staging, validacion, deduplicacion y aprobacion manual antes de cualquier importacion real.
- El staging inicial de entradas externas esta implementado en `/api/v1/external-import-batches`: crea lotes, guarda filas crudas/normalizadas, calcula hashes, bloquea duplicados por lote y registra auditoria/outbox. No aplica datos contables.
- Para programas con API, usar outbox transaccional, workers idempotentes, reintentos controlados y mapeo versionado por proveedor.
- Para programas on-premise o cerrados, priorizar paquetes CSV/XLSX/PDF auditables y confirmados por asesoria.
- Facturacion fiscal, VERI*FACTU, factura electronica B2B y SII siguen siendo ambitos separados. No se debe delegar emision fiscal en un conector externo sin decision expresa de arquitectura y revision legal.

## Catalogo prioritario

| Prioridad | Programa | Enfoque inicial | Motivo tecnico | Estado |
| --- | --- | --- | --- | --- |
| 1 | Sage 50 / ContaPlus | Exportacion CSV/XLSX y paquete asesoria | Base historica en pymes; posible variacion por version e instalacion | Research |
| 2 | Sage 200 | Partner/API o ficheros controlados | ERP modular; Sage indica importacion de datos, banca e integracion con Microsoft 365 | Research |
| 3 | Wolters Kluwer a3innuva / a3ASESOR | Paquete asesoria | Fuerte presencia en despachos; marketplace e integraciones | Research |
| 4 | Holded | API con outbox | Documentacion publica con contabilidad, diario, cuentas, ventas, compras y tesoreria | Planned |
| 5 | CONTASOL / FACTUSOL | Import/export Excel/Calc | Producto muy conocido; documenta importaciones y exportaciones PDF/XLSX | Planned |
| 6 | Odoo | API XML-RPC/JSON-RPC + CSV | API externa documentada y modelos contables; requiere plan compatible | Planned |
| 7 | Anfix | Export first + revision API | SaaS contable/facturacion con bancos e impuestos; API publica pendiente de confirmar | Research |
| 8 | Quipu | Export first + revision API | SaaS de facturacion y tesoreria; API pendiente de confirmar | Research |
| 9 | Billin / TS Facturas Billin | Export documental | Mas orientado a facturacion; cuidar frontera fiscal para evitar doble emision | Research |
| 10 | FacturaScripts | Plugin/API o CSV | Open source y extensible; buen candidato para plugin por instalacion | Planned |

## Fases propuestas

1. Catalogo visible en Superadmin. Implementado como `/api/v1/superadmin/integraciones/contabilidad`.
2. Catalogo operativo visible en TransGest Contabilidad. Implementado como `/api/v1/external-integrations`.
3. Manifiesto de paquete asesoria. Implementado como `/api/v1/external-integrations/advisor-package`.
4. ZIP para asesoria con manifiesto, indice de exportaciones, rutas CSV autorizadas y CSV fisicos para terceros, vencimientos, movimientos bancarios, diario e informes contables basicos. Implementado como `/api/v1/external-integrations/advisor-package.zip`.
5. Persistencia y seguimiento por empresa del conector preferido, estado contractual, responsable, modo autorizado e historial auditado desde Superadmin. Implementado como `/api/v1/superadmin/integraciones/contabilidad/empresas/:empresaId`.
6. Mapeos por empresa para plan contable, terceros, impuestos, diario, bancos y documentos. Implementado como metadatos versionables en la ficha de Superadmin.
7. Exportaciones normalizadas: terceros, vencimientos, bancos, diario, sumas y saldos, balance y PyG.
8. Ampliar el paquete asesoria ZIP con XLSX/PDF fisicos, adjuntos documentales y formatos especificos por proveedor.
9. Staging de importacion: lotes externos, filas, estados, hashes, auditoria y aprobacion manual. Implementado como base generica para CSV.
10. Conector Holded u Odoo como primer piloto API, siempre con outbox y aprobacion manual.
11. Conectores de ficheros para Sage 50/ContaPlus, Sage 200, a3 y CONTASOL.
12. Monitor de sincronizacion: estado, ultimo lote, errores, reintentos e idempotency keys.

## Paquete asesoria actual

El manifiesto actual devuelve los CSV disponibles para el usuario autenticado y marca como bloqueados los que requieren permisos o ejercicio seleccionado. El ZIP actual incluye `manifest.json`, `exports/index.csv`, ficheros de texto con las rutas CSV autorizadas y CSV fisicos para las exportaciones soportadas en esta fase.

Incluye:

- Terceros: incluido fisicamente como `exports/terceros.csv`.
- Vencimientos: incluido fisicamente como `exports/vencimientos.csv`.
- Movimientos bancarios: incluido fisicamente como `exports/movimientos_bancarios.csv`.
- Libro diario: incluido fisicamente como `exports/diario.csv`.
- Balance de sumas y saldos: incluido fisicamente como `exports/sumas_y_saldos.csv` cuando `fiscal_year_id` es UUID valido.
- Balance de situacion: incluido fisicamente como `exports/balance_situacion.csv` cuando `fiscal_year_id` es UUID valido.
- Cuenta de perdidas y ganancias: incluido fisicamente como `exports/perdidas_ganancias.csv` cuando `fiscal_year_id` es UUID valido.

Los informes contables requieren `fiscal_year_id` valido. Las descargas usan permisos contables y el ZIP registra auditoria con filtros y conteo de filas embebidas. Esta funcionalidad no declara compatibilidad productiva con ningun proveedor externo; los formatos exactos de importacion siguen pendientes de validacion por programa, version instalada y asesoria.

## Staging de importaciones externas

El staging de entrada permite preparar CSV externos sin escribir en tablas contables operativas. Cada lote queda en `external_import_batches` con proveedor, tipo, formato, hash, estado y conteos. Cada fila queda en `external_import_rows` con `raw_payload`, `normalized_payload`, errores, avisos y hash de fila.

Estados iniciales:

- `pending_review`: lote preparado y pendiente de revision.
- `approved`: lote aceptado para una fase posterior de importacion controlada.
- `rejected`: lote descartado por revision.
- `cancelled`: lote cancelado operativamente.

Restricciones actuales:

- No crea terceros, bancos, vencimientos, cuentas ni asientos.
- No valida todavia formatos concretos de Sage, a3, CONTASOL, Holded u Odoo.
- No declara homologacion ni compatibilidad productiva con proveedores externos.
- La aprobacion solo autoriza el siguiente paso tecnico; la aplicacion real de datos requerira casos de uso especificos por tipo de importacion.

## Fuentes revisadas

- Holded desarrolladores: https://www.holded.com/es/desarrolladores
- Sage 200 Espana: https://www.sage.com/es-es/productos/sage-200/
- Sage 50 Espana: https://www.sage.com/es-es/productos/sage-50/
- Wolters Kluwer a3innuva: https://www.wolterskluwer.com/es-es/solutions/a3innuva
- TeamSystem CONTASOL: https://www.sdelsol.com/programa-contabilidad-contasol/
- Odoo External API: https://www.odoo.com/documentation/18.0/developer/reference/external_api.html
- Anfix: https://www.anfix.com/
- Quipu: https://getquipu.com/
- Billin: https://www.billin.net/
- FacturaScripts: https://facturascripts.com/

## Pendiente de validar

- Formatos exactos de importacion de Sage 50/ContaPlus, Sage 200, a3 y CONTASOL por version instalada.
- Condiciones comerciales y tecnicas de APIs privadas o partner.
- Si el cliente quiere que TransGest sea sistema maestro o solo exportador hacia asesoria.
- Tratamiento fiscal cuando otro sistema ya emite facturas, especialmente para evitar duplicidades.
- Responsable de soporte ante errores de sincronizacion con programas externos.
