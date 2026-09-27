# Fase 12 — Facturas de proveedor y conciliación

Implementación local del 27/09/2026; sin publicación ni proveedores externos utilizados en las pruebas.

## Fuente, permisos y recorrido

Se reutiliza `colaborador_facturas` como registro de facturas recibidas. `facturas_proveedor` conserva el original privado, su SHA-256, extracción, revisión/versiones y actor; `factura_proveedor_lineas` conserva las asociaciones y diferencias; los eventos guardan el resultado de cada revisión. No se añaden costes a los pedidos ni se duplican en BI por subir un documento.

Acceso desde Facturación → Pagos y desde Proveedores → Viajes y facturas. La misma vista sirve en ambos lugares. Requiere permiso de facturación y rol gerente, contable o administrativo en servidor; lectura y escritura se distinguen. La IA exige además plan/permiso IA y cuota vigente. Gerencia configura tolerancia absoluta y porcentual; se utiliza la mayor y la diferencia sigue visible.

1. Subir PDF, XML o imagen (máximo 5 MB). El hash reutiliza una entrada ya subida. Originales con XML/entidades externas se rechazan.
2. Leer texto de PDF o campos Facturae; alternativamente solicitar extracción visual IA mediante el proveedor configurado. Verificar nombre/NIF del emisor, número, fecha, moneda, importes y líneas contra el original descargable. No se asigna un pedido por una sugerencia de la IA.
3. Guardar y conciliar contra referencia de pedido/viaje operativo, fecha, ruta, matrícula y precio del colaborador. Una referencia de viaje con varios pedidos queda ambigua hasta elegir/distribuir las líneas; no se multiplica el coste del tramo.
4. Resultado por servicio: coincide, diferencia, no encontrado o parcial. Se agrupan las bases de las líneas del mismo pedido antes de comparar con el precio acordado, sin mezclar IVA. Diferencias/sin servicio/parciales requieren justificación.
5. Confirmación humana obligatoria. Bases e impuestos por línea deben cuadrar con cabecera/total. Registro EUR; otras monedas se pueden revisar pero no registrar contra el modelo anterior sin una conversión documentada.

## Compatibilidad e integridad

- Se bloquea proveedor+número repetido incluso con otro archivo; los registros anteriores se consultan para esta comprobación. Cargas/reintentos y confirmaciones idénticas no duplican registros.
- La proyección al registro anterior agrupa por pedido y conserva exactamente las sumas de bases y cuotas reales, también negativas. Sustituye solo una previsión sin número y pendiente; conserva su estado anterior en auditoría. No modifica facturas recibidas históricas.
- Las proyecciones de una factura revisada no pueden alterarse ni borrarse por las rutas de edición antiguas. Los pagos siguen su flujo independiente; nunca se generan automáticamente. El original y el desglose se consultan en conciliación. `iva_pct` legado es un tipo efectivo de compatibilidad: para desglose fiscal manda el original y las cuotas de cada línea; no se presume un IVA fijo.
- Se corrigió un acceso con tilde al campo `numero_factura` en el listado/editor anterior que mostraba números como ausentes.
- Documento y detalle privados, sin enlaces anónimos; listados de 25, catálogo de proveedores hasta 100 coincidencias con búsqueda. Revisión optimista versionada y transacciones bloqueadas por proveedor para evitar confirmaciones concurrentes.

## Evidencia y límites

- `npm run check`: salida 0, incluidas regresiones de pedidos, documentos, chófer, Planner y BI (`phase12-check.log`).
- Frontend: 55 suites y 129 pruebas correctas (`phase12-front.log`); confirmación humana se invalida al editar importes. Build ordinario correcto con avisos existentes (`phase12-build-final.log`). El intento con `CI=true` falló porque convierte los avisos preexistentes en errores; no es una compilación limpia de avisos.
- `node scripts/supplier_invoice_extraction_check.cjs`: salida 0. Contrato del proveedor configurado, OpenAI sin almacenamiento, cuota, plan, JSON inválido y abonos; respuesta IA simulada, ninguna llamada externa.
- `node scripts/audit_workflows_regression_check.cjs`: API y PostgreSQL-compatible PGlite, sin datos reales. XML, hash, duplicados, confirmación, bases/impuestos, campos negativos, previsión sin doble registro, aislamiento y edición antigua bloqueada. Registro final en `phase12-http-final.log`.
- La extracción no certifica firma/XML ni sustituye la revisión contable. PDF sin texto, layouts ambiguos y líneas con cuotas no extraíbles requieren completar manualmente o IA visual. Máximo 200 líneas; los documentos mayores necesitan separación/revisión, sin truncarlos como si estuvieran completos.
- No se ha validado OCR con el proveedor real ni conectividad financiera externa. La exactitud de cada extracción real debe revisarla una persona. No hay pagos ni asientos externos automáticos.

## Migración y reversión futura

Aplicar `20260927_supplier_invoice_review.sql` antes del backend. Es aditiva; no convierte históricos. Conservar tablas, originales y auditoría al retirar la interfaz. No volver a una versión que permita modificar las proyecciones revisadas desde el editor antiguo sin conservar esa protección. No se ha desplegado.

## Cierre de pruebas locales

`npm run production:regression`: salida 0 (`phase12-production-final.log`). Frontend final: 55 suites/129 pruebas y build con `REACT_APP_LOCAL_SERVER=true`, salidas 0 (`phase12-front-final.log`, `phase12-build-verified.log`). API: 35 comprobaciones específicas y cero errores de esquema; referencia a viaje, varias líneas/servicios e impuestos diferentes conservan sumas, además de regresiones heredadas. Se verifica rechazo de XML de más de 200 líneas sin truncamiento.

QA visual en navegador local con datos sintéticos: Facturación → Pagos reconoce los documentos revisados (0 sin factura), mantiene 460 EUR pendientes y no marca pagos. Se comprobó diálogo a 390 y 1440 px; etiquetas alineadas, campos revisados legibles y bloqueo de edición. También se concilió la detección documental en avisos y diagnóstico de empresa para evitar avisos falsos. Ningún correo/proveedor IA/servicio externo utilizado.
