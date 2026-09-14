# Portal del cliente

Inicio con indicadores de la API, navegación superior y seguimiento con lista de envíos, detalle y documentos. Se conservan los logos configurados y los servicios existentes. Formularios de solicitud y edición, facturas, estado de cuenta, informes y ayuda adaptados a móvil y escritorio, con tema claro y oscuro.

Validación: build de producción; npm run check; portal_browser_check.cjs en Edge con API simulada (390, 768 y 1672 px), selección y filtros, documentos, informes, creación y edición de solicitudes, errores/reintento y cierre de sesión. No se han realizado escrituras en producción. Permanecen dos avisos de hooks previos en GestionTrafico y MiCuenta.

Pedidos: sin filtros se consulta desde la fecha local de hoy, sin límite superior. Búsqueda, filtros operativos o histórico eliminan ese límite implícito; las fechas explícitas se respetan. Regresión: pedidos_date_filter_check.cjs.

Despliegue: frontend desde main. Este cambio no requiere migraciones ni actualización de la API.
