# Fase 6 — seguimiento, ETA y geocercas

26/09/2026. Rama aislada `codex/tms-evolution-phase0`. Datos sintéticos locales; sin llamadas a GPS real ni cambios en producción.

## Implementación y contrato

- `vehicleTracking` unifica las posiciones de app, pedido, vehículo y webhook. Valida coordenadas (vacío no es cero), velocidad, rumbo, precisión y fecha. Conserva la hora de captura; distingue recepción sin captura verificada. Una posición atrasada queda en el histórico sin sustituir la más reciente. Las retransmisiones con mismo contenido y hora no duplican el registro.
- Lectura por pedido/empresa y vehículo asignado. Tras entrega, facturación o cancelación no publica nuevas coordenadas de ese vehículo en el pedido antiguo. Sin captura verificada o con antigüedad superior al umbral no devuelve un marcador actual. Los documentos históricos no se regeneran.
- El panel compartido muestra edad, procedencia, umbral, velocidad, rumbo, precisión y próxima parada cuando existe. Consulta cada 30 segundos en pestaña visible; retira el marcador por edad sin esperar otra respuesta. Los errores son visibles; respuestas de otro pedido anterior se descartan.
- Integrado en mapa de Pedidos, app del chófer, detalle de Control Tower y seguimiento del cliente. El cliente solo puede consultar sus propios pedidos y no recibe configuración ni evidencias internas. El chófer solo sus asignaciones y no puede cambiar umbrales. Cabeceras privadas sin caché compartida.
- ETA a demanda reutiliza ORS HGV/OSRM. La distancia en línea recta tiene etiqueta propia y nunca sustituye una duración de carretera. ETA siempre estimada, sin pausas futuras; retraso solo con final de ventana que incluya fecha y zona horaria. No inventa ese dato desde un texto de horario. El portal muestra la disponibilidad real y no lanza rutas externas automáticamente.
- Geocercas por parada: radio (30–3000 m), histéresis (10–1000 m), precisión, orden temporal, entrada y salida deduplicadas. Registra posición, hora y umbrales usados. Solo una posición reciente con hora de captura y precisión puede proponer llegada. La propuesta exige confirmación humana por el flujo de paradas existente; nunca termina una carga o descarga.

## Migración y compatibilidad

`20260926_vehicle_tracking.sql` añade clave de ingestión/índices al histórico GPS y tablas de configuración, estado y eventos de geocerca. Es repetible y no reescribe posiciones anteriores ni introduce DDL en peticiones. Aplicar antes del backend y frontend nuevos. La configuración queda atribuida al usuario; los eventos conservan los parámetros efectivos, aunque se cambien después.

Los endpoints anteriores conservan su función; la respuesta de escritura GPS de app añade `ok`, `idempotent` y hora de registro. Los consumidores deben refrescar la lectura si necesitan la ficha completa del vehículo. Las coordenadas legacy sin hora de captura verificada siguen en el histórico pero no se presentan como señal actual.

## Pruebas ejecutadas

- `npm run check`: salida 0, incluidas regresiones operativas, BI, importaciones cubiertas por la batería, Planner, documentos y chófer.
- `node scripts/vehicle_tracking_check.cjs`: salida 0. PGlite: migración repetida, coordenadas/fechas, retransmisión, fuera de orden, geocerca y precisión, cambio de vehículo, datos ausentes, señal antigua, ETA sin ruta, permiso de empresa y estado operativo inalterado.
- `node scripts/audit_workflows_regression_check.cjs`: salida 0; `schemaErrors: []`, 95 verificaciones HTTP del chófer, además de los flujos de jornada/grupaje, documentos, Portal y Control Tower. Reproduce y corrige el 403 del nuevo endpoint en el allowlist del chófer. Cliente de otra empresa u otro cliente de la misma empresa: 404; chófer ajeno: 403. Cliente no entra en el endpoint interno.
- Frontend `CI=true npm test -- --watchAll=false --runInBand`: 45 suites, 119 pruebas, salida 0. Señal obsoleta/error sin marcador y descarte de respuesta de otro pedido incluidos.
- Build local `CI=false REACT_APP_LOCAL_SERVER=true npm run build`: salida 0; advertencias ESLint previas conservadas. Navegador sobre banco PGlite: seguimiento visible dentro de la parada, señal real de la fixture, ETA desactivada sin coordenadas del destino y error de ruta explícito (red externa deshabilitada). Anchos 390/768/1440/1920: documento 382/759/1431/1911 px, sin desbordamiento horizontal. No se solicitó geolocalización real del equipo. Ajuste final de botones para reutilizar `src/ui/Button` y singular/plural comprobado con pruebas de componente.

## Límites comprobables

No se ha validado en teléfono físico, carretera ni proveedor GPS real. No se atribuye fiabilidad de carretera a OSRM para restricciones de camión. El cálculo depende de coordenadas de parada verificadas y rutas disponibles. Las ventanas legacy de texto no permiten un retraso con zona horaria fiable. El histórico del GPS es del vehículo; no reconstruye asignaciones pasadas sin eventos. El seguimiento compartido con otra empresa Planner queda sujeto al consentimiento de las fases 10–11, no se abre acceso entre empresas en esta fase. No se anuncia SSE, posición inventada, certificación de llegada ni seguimiento Android en segundo plano.
