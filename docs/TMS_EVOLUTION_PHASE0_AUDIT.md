# TransGest TMS — fase 0: auditoría previa

Fecha: 25-09-2026. Base inspeccionada: `origin/main` en `f4ef3daa833d072590ca09c6b9f7c3bf9118915d`. Trabajo aislado en `codex/tms-evolution-phase0`; el checkout principal conserva cambios ajenos. No se han consultado datos de producción. Este inventario describe código y esquema, no certifica que cada flujo funcione con datos reales.

## Matriz de funcionalidades

| Área | Estado observado | Evidencia y decisión |
| --- | --- | --- |
| Pedidos, viajes y multiparada | Parcial | `src/routes/pedidos.js` y `src/pages/Pedidos.js` concentran pedido, ejecución y paradas en un registro con `puntos_carga`/`puntos_descarga` JSON. Hay pasos de chófer y documentos. Conservar endpoints legacy y añadir modelo normalizado por migraciones en fase 2, sin reinterpretar históricos. |
| Agenda y avisos | Parcial y fragmentada | `routes/agenda.js` mantiene tareas con `metadata`, `pedido_id`, estados y permisos. `notificaciones.js` inserta recordatorios de colaboradores, mientras la auto-incidencia de entrega vencida se marca en `pedidos.js` y no crea evento de agenda reconciliable. Falta origen/causa/resolución estructurados, histórico de resueltas e idempotencia. `AgendaTimeline.js` permite clic, pero no expone explicación accesible en foco. Consolidar en fase 1.1. |
| Incidencias y estado de transporte | Duplicada | `orders/quickInfo.js`, `dashboard/operationalStatus.js`, `OrdersWorkspace.js`, `GestionTrafico.js` y backend definen etiquetas o tonos propios. Reutilizar `incidentLabel()` y `incidentDescription()` al crear catálogos compartidos; no retirar estados históricos. |
| Puntos/ubicaciones | Existe parcialmente y duplicada en UI | `puntos_interes.js` conserva nombre, dirección, CP, ciudad, provincia, país, coordenadas y ámbito de empresa/cliente. `Pedidos.js`, app de chófer y `PortalPointPicker.js` formatean por separado; no hay `displayLocation()` canónica. Creación y edición exigen dirección, pero existen editores distintos. Unificar presentación y editor; nunca fabricar dirección desde nombre. |
| Cliente/tarifa en pedido | Error reproducido en código | En `OrderRouteFields.js`, vaciar o pulsar **Quitar cliente** solo pone `cliente_id:""`; `ruta_id`, precio y condiciones sobreviven. Corregir estado del borrador con confirmación de valores manuales, sin tocar maestros. |
| Longitud ocupada | Parcial/error reproducido en código | `utils/cargoDimensions.js` calcula longitud de remolque o 13,65, pero el efecto en `Pedidos.js` reescribe `metros_lineales`/`carga_largo_m` y fija `_cargoLengthManual:true`, incluso para un valor previo. Falta modo persistente auto/manual. |
| Fechas planificadas y reales | Parcial | `pedidos.fecha_carga`/`fecha_descarga` y horas son planificación legacy; hay eventos/pasos operativos, pero no columnas explícitas `carga_real_at`/`descarga_real_at`. No calcular puntualidad desde horario previsto. |
| Facturas emitidas | Existe; anotaciones pendientes | `facturas.js` impide volver de emitida a borrador y opera estados fiscales. No se ha encontrado capa versionada de anotaciones informativas separada del registro fiscal. No modificar factura emitida para resolver esta carencia. |
| App chófer | Existe; incidencia no reproducida aún | `AppChofer.js` y `driver/*`; rutas `/app/*` en `choferes.js` y rutas de chófer en `pedidos.js`. Hay middleware de módulo en `server.js`. Falta reproducir el 403 concreto con usuario de prueba y `TEST_DRIVER_PASSWORD` fuera del repositorio; las pruebas sintéticas actuales no demuestran el flujo real. |
| Mesa de Tráfico/grupaje | Existe parcialmente | `GestionTrafico.js`, `PlanDiario.js`, `PlanificacionOperativa.js`, `RemolqueGrupaje.js` y `/grupaje/*` ya cubren operaciones; falta separar tramo físico de pedido para evitar duplicar km y mejorar asignación. Reutilizar en fases 2–3. |
| DeCA, carta de porte, documentos | Existe parcialmente | `documentoControl.js`, `regulatoryCore.js`, `docs.js`, rutas de pedido y `pedido_docs` ya generan/controlan documentos. Consolidar repositorio, snapshots y versiones en fase 5; no afirmar certificación legal ni reescribir documentos anteriores. |
| Planner | Existe parcialmente | `planner*` frontend/backend y migraciones 019–021 contienen inventario, preparaciones, muelles, reservas, conductores, intercambios y documentos. Mantener separación por empresa/plan y reutilizar, no duplicar. |
| Importación | Ya existe, validar antes de ampliar | `ImportacionWizard.js`, `routes/importacion.js` y servicios `import*` implementan lotes, simulaciones, identidades, costes, documentos e históricos con migraciones 20260924. Fase 9 debe partir de pruebas de formatos canónicos. |
| BI e informes | Ya existe | `pages/bi/*`, `financialKpis.js`, `biReportCenter.js` y documentación BI. No sustituir fórmulas, permisos ni exportación; fases finales deben usar contratos existentes. |
| Permisos/módulos | Duplicada | Catálogos distintos en `middleware/auth.js`, `Usuarios.js`, `AuthContext.js`, `App.js`, `planFeatures.js`. Backend protege rutas por módulo, pero cada ruta nueva exige aislamiento propio. Consolidar registro sin abrir acceso por accidente. |
| Proveedores | Parcial | `DocumentStorageProvider.js` tiene dos implementaciones. No se han encontrado interfaces equivalentes para firma, fiscal, rutas, GPS o contabilidad. Diseñarlas antes de nuevos proveedores externos, sin migrar la lógica actual a la fuerza. |

