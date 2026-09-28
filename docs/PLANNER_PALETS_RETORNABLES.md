# Palés retornables en Planner

Al confirmar una expedición, cada línea de artículo cuya referencia o descripción empieza por `PALET` crea una entrega a nombre del cliente del pedido. La nueva pestaña **Palés en clientes** muestra cantidad expedida, devuelta y pendiente por pedido y artículo. La devolución exige cantidad y referencia de albarán, aumenta el stock de la ubicación original y registra el movimiento. Un mismo identificador de operación no puede duplicar el stock.

La migración aditiva `20260928_planner_pallet_returns.sql` crea un libro separado del de palés de TransGest. No reconstruye expediciones anteriores porque no hay evidencia suficiente para saber si eran retornables o ya se devolvieron. El saldo empieza con las expediciones confirmadas tras la migración. Las operaciones quedan aisladas por empresa y las devoluciones no pueden superar la cantidad entregada.

Validación: `npm run planner:regression` ejecuta el recorrido con datos sintéticos, incluido cliente, stock, salida, devolución, reintento, exceso de devolución y aislamiento de otra empresa.
