# TransGest TMS — progreso de fase 1

Base: auditoría en `TMS_EVOLUTION_PHASE0_AUDIT.md`. La fase 1 **no está cerrada** y no autoriza avanzar a fase 2.

| Bloque | Estado | Evidencia y siguiente paso |
| --- | --- | --- |
| 1.1 Agenda e incidencias | Implementado para dos causas automáticas; pendiente E2E y revisión de otros orígenes | `agendaIncidents.js` registra causas estructuradas de carga sin finalizar y entrega vencida, con idempotencia por empresa/pedido/causa activa. Reevalúa tras cambios de estado, edición de fechas, pasos del chófer y revisión diaria; resuelve sin borrar, conserva histórico. Agenda muestra motivo, pedido, acción y condición en foco, clic y toque; permite mostrar resueltas. Las incidencias manuales/legacy sin causa estructurada no se reinterpretan ni resuelven por inferencia. |
| 1.2 Ubicaciones | Parcial | `displayLocation()` y `missingLocationFields()` priorizan población, ciudad, dirección verificable y nombre; la lista/detalle de pedidos y el listado de Planner ya muestran el mejor valor disponible. Falta comprobar visualmente Mesa, mapa, carta de porte y Portal en un entorno aislado; no se han sustituido valores fiscales o direcciones por un nombre supuesto. |
| 1.3 Editor de puntos | Implementado en Pedidos; pendiente E2E visual | La búsqueda ya no copia el nombre en dirección. Crear y editar usan el mismo formulario. Si faltan dirección, población o CP, exige confirmación y persiste `location_incomplete`; esos puntos se pueden completar pero no seleccionar para viajes. El DeCA nuevo incorpora un snapshot de dirección, CP y población de las paradas; probado con Kerahome Tiles. No se han reescrito DeCA anteriores. |
| 1.4 Cliente y tarifa | Implementado en editor normal y pedido rápido | Cambiar o quitar cliente limpia valores dependientes del borrador y confirma antes de descartarlos. No altera clientes ni tarifas maestras. Mantiene mercancía y paradas; estas deben revisarse para el nuevo cliente. |
| 1.5 Longitud | Implementado en pedido normal y rápido; pendiente E2E | La migración `20260925_cargo_length_mode.sql` añade modo `auto`/`manual` sin reescribir históricos (NULL). El editor recalcula cargas completas nuevas al cambiar remolque, hasta 13,65 m; conserva modo manual e históricos. El pedido rápido respeta la longitud manual. Hay advertencias de longitud, peso y capacidad de palés. Falta probar el flujo completo con base/API aisladas. |
| 1.6 Estados | Pendiente | Catálogo compartido y adaptación de vistas. |
| 1.7 Fechas reales | Pendiente; dependencia de datos identificada | `savePedidoChoferPasos()` en `routes/pedidos.js` desplaza hoy `fecha_descarga`/`hora_descarga` cuando la carga comienza tarde. Una copia o trigger que sincronizase esas columnas como fecha pactada sobrescribiría el plan original. Antes de migrar, separar la estimación dinámica de la planificación y verificar todos los escritores de fechas (web, app, colaborador e importación). Los históricos ya desplazados no permiten reconstruir el pacto original sin fuente externa; no se inventará. |
| 1.8 Anotaciones de factura | Pendiente | Capa versionada separada del registro fiscal. |
| 1.9 Permisos app chófer | Pendiente de reproducir con sesión de prueba aislada | Las pruebas sintéticas existentes no identifican el 403 concreto. No ampliar permisos sin diagnóstico. |

## Validación realizada

- Línea base backend `npm run check`: correcta antes de cambios frontend.
- Backend `npm run check`: correcto tras 1.1 (incluye migración sintética repetible, alta/edición de puntos, aislamiento entre empresas, snapshot DeCA e incidencias de Agenda).
- `npm run agenda:regression`: correcto tras 1.1; migración repetible con tabla heredada y base nueva, dos causas, deduplicación activa, resolución/histórico, lectura por rol y aislamiento de empresa.
- Frontend `CI=true npm test -- --watch=false --runInBand`: 33 suites, 91 tests correctos tras 1.1.
- Frontend `npm run check`: correcto tras los cambios de puntos.
- Frontend `npm run build`: correcto con advertencias ESLint ya presentes en línea base.
- Tras usar `displayLocation()` en Planner: 33 suites y 91 tests frontend correctos; build correcto con las mismas advertencias de línea base.
- `git diff --check`: correcto.
- E2E de navegador con datos sintéticos: pendiente. No hay base/API aisladas preparadas en este worktree; no se usaron datos de producción.
- Para publicar el bloque 1.5 en el futuro, ejecutar la migración versionada antes de activar el backend que guarda `longitud_ocupada_mode`. No se ha aplicado fuera de la prueba sintética.
- Para publicar el bloque 1.3 en el futuro, ejecutar `20260925_point_location_incomplete.sql` antes de activar el backend. La prueba sintética verifica alta, edición, confirmación e aislamiento de empresa; `npm run geo:regression` comprueba también el snapshot DeCA.
- Para publicar el bloque 1.1 en el futuro, ejecutar `20260925_agenda_incident_lifecycle.sql` antes de activar el backend. Las entradas legacy de Agenda no tienen causa verificable y permanecen intactas. La revisión diaria examina solo pedidos recientes (60 días) y no inventa un histórico de incidencias.
- Limitación de 1.1: el estado legacy `incidencia` del pedido, cuando lo asignó el scheduler antiguo, no se revierte automáticamente tras replanificar una entrega: no hay estado previo fiable almacenado. El aviso estructurado de Agenda sí se resuelve; decidir una transición del propio pedido exige conservar primero su estado previo y auditar los casos de paralización/manuales.

No hay push, merge, despliegue ni migración aplicada por este avance.