“Consolidar” significa retirar usos duplicados solo tras compatibilidad y pruebas; no borrar datos ni funcionalidad histórica.

No se ha confirmado una función completa meramente oculta que baste activar sin trabajo adicional. Sí hay capacidades que parecen ausentes a primera vista porque están repartidas (multiparada, Planner, importación y BI). No se propone eliminar ninguna función; los candidatos a retirar son únicamente mapas de estado y editores duplicados después de migrar sus usos.

## Modelo de datos actual

- `scripts/init.sql` define `usuarios`, `clientes`, `vehiculos`, `choferes`, `rutas`, `ruta_precios_cliente`, `pedidos`, `pedido_extracostes`, `facturas`, `factura_lineas`, `factura_extracostes`, `factura_pedidos`, `colaboradores`, documentos y auditoría. `pedidos` une datos comerciales, ruta, ejecución, mercancía, coste y facturación; no hay entidades normalizadas e independientes Pedido/Envío/Viaje/Parada.
- `scripts/migrations/002_operational_hardening.sql` añade `pedido_eventos`; `003_operational_normalization.sql` añade `puntos_interes`, almacenes y otros recursos. `018_puntos_identity_forward.sql` amplía la identidad de puntos. Los puntos tienen `empresa_id`; en pedidos conviven textos legacy y paradas JSON.
- `scripts/migrations/019_planner_inventory.sql` y 020–021 añaden artículos, existencias, preparaciones/líneas, movimientos, albaranes, muelles, reservas, vehículos autorizados, intercambios y eventos Planner.
- Las migraciones 20260923–24 añaden BI, plantillas e importación por lotes. `scripts/migrate.js` registra checksums en `schema_migrations`.
- `agenda_eventos` se crea actualmente durante el arranque en `src/server.js`, no en migración versionada. Se han contado 313 menciones de `CREATE TABLE`/`ALTER TABLE` en ese archivo; es deuda técnica previa. Ningún cambio nuevo de esquema debe depender de DDL en petición o arranque.
- No inferir integridad de datos solo por la presencia de una columna. Para fases posteriores hacen falta muestras sintéticas y pruebas de migración hacia delante y atrás de lectura.

## Riesgos y migraciones necesarias

1. **Alta:** fragmentación de `pedido` en nuevas entidades puede multiplicar facturas, km, costes o documentos y romper importaciones/portales. Primero añadir claves y adaptadores de lectura, después doble verificación de cifras y por último migración de flujos nuevos. Sin borrado de columnas legacy.
2. **Alta:** anotaciones en factura emitida no deben alterar datos fiscales ni PDF original. Requieren tabla versionada, historial de actor/motivo y PDF de presentación separado; validar con fiscalidad antes de publicar.
3. **Alta:** estados de conductor y colaborador están protegidos por distintas rutas/middlewares. Una corrección al 403 debe conceder solo el endpoint operativo y comprobar `empresa_id` más asignación del viaje.
4. **Alta:** DDL de arranque y algunos `ensure*Schema` en rutas son preexistentes. La nueva tabla/columnas de incidencias, fechas reales, `longitud_ocupada_mode`, anotaciones y entidades operativas deben ir por archivos SQL versionados. No ampliar el patrón de DDL runtime.
5. **Media:** nombres de lugar, CP y coordenadas pueden estar incompletos en históricos. Fallback visual no equivale a corregir datos; migración de puntos solo con valores verificables. DeCA nuevo debe capturar snapshot, sin regenerar el histórico.
6. **Media:** las prioridades y colores hoy difieren entre vistas. Un catálogo único debe mantener valores antiguos y adaptar alias, con contraste, teclado y portales.
7. **Media:** sin credencial de test del chófer ni base aislada no se puede verificar el 403 de una sesión real; sí se pueden probar autorización sintética y no-escapes de tenant.

Migraciones previstas, en orden: (a) incidencias automáticas y auditoría/resolución; (b) modo de longitud y fechas reales con compatibilidad de lectura legacy; (c) anotaciones de factura; (d) modelo Pedido/Envío/Viaje/Parada y vínculos; (e) repositorio documental/snapshots; (f) tracking/Planner/red e integración según evidencia de cada fase. Ninguna migra documentos emitidos por inferencia.

