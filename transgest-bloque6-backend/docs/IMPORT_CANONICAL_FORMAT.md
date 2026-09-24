# Contrato canónico de importación TransGest (v1)

Este formato es de TransGest y no depende de la exportación de ningún cliente. Se admiten CSV UTF-8, TSV y XLSX sin macros. Un XLSX individual debe contener su hoja oficial; el libro completo usa **exactamente** los nombres de hoja de la primera columna de la tabla. Cada hoja lleva la cabecera en su primera fila y una entidad por fila, salvo `Facturas_Lineas`, donde varias líneas pueden referirse a la misma factura. Todas las plantillas incluyen `source_id`, estable en el sistema de origen; `source_system` identifica el origen en el lote. Si falta `source_id`, la aplicación propone un fingerprint y requiere revisión antes de confirmar.

Las plantillas se descargan desde `GET /api/v1/importacion/templates/<NombreHoja>.csv` o como libro en `GET /api/v1/importacion/templates/pack.xlsx`. El catálogo autorizado está en `GET /api/v1/importacion/catalog`. El archivo se sube binario a `POST /api/v1/importacion/upload` con `X-Import-Filename` (nombre codificado como URI), `X-Import-Type` (nombre de hoja o `Pack_TransGest`) y `X-Import-Source-System`. La subida solo **prepara un lote de revisión**; no inserta registros de negocio.

| Hoja / plantilla | Cabeceras oficiales v1 |
| --- | --- |
| `Clientes` | `source_id,nombre,cif,telefono,email,direccion,poblacion,provincia,codigo_postal,pais,notas` |
| `Conductores` | `source_id,nombre,apellidos,dni,telefono,movil_empresa,fecha_nacimiento,fecha_alta,estado,categoria_carnet,notas` |
| `Vehiculos` | `source_id,matricula,tipo,marca,modelo,estado,notas` |
| `Colaboradores` | `source_id,nombre,cif,telefono,email,direccion,poblacion,provincia,codigo_postal,notas` |
| `Tarifas` | `source_id,cliente_cif,nombre,origen,destino,km,precio,unidad,fecha_desde,fecha_hasta,notas` |
| `Docs_Conductores` | `source_id,chofer_dni,chofer_nombre,tipo_doc,fecha_emision,fecha_vencimiento,estado_vencimiento,numero_doc,organismo,archivo_nombre,notas` |
| `Docs_Vehiculos` | `source_id,matricula,tipo_doc,fecha_emision,fecha_vencimiento,estado_vencimiento,numero_doc,organismo,archivo_nombre,notas` |
| `Viajes_Historicos` | `source_id,numero_origen,cliente_cif,cliente_nombre,referencia_cliente,origen,destino,fecha_carga,hora_carga,fecha_descarga,hora_descarga,matricula_tractora,matricula_remolque,chofer_dni,colaborador_cif,mercancia,peso_kg,bultos,km_ruta,km_vacio,importe,precio_colaborador,coste_gasoil,coste_peajes,coste_dietas,coste_otros,estado,notas` |
| `Viajes_Pendientes` | Misma cabecera que `Viajes_Historicos`; solo estados operativos permitidos, sin inferir entrega. |
| `Facturas_Historicas` | `source_id,numero_origen,serie_origen,fecha,cliente_nombre,cliente_cif,total,tipo_operacion,rectificativa,rectifica_referencia,estado_historico,origen,notas` |
| `Facturas_Lineas` | `source_id,factura_source_id,linea,importe,vehiculo_matricula,tipo_operacion,fecha_factura_proveedor,proveedor,factura_proveedor,coste_proveedor,beneficio_origen,observaciones` |
| `Facturas_Pendientes` | `source_id,numero_origen,serie_origen,fecha,fecha_vencimiento,cliente_cif,cliente_nombre,total,cobrado,saldo_pendiente,notas` |
| `Gastos_Operativos` | `source_id,tipo,subtipo,proveedor,matricula,pedido_source_id,chofer_dni,periodo_desde,periodo_hasta,fecha,pais,importe,iva_pct,referencia,notas` |
| `Repostajes` | `source_id,matricula,fecha,hora,litros,precio_litro,importe,km_odometro,proveedor,referencia,notas` |
| `Gastos_Estructura` | `source_id,nombre,tipo,importe,periodo,fecha,notas` |

## Reglas comunes

