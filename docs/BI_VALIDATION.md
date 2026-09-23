# Validación BI · fases 1 a 3

## Reproducciones en la rama base `6b9a65e`

- El test de factura de 300 € netos/363 € total marcada cobrada devolvía **121 %** en `clientes_top_facturacion` y 100 % en el KPI general. La aserción nueva falló antes del cambio y pasa con total bruto como denominador.
- El test PGlite con 1.501 pedidos devolvía **1.500** en `/rentabilidad-operativa` antes de eliminar el límite SQL. Ahora suma 1.501; el detalle puede paginarse después de calcular los agregados.
- `Informes` etiquetaba 30 días como “Este mes” y 365 como “Este año”. Los periodos de calendario ahora se resuelven en el servidor con zona Madrid; los móviles mantienen su nombre explícito.
- `gestion` y `dashboard` incluían borradores en emisión por filtrar solo `rectificada`. Los adaptadores utilizan la misma validez que BI.
- La vista de taller por vehículo y marca usaba todas las reparaciones aun con filtro de periodo; el adaptador filtra por fecha antes del desglose.
- Un vehículo sin km o un periodo sin viajes evaluables producía 0 €/km o 100 % POD. Ahora responde `null` con cobertura explícita.
- Varias llamadas atrapaban errores y devolvían listas vacías; las rutas BI propagan el error y las pantallas señalan la indisponibilidad. La caché ya no conserva respuestas de error.

## Pruebas sintéticas aisladas

| Caso | Resultado esperado | Cobertura |
| --- | --- | --- |
| Factura 1.000 netos, 1.210 total, 1.210 cobrados | 100 % | `bi_phase1_check.cjs` y regresión SQL de cliente. |
| Cobro parcial 605/1.210 | 605 de saldo y 50 % en función pura | Probado. No hay persistencia de pago parcial real en TMS. |
| 1.501 pedidos; página 1 y 2 | Ambos resúmenes incluyen los 1.501 | PGlite, agregado antes del detalle y endpoint analítico nuevo. |
| Pedido enlazado a borrador | Continúa pendiente de facturar | PGlite. |
| Sin km ni coste registrados | €/km y margen `null` | PGlite y servicio. |
| Deuda de agosto con septiembre seleccionado | Aparece en saldo al 30/09 | PGlite; estado actual, calidad `estimado`. |
| Empresa A/B | No se mezclan agregados; rol chófer rechazado | PGlite en ambos endpoints BI y comprobación de middleware. |
| Sin entregas evaluables | POD `null` | PGlite. |
| Fallo de consulta | HTTP 500 y estado `error` | PGlite con fallo sintético. |
| Taller de otro mes | Excluido | Prueba del servicio. |
| Rango de estructura de dos meses | No publica el importe de uno como total de dos | Servicio; `no_aplicable`. |
| Mes sin gasto de estructura registrado | Total y coste medio `null`, no cero confirmado | Servicio; `sin_datos`. |
| Hoja de ruta sin combustible y con km vacíos manuales | Km total 115; resultado `null` | Servicio. |
| Hoja de ruta por API | Lee vehículo de la empresa y rechaza el de otra | PGlite, 200/404. |
| Acceso a hoja de ruta | Tráfico permitido; colaborador y empresa solo Planner rechazados | Middleware de módulo y producto. |
| Adaptador `/gestion` | Mantiene 1.501 pedidos operativos y sus recuentos | PGlite. |

## Comandos y resultados

Se ejecutan desde `transgest-bloque6-backend/transgest-backend` y `transgest-bloque6-backend/transgest-frontend` del worktree. Los archivos `node_modules` son junctions locales de una instalación existente con el mismo proyecto; no se instalaron dependencias ni se usó la red. Ninguna prueba conecta a producción.

| Comando | Resultado |
| --- | --- |
| `npm run bi:regression` | Pasó: definiciones, SQL PGlite, 1.501 pedidos, cobros, aislamiento y hoja de ruta. |
| `npm run check` (backend) | Pasó: sintaxis, auditoría de tenant y regresiones de portal, geocodificación, IA, operativa, producción, Planner y chófer. |
| `npm test -- --watchAll=false --runInBand --passWithNoTests` (frontend) | Pasó: 26 suites, 70 pruebas. |
| `CI=false; GENERATE_SOURCEMAP=false; npm run build` (frontend) | Pasó. Las advertencias restantes corresponden a dependencias y archivos no modificados por esta fase (por ejemplo, `Agenda.js`, `GestionTrafico.js`, `Pedidos.js`). |

