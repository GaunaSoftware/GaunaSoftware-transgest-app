# Taller

Nueva vista de órdenes con filtros, paginación, exportación CSV y detalle del vehículo, trabajos, recambios e historial. Los estados y costes proceden de las intervenciones existentes. No se inventan prioridades, fechas previstas o listas de trabajos. El historial avanzado conserva las acciones originales y la gestión de facturas de proveedor.

Se mantienen stock, trazabilidad de unidades, neumáticos, talleres/proveedores, mantenimiento preventivo, solicitudes de conductores y tareas de mecánicos. Los formularios comparten superficies, campos y colores para ambos temas; las etiquetas mantienen sus dimensiones e impresión.

La foto del vehículo es opcional. Gerencia y Tráfico pueden añadirla o quitarla desde el detalle de una orden. Admite PNG, JPEG y WebP hasta 256 KB. Se guarda en la API por empresa. Al no existir foto o fallar su carga, aparece un icono según tipo/clase: tractora, remolque, bañera, cisterna, frigorífico o camión. No se añaden fotos de ejemplo ni se modifican logos.

## Publicación

Desplegar backend y frontend desde main. En backend ejecutar `npm run migrate` para aplicar `015_vehiculos_imagen.sql` y reiniciar. Sin la migración, guardar fotos informa de la actualización necesaria.

## Verificación

Compilación de producción; `node scripts/vehicle_image_check.js` en backend; `node scripts/workshop_browser_check.cjs` en frontend con Playwright. Datos simulados para navegación, formularios, fotos, exportación y tamaños; base de datos temporal para validación, aislamiento de empresa y migración idempotente.
