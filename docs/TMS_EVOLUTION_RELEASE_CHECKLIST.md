# Evolución TMS 0–17 · revisión de cierre local

Fecha: 27/09/2026. Rama: `codex/tms-evolution-phase0`. Este documento complementa los informes de cada fase; no certifica producción ni sustituye los límites indicados aquí. No se ha hecho push, merge, despliegue ni cambios en datos reales durante esta evolución.

## Alcance alcanzado

| Fases | Disponible y contrastado en esta rama | Límites de cierre |
| --- | --- | --- |
| 0–1 | Auditoría, agenda por causa, ubicación estructurada, tarifa/cliente, longitud, estados y fechas reales/planificadas, anotaciones no fiscales, permisos del chófer | Los eventos históricos desconocidos no se reconstruyen. La cuenta real jmdp dejó de reproducir el 403; los nuevos flujos se verifican sintéticamente |
| 2–3 | Grafo pedido/envío/viaje/parada, materialización explícita, grupaje, disposición/ruta independientes, asignación conjunta, costes del viaje | Replanificación de viajes iniciados y de envíos ya documentados restringida; proximidad no es optimización con restricciones reales |
| 4–5 | Ejecución multiparada, originales DeCA inmutables, versiones, firma de conformidad, justificantes, correcciones relacionadas y expediente privado | Transición de QR legacy y validación física/jurídica pendientes; eCMR es arquitectura preparatoria, como pide 5.11 |
| 6–7 | Tracking validado, antigüedad GPS, geocercas auditadas, ETA a demanda, app Android y AAB local sin firma, push opcional | Sin prueba de teléfono físico, Play, Firebase ni proveedor GPS real |
| 8–9 | Bandeja de pedidos con revisión humana e importador por lotes; detección de origen modificado, aislamiento y recuperación | Inbound real sin dominio/proveedor probado; 10.001 filas medidas en PGlite, no SLA de Render |
| 10 | Carga por carretillero, cantidades/foto/documentos, salida atómica, ASN, calidad, lotes, FIFO/FEFO, conteos, traslados, packing/SSCC y llegada QR | Reposición manual, conteos no programados y slots sin planificación dinámica automática; ver lista de funciones no implementadas |
| 11–12 | Network con consentimiento por alcance; factura de proveedor privada, revisión y conciliación | Compartir fiscalidad entre sociedades y conversión automática de divisas no habilitados |
| 13–14 | Preparación de facturación por reglas, combustible separado, lotes reintentables; cola fiscal con originales y guardas | Verifacti/AEAT real, regímenes especiales y anulaciones requieren piloto; no se envió ninguna factura |
| 15 | Economía conciliada con viajes físicos, denominadores completos, kilómetros sin duplicar y asignación histórica conocida | Solapes de gastos sin enlace verificable quedan pendientes; no se anuncia beneficio neto completo |
| 16 | Registro de integraciones con evidencia, versión, ámbito y salud verificable | Un registro o una clave guardada no acredita producción |
| 17 | Membresía viva por empresa, rol/permisos, selector, revocación, protección de identidad compartida y BI de grupo autorizado | No elimina operaciones entre sociedades ni construye una instantánea transaccional única del grupo |

Implementar una fase y pasar su banco local no significa que todos sus requisitos de dispositivo, proveedor o publicación estén verificados. Los detalles están en `TMS_EVOLUTION_PHASE0_AUDIT.md` y los informes `TMS_EVOLUTION_PHASE1_…` a `TMS_EVOLUTION_PHASE17_…`.

## Defectos reproducidos y corregidos en el cierre

1. **Salida por portal y correo antiguo sin revisión del original vigente.** Ambos caminos usan las versiones archivadas y el mismo control de cobertura documental/peso que la app. Falta de revisión, versión sustituida o cambio de peso producen 409. Posicionarse y cargar siguen permitidos antes de emitir el documento. Un cliente antiguo no puede confirmar una salida global eludiendo la parada.
2. **Eventos duplicados al reintentar.** La comparación de arrays de versiones era por identidad de objeto; dos solicitudes iguales generaban dos eventos. Ahora compara contenido, conserva la primera fecha y audita una sola vez. El correo consume el token dentro de la transacción y mantiene las notas; sus bloqueos siguen el orden de los escritores de tráfico.
3. **Botones del portal sin funcionamiento.** Una comilla escapada incorrectamente en la plantilla producía JavaScript inválido en el navegador. El banco HTTP compila ahora los scripts renderizados. Se verificó abrir seguimiento, abrir directamente el documento, revisar y confirmar la salida.
4. **Estado y presentación engañosos del portal.** Carga completada se mostraba como «en ruta». Ahora se distingue «cargado», se sincronizan los estados del encabezado y el detalle y el contador indica albaranes. Hover del botón principal conserva contraste, foco es visible y nombres de PDF largos ajustan en móvil. Los errores de conexión se muestran. Las magnitudes del correo usan formato español: 100 kg no aparece como «100.000 kg».
5. **Fecha civil desplazada.** PostgreSQL devolvía SQL DATE como Date en la zona del servidor; serializarla en UTC hacía que 15/01/2020 fuese 14/01/2020 en Madrid. El pool conserva SQL DATE como `YYYY-MM-DD`; no altera los parsers de timestamps. No se modifica ninguna fila histórica. Prueba en Madrid/UTC/Los Ángeles y ambos cambios de horario.
6. **Orden incorrecto del migrador real.** `localeCompare` situaba extensiones `_groupage` antes de su base `.sql`, fallando por ausencia de `viajes_operativos`. Orden estable por nombre sin renombrar ni modificar los SQL históricos. El comando real aplica 61 migraciones y repetirlo no cambia el ledger.
7. **Bancos de seguridad desactualizados.** Faltaban tablas del registro y campos de tracking. Se cargan las migraciones reales correspondientes, manteniendo las aserciones de aislamiento, revocación, secretos, SMTP y GPS.