## Límites de verificación

No se consultaron datos reales de producción. La prueba de cobro parcial valida fórmula, porque la base TMS no registra movimientos parciales fechados. No se certifica caja ni resultado empresarial completo. Un saldo histórico real exige libro de pagos/eventos; los cambios de estado posteriores al corte no son reconstruibles. Nómina, gastos y km vacíos manuales requieren conciliación para un resultado completo. El build valida compilación, no la disponibilidad de todas las tablas en instalaciones con migraciones incompletas.

## Validación de fase 2 (datos sintéticos; sin producción)

`scripts/bi_phase2_check.cjs` comprueba ingreso 1.500 €, coste directo 1.250 €, 800 km cargados y 200 vacíos: 1,50 €/km de ingreso, 1,25 €/km de coste, 0,25 €/km de margen, 250 € de margen, 20 % de vacío y 16,6667 % antes del redondeo de presentación. Comprueba además:

- Dos pedidos del mismo grupaje y tractora sobre 100 km físicos se agregan como 100; con tractoras distintas, 200. El adaptador BI anterior utiliza la misma deduplicación.
- El vacío registrado por la app en pedido y tabla de km no se suma dos veces. La hoja de ruta aplica la misma regla.
- Ticket de combustible y gasto de chófer potencialmente duplicados quedan pendientes de conciliación y no incrementan de nuevo el coste directo.
- Estructura mensual de 300 € se reparte sobre el rango; sin vehículo asignado, los 300 € quedan visibles como no atribuidos. Dos meses completos devengan 600 €.
- La rentabilidad por vehículo utiliza `pedidos.vehiculo_id` histórico, aunque el vínculo actual del vehículo cambie. PGlite confirma que la hoja de ruta toma la nómina del conductor guardado en el pedido (100 €), no la del conductor actualmente vinculado (900 €).
- Factura antigua vencida se incluye en saldo al corte; borrador se excluye; abono firmado reduce saldo. La cifra sigue estimada sin libro de pagos.
- Empresa B no altera ingresos ni facturas de A. Cambiar la página del detalle no altera agregados.
- En PGlite, la ausencia de `chofer_gastos` se identifica como fuente no disponible; un error de consulta distinto sigue produciendo 500.

Pendiente de verificación con datos no productivos reales: trazabilidad de cada gasto externo frente a `coste_otros`, tramos físicos en grupajes con rutas divergentes, facturación parcial por pedido, cobros aplicados/revertidos y presupuesto original versionado. Ninguno se infiere como cero ni se presenta como exacto.

### Ejecución tras fase 2

| Comando | Resultado |
| --- | --- |
| `npm run bi:regression` | Pasó, incluidas pruebas nuevas de fase 2. |
| `npm run check` (backend) | Pasó auditoría de tenant y regresiones de portal, geo, IA, operativa, producción, Planner y chófer. |
| `npm test -- --watchAll=false --runInBand --passWithNoTests` (frontend) | Pasó: 26 suites, 70 pruebas. |
| `CI=false; GENERATE_SOURCEMAP=false; npm run build` (frontend) | Pasó con advertencias previas de dependencias/ESLint en archivos ajenos a fase 2. |

El primer intento de `bi:regression` falló por una variable `clients` duplicada al integrar el adaptador; se corrigió antes de la ejecución final. No quedan pruebas fallidas conocidas.

## Validación de fase 3 · Dirección y Rentabilidad

La ruta `/informes/bi/workspace` se probó con PGlite y datos sintéticos: 1.501 pedidos entran en el agregado y 20 en la primera página; cambiar página no modifica el total. La empresa B no aparece en el agregado de A. Una selección de ruta impide atribuirle el vencido fiscal, pero mantiene el pendiente de facturar de los servicios de esa ruta. La comparación sin base anterior positiva es `null`. Los filtros de cliente, ruta, vehículo y ejecución se combinan. La cascada con ingreso 1.500 € y coste directo 1.250 € termina en 250 €, con tramo de coste flotante desde 250 €; un día sin ingreso conocido no crea un cero ficticio. El detalle de vencidos conserva el signo de un abono y pagina por separado.

