# Listado y asignación de pedidos · 17/09/2026

## Cambios

- La asignación rápida de flota propia muestra únicamente los recursos. Los campos de venta, coste y margen se ofrecen solo para proveedores. Cambiar de proveedor a flota propia descarta cualquier modificación de precio del formulario, también en selección múltiple.
- El panel derecho de seguimiento puede plegarse desde el separador situado entre el listado y el panel. La elección se conserva en este navegador. El plegado del menú global continúa disponible.
- La tabla ocupa el ancho disponible, sin celdas de acciones superpuestas al estado o la incidencia. Cuando el espacio no permite leer las columnas se utilizan tarjetas con los mismos datos operativos.
- Cada pedido incluye **Resumen** para desplegar cliente, referencia, asignación, mercancía, peso, paradas y horarios, incidencia y notas. Los detalles se consultan al abrir, una sola vez para ambas representaciones; los errores permiten reintentar. No se abre el editor ni se modifica el pedido.

## Verificación reproducible

Desde `transgest-bloque6-backend/transgest-frontend`:

```text
npm run check
npm test -- --watchAll=false --runInBand
npm run build
node scripts/orders-list-regression.cjs
```

La prueba de navegador utiliza datos sintéticos y una API interceptada, sin credenciales. Requiere Playwright, Chromium y el puerto 4395. `BROWSER_CHANNEL=msedge` permite usar Edge; `PLAYWRIGHT_MODULE_PATH` permite indicar una instalación externa. `ORDERS_LIST_QA_OUTPUT` cambia el directorio de capturas.

Comprueba las anchuras 1920, 1662, 1440, 1280, 768 y 390 con el panel abierto y cerrado, el resumen con horarios/notas, el reintento de una consulta fallida, la persistencia del plegado y los formularios de asignación. Las pruebas de componente verifican los campos enviados para flota propia individual/múltiple y proveedor con precios, matrículas y conductor.

No hay cambios de esquema, migraciones ni modificaciones de pedidos reales. El backend y los permisos de acceso existentes se conservan.

## Comprobación tras publicar

1. Recargar con Ctrl+F5 y abrir Pedidos / Tráfico.
2. En Asignación, elegir Flota propia: deben aparecer solo los recursos. En Proveedor externo deben aparecer los precios y el margen.
3. Usar la flecha del separador derecho para plegar/mostrar el seguimiento.
4. Pulsar Resumen para consultar los detalles y Ocultar para recogerlos. Ver sigue abriendo el editor.
