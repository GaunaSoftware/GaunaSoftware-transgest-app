# Tráfico y agrupación de pedidos

Mesa de tráfico, Peticiones de viaje, Control Tower y Calculador de portes comparten cabeceras, superficies, filtros y controles adaptados a ambos temas y tamaños. Se mantienen cálculos, acciones y estados operativos existentes. El cuadrante conserva desplazamiento horizontal para poder consultar su semana en pantallas pequeñas.

Excepciones operativas está en Gestión → Trazabilidad, junto al registro de actividad. La reorganización respeta los permisos existentes.

Pedidos mantiene su tabla compacta y añade separadores por fecha de carga. Ordena los registros cargados cronológicamente, conservando el orden previo dentro de cada día. Muestra meses si hay varios, semanas de lunes a domingo si hay varias y días siempre. Los registros sin fecha quedan al final. Las cabeceras se repiten al cambiar de página para conservar contexto; no cuentan como pedidos ni cambian selección o exportación. Los recuentos corresponden a los registros filtrados cargados; la paginación del servidor sigue disponible.

Pruebas: `node scripts/order_date_groups_check.cjs`, `node scripts/orders_browser_check.cjs`, `node scripts/operations_style_check.cjs` y compilación de producción. Las pruebas de navegador usan datos simulados y no modifican producción.