La vista React se compiló con las métricas de servidor, filtros globales, pestañas navegables con flechas, tarjetas con definición, tablas accesibles de gráficos, ampliación que cierra con Escape, búsqueda local identificada y enlaces operativos. La prueba de estado verificó cliente → ruta → pedido → retorno por `sessionStorage`: filtros y paginación persisten en el ámbito de empresa/usuario/rol/plan; la respuesta financiera no se guarda ahí. Las peticiones se abortan al cambiar filtros. La ruta HTTP conserva `authenticate`, permiso `informes`, rol gerente/contable, plan `kpis_avanzados` y `empresa_id` del usuario.

Se hizo una revisión visual en navegador local con una respuesta **sintética y rotulada**; no se consultó producción ni se añadió fixture al producto. A 390, 768, 1440 y 1920 px no hubo desbordamiento de página tras acortar las etiquetas del eje de la cascada (anchos de documento 382/759/1431/1911 px respectivamente). Las tablas se desplazan dentro de su contenedor. Se verificaron con teclado las pestañas y el cierre del gráfico ampliado; los gráficos tienen tabla de datos. Se observaron estados de carga y error de red con botón de reintento, una cobertura `parcial` y la ausencia de valores calculables. Los archivos de captura de Dirección y Rentabilidad están fuera del repositorio, en el directorio local de visualizaciones de esta tarea.

Límites: la prueba de navegador empleó un adaptador temporal de datos sintéticos; no certifica la navegación operativa completa al abrir un pedido o factura en una instalación con sesión real. Ese enlace usa los mismos `runtimeFocus` y evento de navegación ya utilizados por otras vistas; se revisó el contrato, pero falta una prueba integrada con una base de ensayo y autenticación real. Tampoco acredita exactitud de costes o cobros en producción: combustible, gastos del chófer y otros importes siguen pendientes de conciliación, y no hay libro de pagos parciales con fecha. Para volúmenes mucho mayores que los ensayos, conviene medir memoria y latencia del agregado de empresa completa antes de ampliar el BI.

### Ejecución final de fase 3

| Comando | Resultado |
| --- | --- |
| `npm run bi:regression` (backend) | Pasó: definición, 1.501 pedidos, filtros, comparativo, cascada, abono firmado, paginación y aislamiento. |
| `npm run check` (backend) | Pasó la suite completa tras el último ajuste de detalle de vencidos: auditoría de tenant, BI, portal, geo, IA, operativa, producción, Planner y chófer. |
| `CI=true; npm test -- --watchAll=false --runInBand --passWithNoTests` (frontend) | 27 suites y 72 pruebas, todas pasaron. |
| `CI=false; GENERATE_SOURCEMAP=false; npm run build` (frontend) | Compiló tras retirar el adaptador temporal de capturas y utilizar el diálogo accesible compartido. Quedan advertencias previas de dependencia dinámica y ESLint en archivos ajenos a la vista BI nueva. |

No se publicaron cambios ni se ejecutaron migraciones durante la fase 3; sus resultados se conservan en la fase 4.

## Validación de fase 4 · operaciones, flota, calidad y sostenibilidad

`scripts/bi_phase4_check.cjs` usa datos sintéticos explícitos y PGlite. Comprueba que una recogida a las 08:30 de Madrid en ventana 08:00–09:00 y una entrega en ventana producen puntualidad evaluable; si la llegada ocurre fuera de ventana, entrega y OTIF son 0 % **con denominador real**. Con un pedido entregado sin marcas, ambos son `null` y no 100 %. La descarga OTIF exige además cantidades de bultos y peso planificadas y confirmadas. Las marcas llegada→inicio→fin dan 30 minutos de espera y 60 de manipulación en el caso de prueba; media, mediana y p90 se calculan sobre eventos válidos. Una firma y un POD una hora después producen recepción de 60 minutos; sin firma no se publica un cero de POD pendiente.

