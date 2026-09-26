# Modelo operativo — fase 2

## Decisión antes de modificar el esquema

Se reutilizan Pedidos, los JSON de paradas, `driverStops`, los pasos del conductor y los documentos existentes. Las seis entidades aditivas no sustituyen el registro comercial. Las facturas siguen referenciando pedidos; no se suman ingresos por cada vínculo o parada.

La conversión automática masiva de históricos se descarta: varias cargas y descargas no permiten deducir envíos jurídicos ni su mercancía. El adaptador representa un pedido simple con una carga/descarga como un envío y un viaje, y conserva una advertencia de origen legacy. En multiparada presenta sus paradas, pero devuelve envíos pendientes de identificar; no construye un producto cartesiano. Los grupajes se consolidarán explícitamente en fase 3.

La materialización es optativa, transaccional y solo para pedidos simples pendientes/confirmados, sin grupaje. No cambia su estado, precio, factura, fechas ni documentos. Es idempotente por empresa/pedido y por operación. Una lectura no escribe. El snapshot de recursos identifica lo registrado en el pedido en el momento de materializar, no pretende reconstruir asignaciones históricas.

Los vínculos nuevos usan claves foráneas compuestas con empresa. El modelo permite varios pedidos/envíos por viaje y enlaza la mercancía de cada parada; una parada no puede enlazar un envío ajeno a su viaje. Coordenadas, ventanas y tiempos reales se conservan solo si existen y son válidos. No se utiliza una fecha planificada como un evento real.

## Puerta de entrada

La regresión de fase 1 termina en verde (backend `check`, `audit:regression`, frontend 38 suites/107 pruebas, check y build). Esto permite iniciar trabajo aditivo de fase 2 conforme a la regla de no avanzar con tests rojos. Los límites de dispositivos físicos, integraciones y documentos históricos descritos en fase 1 siguen abiertos para sus fases específicas. No se declara completada la evolución global.

## Contrato y despliegue

- Migración nueva, versionada, sin backfill ni eliminación de columnas legacy.
- El endpoint de lectura exige un rol de oficina autorizado al módulo Pedidos y vuelve a limitar por empresa. No expone un grafo de varios clientes al rol cliente ni al chófer.
- La creación del modelo requiere permiso de edición operativo. Un chófer no materializa viajes.
- Mantener los endpoints anteriores; ningún consumidor debe depender de que todos los históricos estén materializados.
- Aplicar la migración antes del nuevo endpoint de escritura. Revertir código conserva las tablas aditivas; no ejecutar un DROP como rollback.

## Implementación y evidencia — 26/09/2026

`operationalModel.js` implementa el adaptador de lectura y la materialización transaccional de pedidos simples aún no iniciados. `GET /pedidos/:id/operativa` es compatible con una base anterior a la migración; `POST` necesita el esquema nuevo y `client_operation_uuid`. Ninguna lectura escribe. Los errores de conexión se propagan, no se convierten en un modelo vacío. Las paradas conservan coordenadas y ventanas disponibles; una fecha inválida no se convierte en evento real.

`20260926_operational_model.sql` crea seis tablas con vínculos compuestos por empresa. El envío pertenece a un pedido del mismo viaje y la mercancía de parada solo enlaza envíos de ese viaje. No se suman ni reescriben importes comerciales. Las asignaciones quedan capturadas en el snapshot; todavía no se ejecutan desde esta nueva entidad hasta migrar los flujos siguientes.

Pruebas ejecutadas, todas con salida 0:

- `node scripts/operational_model_check.cjs`: migración repetida, lectura anterior/posterior, pedido simple, multiparada sin envíos inventados, grupaje sin km duplicados, ventanas y hora real en cambio horario, reintento, operación reutilizada para otro pedido, rollback al fallar auditoría, recurso ajeno, snapshot de asignación y claves foráneas.
- Backend `npm run check` y `npm run audit:regression`: incluidos 9 controles HTTP nuevos con roles y límites de módulo reales, dos empresas y rechazo del chófer. Conservación byte a byte del registro comercial tras materializar.
- Frontend `npm run check`, `CI=true npm test -- --watch=false --runInBand`: 38 suites, 107 pruebas. `CI=false npm run build`: correcto con advertencias ESLint preexistentes.
- Navegador sintético: Control Tower → Cargado → PED-2026-0012 abre su editor, con poblaciones estructuradas. Se restauró el viewport habitual; no se cerraron pestañas.

Estado: base compatible de fase 2 implementada y probada en PGlite/HTTP aislado. No hay backfill masivo, editor de envíos múltiples ni migración de un viaje ya iniciado. Esos flujos requieren asignar explícitamente mercancía y se desarrollan en las fases dependientes. PostgreSQL nativo, carga concurrente real y dispositivos físicos no están verificados. No hay push, despliegue ni modificación de producción.
