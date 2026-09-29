# Validación de ajustes de chófer, tráfico y facturación — 29/09/2026

Trabajo en rama aislada `codex/driver-signature-traffic-invoices`. No se ha consultado ni modificado producción.

## Comportamiento comprobado

- La factura independiente se crea como borrador para un cliente, con referencia y concepto, sin pedir documentación de un viaje. Conserva el circuito de revisión y emisión existente.
- La cláusula de gasóleo puede confirmarse al preparar una factura de viajes; el importe pactado sustituye el recargo guardado en los pedidos, no se suma otra vez. Figura en línea separada tanto por viaje como agrupado. El borrador conserva porcentaje, base y recargo aplicados. Un porcentaje vacío o fuera de rango se rechaza. La preparación operativa de un lote también respeta la cláusula y su idempotencia distingue porcentajes distintos.
- El DeCA exige pedido confirmado y carga finalizada. En pedidos con varias cargas, cada envío exige la confirmación de su propio punto antes de emitir su versión; un consolidado espera todas las cargas que abarca. La emisión sigue limitada a tráfico, gerencia y chófer asignado. Se retiraron los intentos automáticos de emisión al entregar y al subir archivos. El portal cliente solo consulta documentos ya emitidos.
- La vista de tráfico presenta una proyección orientativa de ubicación por colores, sin afirmar que sustituya la posición GPS. La vista previa de un documento en navegador abre otra pestaña; Android dispone de una vista integrada que queda pendiente de compilar en un entorno con SDK.
- `no_verifactu` es un modo explícito que informa «pendiente» y bloquea emisión. El motor NO VERI*FACTU, la firma y la declaración responsable de versión aún no existen; ver `docs/NO_VERIFACTU_TLM_IMPLEMENTATION.md`.

## Comandos y resultados

- `node scripts/audit_workflows_regression_check.cjs` — pasó con datos sintéticos PGlite, incluidos facturación, permisos, portal y flujos operativos.
- `node scripts/invoice_fuel_regression_check.js` — pasó; totales y línea de combustible también se comprobaron en PDF.
- `node scripts/transport_document_versions_check.cjs` y `node scripts/transport_shipments_check.cjs` — pasaron, incluida la emisión por punto de carga.
- `node scripts/no_verifactu_guard_check.cjs` — pasó; verifica bloqueo seguro, **no** cumplimiento fiscal completo.
- `npm run driver:regression` y `npm run portal:regression` — pasaron tras retirar los automatismos de emisión; incluyen flujos de varias paradas y aislamiento de accesos.
- `npm run check` — pasó completo, incluidos operativa, BI, Planner, seguridad de rutas y regresión de chófer. Las advertencias de pruebas sobre rechazos de permisos y envíos simulados son resultados previstos de escenarios negativos.
- `CI=true npm test -- --runInBand --watch=false src/utils/invoiceLines.test.js src/pages/driver/signaturePayload.test.js src/pages/traffic/trafficLocationProjection.test.js src/pages/finance/StandaloneInvoice.test.js` — 4 suites, 25 pruebas pasadas.
- `npm run build` — compiló con avisos ESLint preexistentes en páginas ajenas a esta tanda.
- `git diff --check` — sin errores de espacios.

## Límites para liberar

- No se ha validado el APK nativo: el entorno local no tiene el JDK/SDK Android necesario y Gradle no pudo escribir su caché protegida. Hay que compilar y probar la vista integrada del PDF en un dispositivo Android antes de distribuir esta versión.
- NO VERI*FACTU **no está listo para producción**. Antes de habilitarlo para TLM hacen falta comprobación de su régimen fiscal y certificado por canal seguro, motor de registros y eventos con firma XAdES Enveloped, verificación/exportación, QR correcto, pruebas adversas y declaración responsable de la versión por la productora. Las facturas históricas no se modifican.
- La agenda proyecta ubicación usando plan y velocidad orientativa. Cuando haya GPS/tacógrafo de calidad podrá compararse con la posición real, siempre diferenciando ambas fuentes.