La misma prueba verifica que 100 litros **repostados** no se convierten en consumo l/100 km, aunque sí se muestre el volumen registrado; el coste por km propio usa importes valorados y km físicos completos. Con filtro de cliente/ruta, el coste de todo el vehículo no se atribuye a la selección. Dos pedidos en el mismo grupaje de 120 km físicos generan una única estimación de emisiones, repartida entre ambos; distancias divergentes impiden publicar esa estimación. El aislamiento se prueba en memoria y con dos empresas en SQL PGlite: pasos, documentos y reservas Planner de B no aparecen al consultar A. Una reserva Planner de una hora genera 60 minutos programados y una preparación de 40 minutos da mediana de carga 40; no se interpreta como espera ni permanencia.

La interfaz mantiene los filtros de fase 3; las tres nuevas pestañas consultan `operations` en el mismo endpoint, ofrecen definición/cobertura, tablas accesibles de gráficos, ampliación y detalle paginado con enlace al pedido. Flota expone además filas de repostajes y mantenimiento; bajo filtros que impedirían atribuir esos costes, no publica ni el ratio ni esas filas. El test de estado verifica que la vista y el cliente persisten juntos y que Dirección no solicita la ampliación operacional. Se conservan Dirección y Rentabilidad. No hay migraciones ni cambios de producción.

| Comando final de fase 4 | Resultado |
| --- | --- |
| `npm run bi:regression` (backend) | Pasó fases 1, 2 y 4, incluidas ventanas, OTIF, tiempos, repostajes, grupaje y aislamiento SQL. |
| `npm run check` (backend) | Pasó auditoría tenant y regresiones completas de portal, geo, IA, operativa, producción, Planner y chófer. |
| `CI=true; npm test -- --watchAll=false --runInBand --passWithNoTests` (frontend) | 27 suites y 73 pruebas, todas pasaron. |
| `CI=false; GENERATE_SOURCEMAP=false; npm run build` (frontend) | Pasó tras el ajuste final. Quedan advertencias preexistentes de dependencia dinámica y ESLint en otras vistas. |

Limitaciones: no se ensayó una sesión autenticada de la fase 4 en navegador ni se consultaron datos reales. El build y las pruebas sintéticas no demuestran cuántos clientes tienen hoy eventos operativos completos. Faltan eventos enlazados de resolución de incidencia, contabilización/cobro de cada paralización, aforos de depósito, intervalos de disponibilidad y capacidad homogénea por tramo; las métricas correspondientes siguen no calculables. La sección de citas Planner está separada y protegida por producto; no acredita ocupación física ni tiempo de espera. Las emisiones usan factores configurables u orientativos identificados y no son certificación.

## Validación de fase 5 · centro de informes

`scripts/bi_phase5_check.cjs` crea **datos sintéticos identificados**, nunca datos de producción. Comprueba las seis plantillas del catálogo, rechaza métricas libres y la plantilla de calidad sin cliente, y verifica que el informe de calidad no serializa costes ni márgenes. El detalle completo se genera desde la misma ejecución que los KPI; la regresión de fase 1 prueba 1.501 pedidos en `readWorkspace(..., exportAll)` y que ese agregado coincide con la página visible. La ruta `/informes/bi/reportes` hereda permiso de Informes, rol gerente/contable y capacidad `kpis_avanzados` del servidor. Con PGlite se verifica aislamiento de vistas/clientes por empresa, y que una descarga solo es accesible por empresa y usuario dueño antes de expirar; después devuelve 404.

Se generaron cuatro PDFs bajo `output/pdf/`: **corto**, **largo** (85 filas), **sin datos** y **parcial**. Se inspeccionaron con PDFKit/pdf-parse y Poppler: encabezado por página, pie con numeración, cabecera de tabla repetida, última fila presente, avisos de cobertura y gráficos vectoriales enteros. La revisión visual detectó y corrigió una fuente estándar que dañaba tildes/ñ/€, un pie que creaba páginas extra y luego se solapaba, y un encabezado de sección huérfano. La versión final incorpora Liberation Sans embebida con su licencia OFL; el PDF largo tiene seis páginas legibles. El logo PNG/JPEG guardado por empresa se incorpora cuando está disponible; un logo WebP no se incrusta sin conversión.