## Comandos y evidencia

Backend: `transgest-bloque6-backend/transgest-backend`. Logs locales ignorados por Git; no contienen datos de clientes. Los scripts reproducibles y sus aserciones sí forman parte de la rama.

| Comando | Resultado / alcance |
| --- | --- |
| `npm run check` | Código 0; pruebas existentes de operativa, BI, facturas, permisos, Planner y chófer; incorpora `postgres_dates_check.cjs` |
| `npm run audit:regression` | Código 0; banco HTTP real PGlite, `passed:true`, `schemaErrors:[]`, más PDF/fiscal/cobros/importación y cola simulada |
| `npm run import:regression` | Código 0; once grupos de regresión de formatos, lotes, motor, maestros, costes, documentos e históricos |
| `npm run security:regression` | Código 0; dos empresas, claves/secretos, documentos, GPS, SSO, permisos SuperAdmin, SMTP local y webhooks |
| `node scripts/postgres_dates_check.cjs` | Código 0, tres zonas y fechas de cambio de horario |
| `node scripts/migration_history_check.cjs` | Código 0; variantes históricas preservadas y base operativa anterior a extensiones |
| `node scripts/transport_transitions_check.cjs` | Código 0; transiciones, empresa, secuencia, revisión documental, replay y rollback |
| `node scripts/audit_workflows_regression_check.cjs` con `AUDIT_PG_*` | Código 0, PostgreSQL 17.11 en loopback, base nueva sintética; runner real, repetición, concurrencia y copia/restauración |

Logs: `evolution-final-check.log`, `evolution-final-audit.log`, `evolution-import-final.log`, `evolution-security-final.log`, `evolution-native-final.log`. Resultados estructurados locales: `scripts/audit-workflows-native-results.json` y `scripts/audit-workflows-results.json`.

El modo nativo exige puerto local, archivo de contraseña de ensayo y ruta de binarios (`AUDIT_PG_PORT`, `AUDIT_PG_PASSWORD_FILE`, `AUDIT_PG_BIN`, `AUDIT_BACKUP_DIR`). El script fija `127.0.0.1` y crea nombres aleatorios nuevos: no admite una base de cliente. No copiar credenciales en el informe. Prueba `pg_dump`/`pg_restore` real, manifiesto y huellas de **184 tablas / 670 filas sintéticas**. `output/native-pg-backups/restore-verification.json` conserva la prueba de restauración. No acredita el backup de producción.

Concurrencia nativa probada: varias conexiones del pool, tres salidas simultáneas del portal/correo con un solo evento/consumo de token, y dos consumidores fiscales con una sola llamada simulada. No se ha medido failover, apagado físico, varios nodos de aplicación ni carga de un cliente real. Existe una advertencia de pg sobre consultas encoladas en el mismo cliente: no ha fallado con la versión instalada; revisar antes de migrar a pg 9.

Frontend, sin cambios React posteriores a fase 17: `CI=true npm test -- --watchAll=false --runInBand` → **60 suites / 134 pruebas**; `CI=false REACT_APP_LOCAL_SERVER=true npm run build` → código 0. Logs `phase17-release-tests.log` y `phase17-release-build.log`. Persisten avisos anteriores de ESLint/dependencias; el build con CI estricto no se presenta como limpio. El build local no debe publicarse con `REACT_APP_LOCAL_SERVER=true`.

## Revisión visual y recorrido de demostración

Solo empresa sintética, correo/proveedores externos deshabilitados:

1. Gerente: pedidos → dos servicios → preparación de grupaje → comprobar hijos, ruta y disposición independiente. Asignar el viaje sin cambiar ingresos de los hijos.
2. Chófer: jornada/conjunto → cargas y descargas por parada; revisar DeCA exacto y conservar justificantes. Explicar que una firma de conformidad local no es firma certificada.
3. Colaborador: abrir seguimiento o DCD directamente → comprobar «cargado» → revisar la versión vigente → marcar salida → «en ruta». Sin revisión, el servidor rechaza. Repetir conserva el evento original.
4. Planner/carretillero: mercancía/reserva → muelle → lectura parcial → foto/cierre → documento → salida única → POD/facturación según política.
5. Gerencia: BI Dirección/Rentabilidad → cliente/ruta → detalle y regreso; comparar margen y kilómetros del mismo grupo de servicios. Costes desconocidos siguen como cobertura parcial.
6. SuperAdmin: registro de integraciones → estado pendiente real; grupos/accesos → usuario gerente en A y contable en B → selector. Revocar B: token anterior y agregado del grupo dejan de funcionar.

