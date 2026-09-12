# Dashboard operativo y BI

El Dashboard anterior se ha eliminado. Toda la información se presenta en el diseño nuevo; no existe una vista ejecutiva antigua detrás de un botón.

Operativa en curso muestra pendientes, confirmados, esperas de carga, cargando, en ruta, esperas de descarga, descargando e incidencias. Permite filtrar el estado y abrir el pedido. Consulta automáticamente cada 30 segundos y al recibir tms:pedidos-changed o recuperar el foco; evita consultas simultáneas y pausa la actualización automática con el documento o panel ocultos. Indica la última lectura y conserva esa lectura si falla una actualización. No se presenta como un canal push instantáneo. La lectura utiliza la paginación y límites existentes de getPedidosTodos.

Análisis BI abre un panel con el mismo estilo: selector de periodo, ingreso gestionado, facturado, pendiente de facturar, cobros, margen, EUR/km, evolución mensual, clientes e indicaciones concretas sobre datos pendientes. Usa el resumen BI del backend y los cálculos existentes como respaldo; muestra el error si no se puede consultar el servidor. Exporta los indicadores a CSV. El acceso depende de los permisos de Informes o Facturación.

Se mantienen la agenda de cargas/descargas, los pedidos recientes, vencimientos y accesos rápidos. Los formularios internos comparten estilo y conservan sus acciones. Los logos y organización del menú permanecen como estaban.

Pruebas: scripts/dashboard_browser_check.cjs verifica BI y exportación, actualización de estados al recibir un evento, ausencia del Dashboard antiguo, creación/apertura de pedidos, errores, permisos y tamaños 390–1672 px en ambos temas.
