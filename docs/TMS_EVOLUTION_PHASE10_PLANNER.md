# Fase 10 · Planner (continuidad)

26/09/2026. Rama aislada `codex/tms-evolution-phase0`. Sin publicación ni datos de producción.

## 10A · Carga, carretillero y documentación

- El estado operativo se obtiene en servidor de la preparación y sus hechos registrados: planificada, asignada, en muelle, cargando, cargada, lista para salida, en tránsito, entregada, incidencia y cancelada. Los adaptadores conservan los estados anteriores de pedido/preparación. Cargada no descuenta stock ni inicia el transporte.
- Nuevo rol cerrado `carretillero`. Autenticación limita sus rutas a su cuenta y `planner-loading`; producto Planner comprobado en servidor. Asignación por usuario de la misma empresa. Proyección de campos sin costes/precios. Permisos personalizados no abren facturación.
- Vista móvil de cargas asignadas, muelle, referencia, mercancía, cantidades/faltantes, palés previstos, peso y progreso por líneas. Lectura con escáner de teclado o entrada manual de ubicación, referencia, lote y cantidad. No se anuncia reconocimiento de cámara/GS1 todavía.
- Cada acción usa UUID, huella del contenido y bloqueo de preparación. Repetir exactamente una lectura devuelve su resultado original; cambiar contenido con el mismo UUID produce conflicto. Se rechazan excesos y cierres incompletos; la incidencia debe resolverla tráfico.
- Iniciar carga exige llegada registrada y muelle activo asignado. Finalizar exige todas las cantidades y foto. Mercancía del pedido se concilia con las cantidades confirmadas y los pesos conservados de sus líneas. Aviso interno al chófer vinculado; push depende de la configuración real de la fase 7.
- El cierre prepara el albarán y prueba la generación de DeCA con el constructor y servicio de versiones existentes. Si faltan datos, URL o hay original externo, conserva el hecho de carga, muestra documentación pendiente y exige resolverla antes de salir. La acción de cierre nunca inventa identidades jurídicas ni sustituye un original externo.
- Albaranes nuevos: PDF conservado, SHA-256 y versión inmutable. Las versiones anteriores y albaranes legacy conservan sus identificadores. Cada versión nueva se adjunta al expediente privado del pedido. No reescribe documentos históricos.
- Toda expedición, también por la acción antigua de almacén, pasa por el control de DeCA vigente, peso y revisión. Descuento de stock y estado en curso son atómicos; evento de salida separado. El botón anterior conduce a la revisión de salida.
- Política `departure`/`delivery` por empresa o cliente, congelada en cada nueva preparación. Puede revisarse al asignarla. Entrega requiere POD de la propia carga; no factura automáticamente. El backend bloquea el borrador de venta antes del hito o con incidencia.

## Comprobaciones realizadas

- `npm run check`: regresión completa existente aprobada durante 10A, incluidas BI, pedidos, facturación, jornadas, documentos, tracking y Planner. Las ampliaciones posteriores de documentación vuelven a comprobarse con el banco HTTP y Planner.
- `npm run planner:regression`: correcto; ahora la prueba de expedición emite/revisa un DeCA sintético real. Una expedición sin él se rechaza sin descontar stock.
- `node scripts/audit_workflows_regression_check.cjs`: `passed:true`, `schemaErrors:[]`. `audit_planner_loading.cjs` integrado: login real del rol sintético, rutas financieras negadas aun con permiso personalizado, asignación, usuario no asignado, política, muelle, lectura repetida/cambiada/excesiva, foto, albarán versionado y conservación de bytes, DeCA, revisión, expedición única, POD y facturación tras entrega. No envía correos ni consulta proveedores.
- Frontend: 52 suites / 126 pruebas. Incluye reintento de lectura con el mismo identificador tras fallo de red y controles financieros ausentes del perfil carretillero.
- Build real `CI=false REACT_APP_LOCAL_SERVER=true npm run build`: correcto con avisos ESLint previos.
- Navegador local sintético: login carretillero, apertura, inicio y lectura parcial 5/10. Cierre deshabilitado mientras falta mercancía/foto. Anchos 390/768/1440/1920 sin desbordamiento horizontal; inspección visual móvil. No se ha probado un lector físico ni la cámara de un dispositivo real.

## Migración y compatibilidad

`20260926_planner_loading.sql` es aditiva: rol, hechos de carga, cantidades confirmadas anulables, operaciones idempotentes, política de facturación y originales de albarán. No rellena hechos pasados. Ejecutar `npm run migrate` antes de esta versión. El rol debe usarse después de que la transacción de migración termine. Los antiguos albaranes no se modifican.

Una reversión de código debe conservar las tablas y los originales; el código anterior no aplica el nuevo control de salida ni entiende el rol carretillero. No publicar una reversión que retire ese control sin revisar las cargas abiertas. No se ha ejecutado despliegue o reversión.

## Trabajo que sigue dentro de la fase 10

10B WMS profesional está pendiente de implementación/contraste: ubicaciones estructuradas, recepción/ASN, calidad, códigos GS1, FIFO/FEFO, conteos, traslados, packing/SSCC, reposición/cross-dock, check-in y métricas. Existen stock por ubicación/lote, recepción/fabricación, reservas, picking manual, precios congelados, repartos, portal de huecos y medias de carga; eso **no** demuestra el resto del WMS.