- La identidad de importación es empresa + entidad + `source_system` + `source_id`; el hash del archivo no sustituye a la identidad de fila. Un lote repetido no vuelve a crear registros.
- Nombres de columnas: se admiten la clave exacta y el nombre visible español normalizado que figure en un catálogo de alias versionado. No hay búsqueda aproximada. Los alias adicionales se publicarán aquí antes de activarlos. Un mapeo manual solo afecta al lote actual.
- Alias adicionales v1: `matricula` acepta «Matrícula» y «Matrícula vehículo»; `codigo_postal` acepta «Código postal» y «CP»; `fecha_vencimiento` acepta «Fecha de vencimiento»; `fecha_carga` y `fecha_descarga` admiten «Fecha de carga/descarga»; `cliente_cif` admite «CIF cliente»; `chofer_dni` admite «DNI conductor» y «DNI chófer»; `tipo_doc` admite «Tipo documento»; `source_id` admite «ID origen» e «Identificador origen». El catálogo del servidor es la fuente ejecutable de estos alias.
- Texto UTF-8; fechas `AAAA-MM-DD`, o fechas numéricas de Excel interpretadas con el sistema de fechas del libro; horas `HH:mm`; decimales sin separador de miles y con `,` o `.` decimal. Se aceptan importes negativos legítimos. No se evalúan fórmulas.
- CSV usa coma o punto y coma como separador; TSV usa tabulador. Se admiten campos entrecomillados con comas, saltos de línea y comillas escapadas. El XLSX individual debe contener una hoja con el nombre oficial de su plantilla. Tamaño máximo: 20 MB comprimidos, 100 MB descomprimidos, 100.000 filas y 70 columnas; se rechazan ZIP64, macros y libros con fórmulas.
- Las fechas no comprobables no se convierten en fechas ficticias. `PERMANENTE` es un estado documental y deja `fecha_vencimiento` nula; `AMPLIACION`, `VIGENTE` y textos similares requieren revisión.
- En documentos, la importación de metadatos no implica que el PDF esté almacenado; `archivo_nombre` permite su emparejamiento posterior. DNI y matrícula se normalizan solo para búsqueda, sin cambiar su visualización.
- `Gastos_Operativos.tipo`: `peaje`, `combustible_agregado`, `parking`, `ferry`, `adblue`, `dieta`, `lavado`, `recambios`, `mantenimiento`, `renting_leasing`, `itv`, `otros_costes_flota`. El combustible agregado sin litros no crea un repostaje.
- `Gastos_Estructura` representa un movimiento real histórico. No se inserta en los costes recurrentes/presupuestados existentes.
- `Facturas_Historicas` conserva número y serie de origen. No genera numeración, envío, VeriFactu ni SII. `Facturas_Pendientes` se presenta como **Saldos / facturas pendientes**: es una apertura de cartera separada, todavía sin imputación automática de cobros posteriores.
- El libro o CSV exportado escapa los textos que empiecen por `=`, `+`, `-`, `@`, tabulador o retorno para que no se ejecuten como fórmulas. Los números negativos permanecen como números.

## Resultado y compatibilidad

Cada carga pasa por validación, previsualización y simulación sin escrituras antes de confirmar. Se informa de creados, actualizados, omitidos, errores y advertencias, con fichero de errores descargable. El backend conserva lote, fila, usuario, hash, mapping y duración. Las plantillas v1 no admiten columnas desconocidas sin mapeo manual explícito. Cambiar un nombre de hoja o campo exige una versión nueva del contrato.

## Operación de lotes y límites de interpretación

- `POST /batches/:id/simulate` y `POST /batches/:id/confirm` son pasos separados. Para PDFs se utilizan `/documents/:id/simulate` y `/documents/:id/confirm`.
- `POST /batches/:id/cancel`, `/continue` y `/retry-errors` detienen, continúan o reintentan solo filas procesables. El worker vuelve a resolver identidad y relaciones dentro de una transacción antes de crear cada destino.
- `POST /batches/:id/rollback/simulate` describe bloqueos; `/rollback/confirm` solo revierte registros aún idénticos a su huella de importación y sin referencias posteriores. La confirmación vuelve a verificar las huellas. No elimina registros preexistentes omitidos.
- `GET /batches/:id/report.xlsx`, `/errors.csv` y `/errors.xlsx` descargan resultados privados de la empresa, con textos protegidos frente a fórmulas.
- `GET /history/overview?batch_id=<UUID>` muestra totales de origen por lote, separados de la facturación y cobros actuales. El total de factura histórica puede incluir IVA, las líneas pueden usar otra base y el saldo pendiente es el del origen; no se suman ni concilian automáticamente con KPI netos de TransGest.
- Los viajes históricos quedan en `import_viajes_historicos`, separados de tráfico actual. Los pendientes sí entran en `pedidos` con referencia de migración y sin disparar rutas de notificación. La conciliación de históricos de origen con BI financiero o cobros posteriores requiere una fase específica y datos fiscales/bancarios adicionales.
