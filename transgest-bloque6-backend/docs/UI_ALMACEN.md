# Gestión de almacén

La vista inicial separa stock registrado, salidas preparadas, movimientos y rectificaciones, con filtros, paginación, exportación CSV e informes imprimibles. Mercancía propia, depósitos de clientes, histórico detallado y facturación siguen disponibles mediante sus accesos. Se conservan los cálculos y las operaciones de stock existentes. El saldo se identifica como registrado, no como un inventario físico conciliado. La API actual limita la lectura a 1.000 movimientos; se muestra su alcance.

Los formularios de movimientos y mercancías comparten los estilos de los otros módulos. Los informes de stock/movimientos y albaranes usan una plantilla imprimible con datos de la empresa, referencias y cantidades. Las devoluciones preparadas se identifican como salida no confirmada. Abrir, exportar o imprimir no confirma movimientos ni genera facturas.

## Devolución y transporte propio

1. Preparar la devolución con propietario, lote/obra, cantidad y número de albarán.
2. En Entradas / Salidas, abrir Albarán o Transporte / DCD.
3. Vincular el pedido que realiza el transporte, con camión propio o colaborador. Si no existe, Crear pedido de transporte abre el formulario habitual con cliente, fecha, descripción de palets y referencia del albarán. Completar carga, descarga, vehículo, conductor, peso y demás datos, guardar y volver a la devolución para vincularlo.
4. Revisar los datos y generar/actualizar el DCD con Gerencia o Tráfico. Se reutiliza el sistema documental del pedido, sus validaciones, repositorio y URL de consulta. Si faltan datos, se muestran los pendientes; el albarán no sustituye por sí solo ese expediente.
5. Confirmar salida cuando se haya producido. Vincular o imprimir no descuenta stock ni factura.

El vínculo es persistente y limitado a movimientos y pedidos de la misma empresa. No admite un transporte cancelado y no crea pedidos duplicados. La referencia normativa consultada para mantener separado el albarán del expediente de transporte es la [Orden FOM/2861/2012, texto consolidado](https://www.boe.es/buscar/act.php?id=BOE-A-2013-154). La clasificación y validación documental siguen a cargo del sistema DCD existente.

## Despliegue y pruebas

- Backend desde `main`: ejecutar `npm run migrate` para aplicar `014_palets_transporte.sql` y reiniciar. Sin esa migración, el vínculo devuelve un aviso de actualización; no modifica stock.
- Frontend desde `main`.
- `node scripts/palet_transport_check.js` en backend: migración idempotente, aislamiento de empresa, validaciones y vínculo sin alteración de cantidades/estado ni duplicación de pedidos.
- `node scripts/warehouse_browser_check.cjs` en frontend, con Playwright: saldos, preparación, informes, impresión de albarán, CSV, vinculación/generación de DCD simuladas, formularios, permisos y adaptación a móvil. No modifica datos de producción.
