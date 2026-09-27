# TransGest TMS — fase 4: chófer multiparada

26/09/2026. Rama `codex/tms-evolution-phase0`, continuación del modelo y los grupajes de fases 2–3. Solo banco sintético local; sin push ni despliegue.

## Implementación

- El grupaje normalizado aparece como un viaje, con próxima parada `n/total`, secuencia guardada y acceso a la tarjeta operativa del pedido de esa parada. Reutiliza navegación, mercancía, escáner, albaranes, incidencias y firma existentes.
- `driverJourney.js` valida el orden completo del viaje en el servidor. Otro pedido del mismo viaje físico no constituye un segundo viaje incompatible. Los viajes distintos siguen bloqueados. Un cambio de conductor se comprueba de nuevo dentro de la transacción; un plan compartido no concede acceso a pedidos ajenos.
- `driverStops.js` mantiene los pasos por pedido como contrato compatible y actualiza `viaje_paradas`, mercancía vinculada a un único envío, referencias de documentos, huella de firma e incidencias. No atribuye cantidades a envíos ambiguos. La última firma de descarga completa el viaje; una entrega intermedia no libera al conductor.
- Llegada, inicio y finalización son eventos distintos. Los timestamps normalizados corresponden a la recepción en servidor; el momento comunicado por el móvil se conserva separado en la solicitud auditada. Espera y duración se calculan a partir de esas recepciones. La captura GPS es opcional y no bloquea si está indisponible. Los intervalos con sincronización diferida no se presentan como medición física certificada.
- `chofer_parada_operaciones` impone unicidad empresa + UUID, conserva solicitud, actor, fecha de recepción, hash y resultado. Mismo UUID/mismo contenido devuelve el recibo; contenido diferente devuelve conflicto. Escritura de progreso, grafo, recibo y estado del conductor se revierte conjuntamente si falla la transacción. La cola conserva el UUID original.
- La app no muestra una acción provisional antes de recuperar el avance, distingue error de lectura y ofrece reintento. Las acciones quedan deshabilitadas mientras se registra un paso. El estado mostrado tras guardar procede del backend.
- Corrección encontrada en QA: ambas listas de pedidos permitían al chófer ver pedidos de otro conductor por compartir vehículo, aunque el detalle los rechazaba. Ahora el acceso por vehículo solo se aplica cuando no hay conductor principal ni segundo conductor asignado. Esto elimina también los avisos 403 provocados al cargar los documentos de esas tarjetas ajenas.
- Corrección visual: pesos NUMERIC como `100.000` se muestran `100 kg` y se editan como `100`, sin confusión con separadores de miles. La vista conserva la identidad del área de chófer.

## Pruebas reales de esta tanda

- `node scripts/driver_journey_check.cjs`: correcto. Cuatro paradas, orden entre pedidos, cantidades independientes, firma/documentos/incidencia por parada, tiempos de servidor, GPS inválido, misma operación repetida, UUID reutilizado, rollback inyectado y aislamiento de empresa/conductor. Migración aplicada dos veces.
- `npm run check`: correcto después de adaptar el mock de `driver_documents_access_check.js` a la comprobación explícita de existencia del nuevo grafo. El primer intento falló porque ese mock rechazaba la consulta `to_regclass`; la auditoría HTTP real no presentó ese fallo. `npm run driver:regression` repetido: correcto.
- `npm run audit:regression`: correcto. `AUDIT_BROWSER=1 node scripts/audit_workflows_regression_check.cjs` volvió a pasar todas las aserciones y arrancó el banco visual. Añadido `audit_driver_journey.cjs`: confirma secuencia global, rechazo de estado global, reintento, conflicto, progresión de dos pedidos del mismo camión y denegación tras reasignación. `audit_driver_flow.cjs` comprueba también ausencia del pedido ajeno en ambos listados.
- Frontend `npm run check`: correcto. `CI=true npm test -- --watchAll=false --runInBand`: **43 suites, 117 pruebas correctas**. `CI=false REACT_APP_LOCAL_SERVER=true npm run build`: salida 0, advertencias anteriores de ESLint. Esa variable de build es exclusiva del banco local.
- Navegador: próxima parada 2/4 Murcia, secuencia Alicante → Murcia → Madrid → Guadalajara, apertura con Enter, guardia de jornada cerrada, apertura de jornada y comienzo de segunda carga sin completar otras paradas. En la revisión final ya no aparece el pedido del otro conductor ni su aviso de permiso. Peso `100 kg` y encuadre verificados a 390 px. Sin desbordamiento horizontal a 390/768/1440/1920 px; viewport restaurado. Se conserva el navegador abierto.
- `git diff --check`: correcto. No se han enviado correos ni llamado servicios operativos externos.

## Migración y límites

Aplicar `20260926_operational_stop_events.sql` después del modelo operativo. Añade progreso y ledger; no rellena eventos históricos. Las lecturas legacy siguen funcionando sin grafo; las nuevas escrituras con UUID requieren la migración. Reversión de código sin borrar las tablas de evidencias.

Esta fase migra los viajes ya materializados. Los pedidos históricos/multiparada sin relación explícita de envíos conservan su flujo por parada legacy; no se inventa su grafo. La materialización de un viaje ya iniciado y la identificación manual de envíos múltiples siguen pendientes.

La app conserva acciones pendientes de sincronización pero no permite adelantar la secuencia normalizada sin confirmación del servidor. El funcionamiento Android/offline más amplio corresponde a fase 7. No se han verificado un dispositivo físico, GPS real ni concurrencia PostgreSQL nativa. El expediente y las firmas reforzadas de fase 5 todavía no están implementados por estos cambios; las referencias actuales apuntan al mecanismo previo.

Puertas de esta tanda en verde; permite continuar con fase 5. No declara finalizada ni publicable toda la evolución.


## Referencias de cierre posteriores

La fase 5 añadió identificación explícita de envíos nuevos, originales, expediente y firma de conformidad versionada; la fase 7 añadió el soporte Android/offline documentado. El cierre del 27/09/2026 ejecutó el banco HTTP completo en PostgreSQL nativo sintético. No se han probado teléfono físico ni materialización de viajes históricos ya iniciados. El checklist de cierre conserva esos límites.