## Componentes y endpoints reutilizables

| Función | Reutilizar | Extensión probable |
| --- | --- | --- |
| Agenda | `Agenda.js`, `AgendaTimeline.js`, `agendaTypes.js`, `routes/agenda.js`, `routes/notificaciones.js` | `GET /api/v1/agenda`, filtros de resueltas, detalle, reconciliador de causas. |
| Ubicaciones | `puntos_interes.js`, `PortalPointPicker.js`, `EndpointAutocomplete`, `RutaMapa.js` | `GET/POST/PUT /api/v1/puntos-interes`, `displayLocation`, modal común. |
| Pedidos y estados | `orders/quickInfo.js`, `OrdersWorkspace.js`, `OrderInlineDetails.js`, `pedido_eventos` | `/api/v1/pedidos`, `/grupaje/*`, endpoints de pasos y estados; adaptadores legacy. |
| Chófer | `AppChofer.js`, `driver/*`, `routes/choferes.js`, `routes/pedidos.js` | `/api/v1/choferes/app/*` y rutas de chófer en pedidos con guardas por tenant/asignación. |
| Facturación | `routes/facturas.js`, `Facturacion.js`, `invoiceCustomerDocuments.js` | Endpoint separado de anotaciones; no PATCH fiscal libre sobre emitida. |
| Documentos | `documentoControl.js`, `regulatoryCore.js`, `DocumentStorageProvider.js`, `routes/docs.js` | Snapshots y versiones compatibles. |
| Planner/BI/importación | Servicios/rutas actuales y documentos `docs/BI_*` | Extensiones por contrato, sin duplicar tablas ni fórmulas. |

## Plan y dependencias

| Fase | Resultado y dependencia principal |
| --- | --- |
| 1 | Regresiones inmediatas: ubicaciones, cliente/tarifa, longitud, estados/incidencias, fechas reales, anotaciones y autorización conductor. Commits pequeños, cada uno verificable. |
| 2 | Modelo aditivo Pedido/Envío/Viaje/Parada y adaptadores; base de las fases 3–6 y 10–13. |
| 3 | Mesa de Tráfico y grupajes sobre viajes/tramos físicos, sin multiplicar km. |
| 4 | App chófer multiparada sobre paradas y estados compartidos. |
| 5 | DeCA, carta de porte y expediente con snapshots/versiones, después de las paradas de 2 y 4. |
| 6 | Tracking, ETA y geofencing sobre eventos/posición realmente capturados. |
| 7 | Android y publicación con regresiones de la app y permisos de 4–6. |
| 8 | Bandeja IA sobre pedido canónico y confirmación humana de las acciones. |
| 9 | Importador 2.0 por formatos canónicos; adaptar a 2 y reutilizar lotes actuales. |
| 10 | Planner sobre sus tablas existentes e intercambio con el modelo de viaje. |
| 11 | TransGest Network después de permisos, Planner/intercambio y viaje canónico. |
| 12 | Facturas de proveedor e IA con idempotencia y conciliación por viaje. |
| 13 | Facturación operativa conciliada con pedidos/viajes y documentos; no reescribir emitidas. |
| 14 | Fiscalidad por proveedor y versión, subordinada a integridad de 13. |
| 15 | KPI/BI sobre métricas comunes existentes y eventos verificados de 2–14. |
| 16 | Registro de integraciones y proveedores, consolidando conexiones existentes sin crear equivalentes duplicados. |
| 17 | Multiempresa sobre aislamiento probado en todos los módulos anteriores. |

No se debe iniciar una fase posterior con pruebas rojas de la anterior. Por alcance, ninguna fase posterior se considera terminada por este documento.

## Pruebas disponibles y línea base

- Backend: `npm run check` encadena sintaxis, tenant estricto, portal, geo, IA, operativa, BI, producción y app chófer. Hay scripts específicos de agenda, acceso conductor, documentos, grupajes/operativa, facturación, Planner e importación (`package.json`).
- Frontend: `npm test`, `npm run check`, `npm run build` y 31 archivos `*.test.js`/`*.test.jsx` localizados; Capacitor/Electron tienen builds separados.
- Hay pruebas de regresión sintéticas, pero no un E2E de navegador completo que cubra la totalidad de las 17 fases. No atribuir a `npm run check` la validación de una sesión real.
- Línea base: `npm run check` del backend **correcto** (tenant, portal, geo, IA, operativa, BI, producción, Planner y chófer); frontend `CI=true npm test -- --watch=false --runInBand` **31 suites, 85 tests correctos**; frontend `npm run check` **correcto**.
- El primer `npm run build` falló antes de compilar: el `node_modules` heredado del checkout principal tiene MapLibre 5.6.0 y no contiene `dist/maplibre-gl-worker.mjs`; el lockfile exige 6.10.0. Tras instalar dependencias de forma aislada con `npm ci --offline --ignore-scripts --no-audit --no-fund`, `npm run build` **correcto con advertencias ESLint preexistentes**. El primer `npm ci` con scripts falló por `EPERM spawn` del entorno; `--ignore-scripts` evitó la ejecución de instaladores de Electron/Capacitor no necesarios para el build web.
