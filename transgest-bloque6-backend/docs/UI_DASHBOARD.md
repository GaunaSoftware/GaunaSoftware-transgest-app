# Dashboard

Vista inicial inspirada en la captura: cuatro indicadores, agenda de cargas y descargas, acciones rápidas, alertas y tareas, cinco pedidos recientes, vencimientos a 30 días, actividad semanal, facturación por cliente y resumen de Control Tower. Se mantienen los logos y el menú acordado.

Los datos proceden de las consultas existentes del Dashboard. La agenda usa las fechas y horas de carga/descarga de los pedidos; no sustituye los eventos de la Agenda completa. La actividad semanal muestra cargas/descargas planificadas, no inventa una segunda serie de viajes. Facturación del mes y clasificación por cliente usan la base imponible de las facturas del mes actual, excluyendo borradores, canceladas y anuladas. No se muestran variaciones ficticias. El resumen de Control Tower indica pedidos en ruta, pedidos cargando/descargando y vehículos en taller; no afirma disponer de GPS en directo.

Las acciones y tarjetas respetan los permisos de módulo. Nuevo pedido y apertura de un pedido reciente reutilizan el foco y editor existentes; los demás accesos abren su módulo. Los vencimientos enlazan con el vehículo, conductor o factura correspondientes. No se crean ni se envían registros desde la vista inicial. Los indicadores se basan en los datos cargados al abrir la pantalla, con los límites de paginación existentes de la API.

El botón «Análisis detallado» conserva el Dashboard anterior, sus filtros de periodo, indicadores BI, cálculos y acciones. Las consultas fallidas muestran un aviso de resumen incompleto y permiten reintentar. Se conserva el límite de espera de pedidos y se libera su temporizador al terminar la consulta.

## Validación y publicación

- `npm run build`: compilación de producción.
- `node scripts/dashboard_browser_check.cjs`: Edge con API simulada; recuentos, exclusión de borradores, agenda, clasificación, vencimientos, permisos, apertura de pedidos, análisis detallado, estados vacíos, error/reintento y tamaños 390–1672 px en temas claro/oscuro.
- No requiere migraciones ni cambios en el backend. Desplegar el frontend desde `main` tras publicar este bloque. Para las imágenes del bloque anterior sigue siendo necesaria la migración `013_clientes_imagen_opcional.sql`.
