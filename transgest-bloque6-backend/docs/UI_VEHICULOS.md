# Gestión de vehículos

Vista inicial con tabla y tarjetas, búsqueda, filtros de tipo/estado/ubicación, vencimientos, paginación y exportación CSV. Los indicadores usan vehículos activos y fechas reales de ITV y seguro. La ubicación se identifica como la última registrada. No se inventan estados GPS, costes de mantenimiento o clasificaciones ambientales.

Las fichas conservan identificación, ficha técnica, compra/venta, documentación, plataformas, GPS, conjunto/conductor e historial. Se han unificado estilos de campos, pestañas y formularios para móvil y ambos temas, y corregido textos. La gestión avanzada conserva asignaciones, cambios de estado, bajas/reactivaciones y configuración GPS.

Desde la identificación de un vehículo guardado, Gerencia y Tráfico pueden añadir o quitar su foto. Se reutilizan el endpoint y la migración 015 de Taller. Sin foto se muestra el icono por tipo de vehículo; no se añaden fotos de ejemplo. Crear primero el vehículo permite asociar la foto a su identificador persistente.

Desplegar frontend desde main. No hay migración adicional; las fotos requieren el backend de la entrega de Taller con la migración 015 aplicada.

Pruebas: compilación, `npm run check` y `node scripts/fleet_browser_check.cjs` con datos simulados (filtros, exportación, fichas, subpestañas, fotos, permisos y tamaños).
