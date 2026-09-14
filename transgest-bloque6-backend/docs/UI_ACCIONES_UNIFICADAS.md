# Acciones integradas en las pantallas nuevas

14 de septiembre de 2026.

- Pedidos: el menú de cada fila incorpora cancelación y eliminación, cambios de estado, asignación y autoasignación, retrasos, CMR y avisos. Para eliminar, filtrar por Cancelados y utilizar Eliminar pedido. Se exige confirmación y se conservan las restricciones de permisos y facturación.
- Las acciones masivas, planificación y bandeja IA se abren dentro de la pantalla nueva. Se elimina el listado alternativo antiguo.
- Vehículos: estados, baja, reactivación y eliminación definitiva en el menú de cada vehículo. Gestión GPS integrada, sin listado alternativo.
- Taller: eliminación con confirmación y factura del proveedor disponibles en el detalle moderno.
- Almacén: saldos, liquidaciones, mercancía propia, depósitos e historial permanecen dentro del espacio nuevo, con estilos compartidos para sus herramientas.

## Validación

Compilación de producción y prueba `scripts/unified_actions_check.cjs` con API simulada: eliminación de pedido cancelado, protección de pedidos facturados, selección masiva, planificación, GPS, confirmación de eliminación de taller y secciones de almacén. Comprobaciones de desbordamiento a 390, 768 y 1672 px. No se envían mensajes ni se alteran datos de producción.

No requiere migraciones de base de datos. El despliegue del frontend se realiza desde main.
