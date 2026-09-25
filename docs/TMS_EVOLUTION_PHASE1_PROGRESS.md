# TransGest TMS — progreso de fase 1

Base: auditoría en `TMS_EVOLUTION_PHASE0_AUDIT.md`. La fase 1 **no está cerrada** y no autoriza avanzar a fase 2.

| Bloque | Estado | Evidencia y siguiente paso |
| --- | --- | --- |
| 1.1 Agenda e incidencias | Pendiente | Requiere migración versionada, reconciliación de causas e histórico. |
| 1.2 Ubicaciones | Parcial | `displayLocation()` y `missingLocationFields()` priorizan población, ciudad, dirección verificable y nombre; la lista/detalle de pedidos ya usan estos datos y explican campos faltantes. Falta unificar Mesa, mapa, DeCA, Portal y el editor de puntos. |
| 1.3 Editor de puntos | Pendiente | Revisar creación/edición común, confirmación de incompletos y snapshot documental. |
| 1.4 Cliente y tarifa | Implementado en editor normal y pedido rápido | Cambiar o quitar cliente limpia valores dependientes del borrador y confirma antes de descartarlos. No altera clientes ni tarifas maestras. Mantiene mercancía y paradas; estas deben revisarse para el nuevo cliente. |
| 1.5 Longitud | Implementado en pedido normal y rápido; pendiente E2E | La migración `20260925_cargo_length_mode.sql` añade modo `auto`/`manual` sin reescribir históricos (NULL). El editor recalcula cargas completas nuevas al cambiar remolque, hasta 13,65 m; conserva modo manual e históricos. El pedido rápido respeta la longitud manual. Hay advertencias de longitud, peso y capacidad de palés. Falta probar el flujo completo con base/API aisladas. |
| 1.6 Estados | Pendiente | Catálogo compartido y adaptación de vistas. |
| 1.7 Fechas reales | Pendiente | Migración y eventos servidor. |
| 1.8 Anotaciones de factura | Pendiente | Capa versionada separada del registro fiscal. |
| 1.9 Permisos app chófer | Pendiente de reproducir con sesión de prueba aislada | Las pruebas sintéticas existentes no identifican el 403 concreto. No ampliar permisos sin diagnóstico. |

## Validación realizada

- Línea base backend `npm run check`: correcta antes de cambios frontend.
- Backend `npm run check`: correcto tras el modo de longitud (incluye migración sintética e idempotencia con PGlite, aislamiento y regresiones generales).
- Frontend `CI=true npm test -- --watch=false --runInBand`: 32 suites, 90 tests correctos tras la longitud y el pedido rápido.
- Frontend `npm run check`: correcto tras los cambios de longitud.
- Frontend `npm run build`: correcto con advertencias ESLint ya presentes en línea base.
- `git diff --check`: correcto.
- E2E de navegador con datos sintéticos: pendiente. No hay base/API aisladas preparadas en este worktree; no se usaron datos de producción.
- Para publicar el bloque 1.5 en el futuro, ejecutar la migración versionada antes de activar el backend que guarda `longitud_ocupada_mode`. No se ha aplicado fuera de la prueba sintética.

No hay push, merge, despliegue ni migración aplicada por este avance.