`output/reports/bi-fase5-sintetico.xlsx` y `.csv` proceden del **mismo snapshot** del ejemplo corto. Se validó el ZIP OOXML con `zipfile` y XML: ninguna entrada dañada, cinco fechas tipadas y los importes negativos `-50`/`-110` como celdas numéricas. El CSV UTF-8 conserva importes negativos y antepone apóstrofo a texto `=HYPERLINK(...)`; su cabecera comentada declara periodo, corte, filtros, contrato, KPI y advertencias. El ensayo de 85 filas verifica que PDF, CSV y XLSX contienen el último pedido, aunque el ejemplo persistido de XLSX/CSV sea el corto. Ni el PDF ni las hojas contienen una fórmula ejecutable de datos externos.

| Comando final | Resultado |
| --- | --- |
| `npm run bi:regression` | Pasó fases 1, 2, 4 y 5; incluye sintaxis de los nuevos servicios/rutas, 1.501 pedidos, seis plantillas, formatos y aislamiento. |
| `npm run check` (backend) | Pasó auditoría de tenant y regresiones completas de portal, geo, IA, operativa, producción, Planner y chófer. |
| `CI=true; npm test -- --watch=false --runInBand` (frontend) | 28 suites y 75 pruebas, todas pasaron. Incluyen copia personal de vista compartida y cambio de filtros entre ejecuciones. |
| `CI=false; GENERATE_SOURCEMAP=false; npm run build` (frontend) | Compiló. Persisten advertencias ajenas al centro de informes de dependencias/ESLint. |

Una prueba de interfaz encontró que el centro intentaba leer las opciones de cliente antes de recibir el catálogo; se corrigió y ambas pruebas nuevas pasaron. La migración aditiva se ejecutó **solo** en PGlite; no en una base de cliente. No se ensayó una sesión real autenticada ni el comportamiento con un volumen productivo muy grande. La lectura transaccional usa `REPEATABLE READ READ ONLY`; se rechaza explícitamente un snapshot o archivo superior a 50 MB sin truncar. El saldo histórico, cobros parciales y costes externos conservan los límites de cobertura documentados en fases anteriores. No se implementaron envíos programados, links anónimos ni fase 6.

## Validación de fase 6 · auditoría integral

La batería `bi_phase6_check.cjs` confronta un mismo snapshot sintético entre KPI, gráfico, tabla y detalle exportado a PDF, XLSX y CSV. Cubre factura neta de 1.000 €, total con IVA de 1.210 € y cobro teórico de 1.210 € (100 %); cobro parcial de 605 € (50 % y saldo 605 €); factura borrador, anulada, rectificativa y abono firmado; operación cancelada o futura; deuda previa al periodo y pago posterior al corte como límite de la fuente actual. Verifica ratios con sumas de numeradores y denominadores, costes sin doble imputación, grupaje sin multiplicación de kilómetros físicos, asignación histórica de vehículo y `null` cuando faltan kilómetros o costes evaluables. Lo que depende de un libro de cobros con fecha o de importes facturados por pedido permanece explícitamente sin verificar en datos reales.

La prueba de PGlite carga 1.501 servicios: 16 consultas y entre 4.426 y 7.261 ms en dos ejecuciones de esta máquina (la segunda concurrente con el build), con primera página de 20 filas y 18.145 bytes de respuesta; la vista previa de informes entrega 25 filas por página mientras PDF/XLSX/CSV conservan el snapshot completo. Estas medidas son locales y no constituyen un objetivo de rendimiento de producción. La fecha de firma `TIMESTAMPTZ` se clasifica en `Europe/Madrid`; los casos cerca de medianoche y de los cambios de horario de marzo y octubre pasan. La semana anterior usa lunes–domingo civiles completos.

En navegador local, con datos **sintéticos rotulados** y sin sesión productiva, se observó el centro de informes a 390, 768, 1440 y 1920 px. Las anchuras del documento no excedieron las del viewport (382/759/1431/1911 px respectivamente); la tabla queda en su propio contenedor desplazable. Se detectó fondo blanco con texto claro en modo oscuro porque el centro usaba `--surface`, variable no definida por el tema de TransGest. Se sustituyó por `--card-bg`/`--bg2`, y los textos secundarios y avisos utilizan la paleta existente. La inspección a 390 px confirmó tarjetas oscuras y texto claro legible. No se validó una sesión real ni todos los estados visuales con datos de una instalación no productiva.

