# Pedidos / Tráfico

La entrada a Pedidos muestra la nueva vista compacta: cinco indicadores basados en el listado cargado, filtros, exportación CSV, selección, paginación local y panel de seguimiento. Se conserva la organización del menú y los logos de TransGest.

Las acciones de asignación, copia, apertura del pedido, orden de carga para colaboradores, aviso por WhatsApp y facturación reutilizan los manejadores y permisos existentes. Las acciones rápidas requieren seleccionar un único pedido. La vista avanzada mantiene las agrupaciones por fecha/cliente, la bandeja IA, cambios de estado y acciones masivas. El nuevo resumen no modifica precios, estados, peticiones ni payloads.

Los indicadores especifican «En el listado cargado»: cargas de hoy, pedidos en curso, falta de asignación, entregados e incidencias. No se inventan porcentajes ni recuentos globales. El filtro predeterminado sigue mostrando el mes actual y siguientes. El CSV contiene los pedidos filtrados cargados; cuando la API pagina, se mantienen los controles para cargar más bloques. La paginación visual es de 10/25/50 filas.

## Validación

- Compilación CRA y comprobación de sintaxis.
- `node scripts/orders_preservation_check.cjs`: compara la versión preparada en Git con `c266e24`: 73 manejadores asíncronos, siete cálculos de selección/datos, cuatro cálculos operativos e imports de API intactos. También admite rutas de dos archivos para comparar los cambios locales sin incluir otros trabajos pendientes.
- `node scripts/orders_browser_check.cjs`: todas las API simuladas; filtros, exportación, paginación, selección, asignación, copia, editor completo, vista avanzada y permisos de solo lectura. Pantallas 390/768/1024/1440/1672 px, temas claro y oscuro. No ejecuta envíos ni escrituras operativas reales.

## Despliegue de los bloques terminados

El usuario ha autorizado publicar los cambios terminados en `main` y realizará el despliegue de Vercel y Render.

1. Backend: desplegar `main`, directorio `transgest-bloque6-backend/transgest-backend`. Ejecutar `npm run migrate` contra la base de datos de ese entorno para aplicar `013_clientes_imagen_opcional.sql`, y reiniciar la API. La migración añade una columna opcional; no añade imágenes a ningún cliente.
2. Frontend: desplegar `main`, directorio `transgest-bloque6-backend/transgest-frontend`, conservando `REACT_APP_API_URL=https://transgest-backend.onrender.com`.
3. Confirmar en `https://app.gauna.es` el header `X-TransGest-Frontend-Build: 2026-09-12-finanzas-clientes-pedidos`. El dominio con `www` no resolvía durante la revisión.
4. Comprobar salud de la API y, con un cliente de prueba propio, guardar/recargar/quitar una imagen desde su ficha. Si la API antigua ignora la imagen, el frontend avisa de que la imagen no se ha guardado.

Este despliegue incluye los commits anteriores de Facturación y Clientes/Tarifas. Los otros cambios locales preexistentes no forman parte de esta entrega.
