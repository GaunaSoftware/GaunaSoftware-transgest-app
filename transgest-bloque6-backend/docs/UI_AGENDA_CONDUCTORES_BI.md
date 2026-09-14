# Agenda, avisos, conductores, peticiones y BI

## Cambios
- Agenda operativa: vistas de día, semana y mes; cuadrícula por horas, navegación de fechas y eventos del servidor. Mantiene creación, edición, estados, recordatorios y avisos ignorados.
- Conductores: indicadores calculados sobre el listado, búsqueda por nombre/DNI/teléfono/población/matrícula, filtro sin vehículo y paginación. Ficha y pestañas internas conservadas y adaptadas a móvil.
- Peticiones: resumen lateral de incidencias y asignaciones, exportaciones con filtros y editor adaptado. Se conservan las restricciones de conversión y la negociación de precios.
- Avisos importantes: panel flotante más legible, resumen y tarjetas; conserva minimizar, mover, marcar leído, abrir pedido, crear recordatorio e ignorar. Formularios de mantenimiento adaptados.
- BI nativo: selección de series, búsqueda y orden de clientes, top 5/10, participación, concentración y media por cliente; CSV del desglose filtrado. Los KPI siguen referidos al periodo completo, indicado en pantalla.
- Dashboard: tablas de estados y facturación por cliente. Conserva el seguimiento en vivo de cargas.

Los datos proceden de las API existentes. No se añaden logos, imágenes de clientes ni cifras de ejemplo a producción. No requiere migraciones ni configuración de Microsoft Power BI.

## Validación
Compilación de producción correcta. Persisten dos avisos previos de hooks en GestionTrafico y MiCuenta.

`node scripts/workspaces_redesign_check.cjs` con Playwright/Edge: API simulada, vistas y navegación de agenda, envío de guardado de tarea y petición, búsqueda y pestañas del conductor, filtros y exportación BI, panel de avisos, tamaños 390/768/1672 y temas claro/oscuro. Sin errores JavaScript ni desbordamiento de los contenedores comprobados. No escribe en producción.

## Publicación
Desplegar el frontend desde main. Marcador HTTP: `2026-09-14-agenda-conductores-bi`.