La petición de informe de los lunes se cubre por la alternativa autorizada **a demanda dentro del programa**. La prueba React comprueba el acceso para gerencia, la selección de `semana_anterior`, la vista y la exportación PDF. No existe tarea programada ni correo automático. El informe se denomina margen directo y señala costes pendientes, sin etiquetarlo como beneficio neto.

## Continuación · envío automático semanal (23/09/2026)

El usuario autorizó una comprobación de acceso de **solo lectura** con la cuenta de Asensi. La sesión abrió TransGest como MANUEL BERRUECO (rol Gerente, activo), empresa TRANSPORTES ASENSI, S.L.U. En Usuarios se observó además una segunda cuenta Gerente activa; por eso el envío no elige un email por inferencia. El campo general «Email empresa» estaba vacío. La versión de producción consultada aún no incluye el centro BI de esta rama, por lo que no era posible ejecutar allí el informe nuevo ni comprobar un correo real. No se crearon ni modificaron pedidos, suscripciones, facturas o configuración productiva.

`bi_weekly_check.cjs` usa PGlite y direcciones `.test` sintéticas. Verifica selección opt-in, rechazo de roles distintos de Gerente y destinatarios de otra empresa, separación de historial A/B, plan y producto, lunes 09:00 de Madrid, semana civil anterior y cambio a horario de invierno, PDF adjunto, no duplicación por segundo tick, SMTP simulado, error antes del envío y timeout ambiguo tras entregarlo al SMTP. La plantilla HTML escapa el nombre de empresa y declara que el margen directo no es beneficio neto. `ReportCenter.test.js` comprueba selección y guardado de destinatarios y que Contabilidad no ve la configuración. El transporte SMTP real queda pendiente de integración tras despliegue; la prueba local sustituye el remitente por un stub y no envía mensajes.

El envío queda inactivo hasta que un Gerente seleccione destinatarios en el Centro de informes. Si no hay SMTP disponible, aparece `sin_smtp` y no se afirma que el email se haya entregado. Si el resultado es incierto, aparece `por_verificar` y no se repite automáticamente. La ejecución a demanda permanece disponible incluso si falla la programación. No se puede acreditar con esta prueba que el correo de Asensi esté configurado ni que la entrega a su buzón vaya a producirse.

Validación posterior de la programación: `node scripts/bi_weekly_check.cjs` pasó; `npm run bi:regression` pasó con las fases 1, 2, 4, 5, 6 y el envío semanal; `npm run check` del backend terminó con código 0 y cubrió portal, geo, IA, operativa, Planner y chófer; `npm run check` del frontend terminó con código 0; `CI=true npm test -- --watch=false --runInBand` pasó 28 suites y 79 pruebas; `npm run build` compiló después de corregir un aviso ESLint introducido por esta vista. Quedan avisos previos en Agenda, Gestión de Tráfico, Mi Cuenta, Pedidos, Taller, Vehículos y `ui/index.js`, además de la dependencia dinámica del empaquetador. La prueba SMTP fue simulada; no hay confirmación de entrega real de correo.

## Preparación de despliegue · migraciones BI al arranque (23/09/2026)

El inicio de Render ejecuta `src/server.js`, no `npm run migrate`. Se añadió `biSchema.ensureSchema()` al arranque para aplicar únicamente las dos migraciones BI aditivas pendientes, registrar su checksum en `schema_migrations` y rechazar una versión SQL distinta de la ya aplicada. Un fallo deja `/health` en estado `degraded`/503 y registra el error, en vez de indicar que el esquema está listo. La prueba semanal usa ahora ambas migraciones reales en PGlite, llama dos veces a `ensureSchema()` y verifica que quedan dos registros, sin aplicar dos veces los cambios. `node scripts/bi_weekly_check.cjs`, `npm run bi:regression` y `npm run check` backend terminaron con código 0. No equivale a una prueba de migración en la base productiva ni acredita una copia de seguridad/restauración.