BI/selector y formularios de SuperAdmin se comprobaron en fase 17 a 390/768/1440/1920, con teclado y temas conservados. En cierre se comprobó el portal de colaborador en los mismos anchos: sin desbordamiento global, PDF largo ajustado, botones de 44 px y foco visible. El navegador emulado no sustituye Safari/iPhone ni Android físico.

## Funciones deliberadamente no implementadas o no verificadas

- Replanificación versionada de envíos ya emitidos y viajes iniciados; el modelo actual los protege y no sustituye sus documentos. Materialización masiva de históricos sin identificación real de envíos tampoco se hace.
- Motor automático de slots, reposición autónoma y programación de inventario cíclico. Hay procesos manuales auditables; no se presenta el WMS como automatizado por completo. 10.5 exige completarlo progresivamente antes de automatismos avanzados.
- eCMR contractual completo/certificado, AEAT directa, proveedor de firma de pago. 5.11 exige preparar arquitectura, no declarar eCMR terminado.
- Facturas compartidas Network cuando requieren autorización/fiscalidad distinta; conversión automática de importes de proveedor no EUR; asignación universal de costes por tramo cuando faltan históricos/enlaces documentales.
- Pilotos con API real: Verifacti, GPS/mapas, inbound, push y conectores de terceros. Las pruebas con respuestas sintéticas no acreditan esos contratos.
- AAB firmado, pista interna Play, permisos reales, GPS en segundo plano, cámara y offline en dispositivo. Política legal alojada y ficha Data Safety aprobadas.
- Transición de enlaces públicos documentales anteriores; ensayo sobre copia restringida de una instalación real y rendimiento con su volumen. No se ha consultado ni utilizado esa base aquí.

Estos límites impiden declarar **todas las funciones del encargo cerradas** o **listo para producción**. No deben ocultarse tras el número de fase ni tras un build correcto.

## Despliegue y reversión — procedimiento, no ejecutado

1. Revisar esta matriz y los límites críticos con el responsable operativo. Acordar alcance del piloto, costes/proveedores y dispositivos necesarios.
2. Copia completa de base, originales y configuración cifrada; restaurar en entorno aislado y cotejar huellas/recuentos. No basta con que exista un archivo de backup.
3. Identificar servicios activos con QR legacy. Emitir/revisar originales administrativos nuevos y distribuir sus enlaces; no regenerar supuestos documentos históricos.
4. Ensayar el **migrador de esta rama**, `npm run migrate`, y repetirlo. Mantener los 61 SQL y sus checksums; no aplicar down migrations ni modificar originales para cuadrar el esquema. Publicar migraciones antes de lectores/escritores nuevos.
5. Actualizar API, web y app compatibles de forma coordinada. No mezclar nodos anteriores a membresías con nodos nuevos. Verificar un usuario ordinario, uno multiempresa, chófer y carretillero; pruebas por empresa/rol/plan y descarga privada.
6. Solo tras aprobación independiente, habilitar proveedor/piloto y colas necesarias. Registrar salud y evidencias reales del ámbito correspondiente. No activar todos los schedulers solo porque haya pasado el banco local.
7. Para reversión: detener consumidores/envíos nuevos; preservar tablas, originales y evidencias. El backend anterior a membresías requiere invalidar JWT y nuevo login. Un backend antiguo de fiscalidad no respeta `retryable`; no reactivar su cola. El código antiguo de Planner/documentos no aplica los controles de salida: revisar cargas abiertas antes de volver. Android requiere versionCode creciente incluso al volver a código anterior.

## Próxima revisión técnica concreta

- Probar un cambio concurrente de asignación junto a salida/cierre/documentación y la caída/reanudación de un worker en PostgreSQL multinodo.
- Auditar escritores legacy de costes/tramos y decidir el workflow de replanificación documentada, manteniendo originales.
- Completar el recorrido físico Android y piloto de APIs con credenciales introducidas por el responsable, sin enviarlas en informes.
- Revisar procedimientos legales/retención y QR activos antes de autorizar publicación.
- Medir consultas y carga con el volumen del cliente en copia autorizada; no extrapolar las medidas PGlite a producción.


## Publicación autorizada · 27/09/2026

El usuario solicita pruebas y despliegue de la rama acumulada. Ver `TMS_RELEASE_20260927.md` para correcciones adicionales, 62 migraciones, pruebas y copia/restauración previas. Los límites externos se conservan; el estado de publicación se registra en ese documento.
