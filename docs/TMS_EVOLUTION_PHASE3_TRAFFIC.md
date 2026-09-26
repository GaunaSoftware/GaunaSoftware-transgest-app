# Evolución TMS — fase 3: tráfico y grupajes

26/09/2026. Rama aislada `codex/tms-evolution-phase0`. Continúa la base aditiva de fase 2; no sustituye Plan Diario, pedidos ni documentos comerciales. No se ha realizado push, despliegue ni escritura en producción.

## Cambios y evidencia

| Bloque | Implementación y comprobación |
|---|---|
| Cuadrante | Panel plegable de pendientes. Semana en Europe/Madrid: se ocultan días anteriores solo en la semana actual; las semanas pasadas conservan siete días. El movimiento de un pedido exige confirmación y valida empresa, recursos, indisponibilidad, vacaciones, solapamientos y capacidades conocidas en servidor. Avisos aceptados quedan auditados. |
| Grupajes | Nombre visible actualizado también en el contenedor de navegación. Preparador con pedidos disponibles y remolque, añadir/retirar mediante botones o arrastre. El borrador se guarda sin crear un pedido comercial adicional. |
| Ruta y mercancía | Disposición física y secuencia de paradas independientes, con teclado y arrastre. Cada carga precede a su descarga. Propuesta de proximidad solo con coordenadas explícitas; cálculo por carretera reutiliza el servicio de rutas. Cambiar paradas invalida la estimación anterior. No se presenta masa máxima del vehículo como capacidad de mercancía. |
| Viaje padre | Un viaje operativo, enlaces a pedidos y envíos y paradas propias. El cuadrante lo muestra como una unidad expandible; conserva pedidos internos, clientes e importes. Las acciones rápidas individuales no actúan sobre un hijo desde esa tarjeta. La asignación conjunta es transaccional y el PUT individual rechaza cambiar recursos de un hijo. |
| Historial | Optimistic locking por versión y operaciones identificadas. Confirmar/guardar/reintentar no duplica viajes. Deshacer exige el grupo entero sin iniciar; cancela el plan y conserva vínculos e historial. Los snapshots de versión incluyen mercancía y recorrido. |
| Costes del viaje | Registro neto en EUR, con concepto, fecha, justificante, actor y operación. Rechaza referencia repetida y conserva el mismo registro al reintentar. Es independiente de los costes de pedido y está expresamente pendiente de conciliación BI en fase 15. No se incorpora por duplicado al margen actual. |

## Defectos encontrados durante esta fase

- La lista resumida omitía `grupaje_id` y el estado de borrador; ahora añade ambos y metadatos de viaje sin fusionar filas comerciales.
- La asignación antigua editaba cada pedido por separado y podía dejar asignación parcial. La nueva acción de grupaje usa una transacción y valida todos los recursos.
- `remolque_id_manual` es un alias de entrada, no una columna de pedidos: la nueva validación y persistencia usan `remolque_id`.
- Los cambios de disposición no se guardaban y se confundían con el recorrido; se guarda cada dimensión de forma explícita.
- Un estilo antiguo `flex:none` producía un ancho de tabla desmesurado al añadir el panel. Corregido y medido en navegador.
- El conflicto entre dos hijos del mismo viaje aparecía como solapamiento; el análisis visual trabaja con unidades operativas.
- La consulta de permisos dentro del registro de costes usaba otra conexión; ahora usa la misma transacción, evitando el bloqueo reproducido en el banco aislado.

## Validación ejecutada

- Backend `npm run check`: salida 0, incluidos BI, agenda, facturación, Planner, permisos y app del chófer.
- Backend `npm run audit:regression`: salida 0. Pruebas HTTP de grupaje incluyen rol chófer rechazado, recursos inválidos con rollback total, asignación de ambos pedidos, reintento, rechazo de modificación individual, registro y reintento de coste, versión obsoleta, separación parcial rechazada y conservación del historial.
- `node scripts/groupage_plan_check.cjs`, `node scripts/traffic_assignment_check.cjs`, `node scripts/operational_model_check.cjs`: salida 0. Incluyen repetición de migraciones, aislamiento, ruta/disposición, ausencia de horas y datos reales, y conservación comercial.
- Frontend `npm run check`: salida 0. `CI=true npm test -- --watch=false --runInBand`: **42 suites, 115 pruebas correctas**.
- `CI=false REACT_APP_LOCAL_SERVER=true npm run build`: salida 0 con advertencias anteriores de ESLint/dependencias. Este build es para el banco local; el build de publicación no debe heredar esa variable.
- Navegador local PGlite con correo externo deshabilitado: preparar dos pedidos QA, guardar borrador, cambiar disposición, confirmar, ver una tarjeta en cuadrante, expandir con Enter y abrir el plan. En móvil se registra y recupera el coste sintético **25,50 €**. Verificación visual a **1440 y 390 px**; a **768 px** el documento mide 768 px y el plan 641 px sin desbordamiento interno. No se ha probado un dispositivo físico.

## Migraciones y compatibilidad

Aplicar mediante `npm run migrate`, después de la migración operativa de fase 2:

1. `20260926_operational_model_groupage.sql`: disposición, ruta estimada, relaciones activas, versiones y recibos de operaciones.
2. `20260926_operational_model_journey_costs.sql`: costes del viaje y unicidad de referencia activa.

Lecturas comerciales y endpoints existentes conservados. La proyección permite lectura sin tablas nuevas; las escrituras nuevas requieren migraciones aplicadas. No hay backfill de históricos ni modificaciones fiscales. Para revertir la aplicación se conserva el esquema aditivo: no borrar tablas con planes o evidencias.

## Límites para continuar

- La normalización automática solo admite pedidos con una carga y una descarga. Varias paradas no identifican por sí solas los envíos jurídicos: el servidor exige identificarlos, sin inventar relaciones ni mercancía.
- Un grupaje guardado se deshace íntegramente antes de cambiar sus miembros; el arrastre de entrada/salida corresponde al preparador de borradores. Un grupaje ya iniciado no admite esta operación.
- Arrastrar un grupaje a otro día no desplaza silenciosamente las citas: se revisan sus fechas en los pedidos y se guarda el plan. La asignación conjunta sí se realiza desde tráfico.
- Optimización por proximidad no equivale a optimización con restricciones, horarios o tacógrafo. El servicio de carretera está conectado al endpoint existente; no se ha validado un proveedor externo real ni su contrato de restricciones en este banco sin conexiones externas.
- El ledger de costes de viaje no hace conciliación automática con tickets/importaciones. Su anulación y conciliación deben resolverse antes de habilitar imputación BI (fase 15).
- Las acciones multiparada del conductor deben sincronizar el nuevo grafo y respetar el orden entre pedidos: siguiente fase. Las firmas/documentos reforzados siguen en fase 5.
- No se ha medido concurrencia en PostgreSQL nativo ni carga real. Los bloqueos solo garantizan exclusión entre escritores que usan el protocolo nuevo; los flujos antiguos se revisan en las fases dependientes.

Las puertas de regresión están en verde. Se puede continuar con fase 4; esta evidencia no declara publicable la evolución completa ni cerrados los límites anteriores.
