# Mesa de tráfico

Presentación renovada del cuadrante, navegación de planificación, indicadores, filtros y formularios. Se conservan Plan diario, agrupaciones, optimización, edición en Pedidos y las operaciones existentes de asignación.

El cuadrante incorpora filtro por vehículo y selección de un día con navegación anterior/siguiente. En móvil muestra tarjetas por vehículo con sus viajes, fecha seleccionable para añadir viajes, pedidos sin asignar y colaboradores. Los colores representan estados reales; no se añaden porcentajes de evolución ficticios. En móvil los indicadores adicionales aparecen al activar filtros avanzados.

Verificación: build de producción y prueba traffic_redesign_check.cjs en Edge con APIs simuladas, tamaños 390/768/1672 y temas claro/oscuro. Se comprueban semana/día, búsqueda, navegación de pestañas y ventana de asignación. No se escriben datos de producción. Persisten los avisos de hooks previos de GestionTrafico y MiCuenta.

Despliegue del frontend desde main. No requiere migraciones.
