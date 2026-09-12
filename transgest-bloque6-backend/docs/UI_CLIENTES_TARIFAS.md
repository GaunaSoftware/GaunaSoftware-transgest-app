# Clientes y rutas / tarifas

Rediseño basado en la referencia del usuario: tabla compacta, búsqueda y filtros, paginación, exportación CSV y ficha de consulta lateral. En pantallas menores de 1100 px, la ficha se abre en un panel superpuesto; en móvil el listado usa tarjetas. Se conservan los logos de TransGest y la organización acordada del menú.

La ficha lateral contiene resumen, contactos, direcciones, condiciones y rutas/tarifas. La ficha completa conserva las operaciones existentes: datos fiscales, puntos, tarifas agrupadas, histórico, facturación múltiple y portal. Los accesos superiores enlazan Clientes y Rutas y tarifas según permisos.

## Imagen opcional

No se añaden imágenes, logos, avatares ni iniciales a los clientes automáticamente. Desde la ficha completa, el usuario con permiso de edición puede subir, cambiar o retirar una imagen PNG, JPG o WebP de hasta 256 KB. Se valida formato y tamaño también en el servidor. La imagen se guarda como `imagen_data`, dentro del cliente y con el aislamiento por empresa de las operaciones actuales.

Desplegar la API junto con el frontend y ejecutar `npm run migrate` en el backend para aplicar `013_clientes_imagen_opcional.sql`. La columna es opcional y los clientes existentes quedan con valor NULL. No se ejecuta ALTER TABLE durante peticiones. Si falta la migración, la API devuelve un error claro antes de modificar el cliente; las escrituras que no incluyen imagen siguen siendo compatibles. Un frontend conectado a una API antigua avisa si esta ignora la imagen, sin repetir el alta.

## Datos y alcance

Los indicadores se calculan sobre el listado cargado, limitado actualmente a 100 clientes por la consulta existente. La paginación de 10/25/50 filas y el CSV actúan sobre ese listado filtrado; el pie indica su alcance. No se inventa facturación anual, tendencias, comerciales o niveles de riesgo. Las tarifas muestran su unidad, incluido el formato histórico por 100 kg.

## Comprobación

- `npm run check` y `npm run build` en el frontend.
- `node scripts/clients_preservation_check.cjs`: compara 24 funciones/cálculos con `085addf`, permitiendo únicamente el aviso nuevo de imagen no persistida; conserva imports de API.
- `node scripts/sidebar_navigation_check.cjs`: permisos y organización del menú.
- `node scripts/clients_browser_check.cjs`: Edge con todas las API simuladas, subida/retirada/recarga, archivo no válido, filtros, CSV, paginación, tamaños 390–1672 px y vistas clara/oscura. Capturas e informe en `build/qa/clients/` (ignorados por Git).
- `node scripts/client_image_check.js` en el backend: validación y migración idempotente con PGlite, persistencia y retirada. No modifica la base de datos real.

## Publicación

El dominio configurado que responde es `https://app.gauna.es`, sin `www`. La entrega conjunta de Facturación, Clientes/Tarifas y Pedidos se publica en `main`, según autorización del usuario. Subir el código no aplica la migración de Render. El header de identificación del frontend es `2026-09-12-finanzas-clientes-pedidos`. Consulta `UI_PEDIDOS_TRAFICO.md` para los pasos de despliegue de frontend y API.
