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