No se marca la fase 10 completa ni se anuncia WMS avanzado, control de presencia física certificado o eCMR certificado. La entrega desde transportista/chófer debe conciliarse con el consentimiento y eventos de las fases 11 y siguientes. El flujo nuevo de tráfico puede confirmar la entrega con su POD; no infiere entregas a partir del horario previsto.


## 10B — Procesos WMS verificados (26/09/2026)

Migración aditiva `20260926_planner_wms.sql`. Aplicarla después de la migración de carga y **antes** del código que consulta calidad/versiones de stock. Repetirla conserva existencias y decisiones; no se rellenan fechas de recepción ni calidad históricas. Al revertir código, conservar tablas y datos; no bajar a un código sin bloqueo de calidad mientras existan lotes bloqueados/reservados.

| Proceso | Implementación y alcance comprobado |
| --- | --- |
| Ubicación | Almacén, código, zona, pasillo, estantería y nivel; identidad por empresa |
| ASN / recepción | Aviso multilínea; recibidos parciales/excesos, cierre motivado, cantidades preservadas, operaciones UUID reintentables |
| Calidad | Pendiente/liberado/bloqueado; recepción nueva pone en cuarentena el lote/ubicación; reserva y salida rechazan lotes no liberados/caducados. El histórico sin decisión permanece explícitamente sin revisión |
| Caducidad | Impide fusionar existencias de mismo lote y ubicación con otra caducidad; fecha de caducidad comparada en Europe/Madrid |
| Traslado / reposición | Movimiento doble transaccional, conserva total, lote, calidad y recepción conocida; no traslada unidades reservadas. Reposición manual; no algoritmo automático |
| Inventario / conteo | Apertura con cantidad y revisión de stock; confirmación física motivada, incluso cero; cualquier modificación posterior invalida el conteo. No inventa recuentos históricos |
| FIFO/FEFO / picking | Propuesta de lotes liberados disponibles; fechas desconocidas al final y cobertura parcial. Reserva/reparto/picking existentes reutilizados; no asignación automática |
| Código GS1 | GTIN-14, SSCC-18 y AI 00/01/10/17/21/37; check digit, longitudes y fecha; lector como teclado/manual. Fecha 17 conserva AAMMDD (día 00 significa fin de mes), sin atribuir titularidad del prefijo |
| Packing / SSCC | Contenido por línea de preparación; impide embalar más de lo reservado, duplicar SSCC y modificar cargas cerradas; etiqueta QR descargable autenticada |
| Cross-docking | Secuencia existente recepción → calidad → preparación → muelle, sin almacenaje intermedio obligatorio; registro de ubicaciones/transfers manual. No motor automático de consolidación |
| Slots / llegada QR | Portal de solicitudes existente; QR de reserva identificativo, selección/lectura y confirmación por oficina autorizada. No enlace anónimo, no confirma la llegada al abrir un QR |
| Tiempos / slots | Media real por muelle existente y media/mediana/P90 por periodo añadido. No duración universal obligatoria ni bloqueo exclusivo; programación dinámica automática pendiente de reglas operativas y muestra, no simulada |
| KPI WMS | Cargas con inicio/fin reales en periodo Madrid; muestra y cobertura. Stock actual separado del periodo, por unidad compatible; pendiente/bloqueado y lotes sin revisión |

Interfaz en Almacén y stock → Procesos de almacén. Reutiliza controles, colores, modal, preparación y movimientos. Listados acotados y límites visibles (ubicaciones 500, ASN/conteos/SSCC 200, auditoría 100); no se anuncian totales históricos sobre esas páginas. No hay cámaras GS1 certificadas, inventario cíclico programado ni reposición autónoma. Estas automatizaciones avanzadas no se presentan como realizadas.

### Evidencia

- `node scripts/planner_inventory_check.cjs`: OK con migración repetida, ASN parcial/exceso, reintento, aislamiento, cuarentena, traslado conservativo, conteo obsoleto/cero, GS1, SSCC, llegada y bloqueo de expedición sin perder reservas (`phase10-wms-stock-final.log`).
- `node scripts/audit_workflows_regression_check.cjs`: API real en PGlite aislado; gerente A/B, carretillero sin WMS, fechas inválidas/sin muestra y QR privado. Correo/proveedores exteriores deshabilitados (`phase10-wms-http-final.log`).
- `npm run check`: superado (`phase10-wms-check-final.log`). Se actualizaron únicamente los cargadores simulados de dos pruebas antiguas para admitir el nuevo subrouter; los flujos y el aislamiento se verifican además por HTTP real.
- Frontend: 53 suites y 127 pruebas; reintento mantiene UUID y perfil sin edición deshabilita escrituras. Build local compilado con advertencias existentes (`phase10-wms-front-final.log`, `phase10-wms-build-final.log`).
- Navegador local sintético: crear ASN de 12 unidades desde formulario; confirmación y listado visibles. Modal usable a 390 px; página sin desbordamiento global a 390/768/1440/1920. Pestañas corregidas para no comprimir palabras; tablas anchas conservan desplazamiento horizontal. Viewport restaurado.
- Descubierta respuesta de producto incompleta que dejaba Planner verificando indefinidamente: ahora informa error. El banco de navegador también sirve la ruta pública de producto real.

No se ha desplegado ni probado en equipos físicos, lectores industriales o una base productiva. El intercambio del albarán actual entre empresas se concilia en la fase 11; se conserva cada versión original.
