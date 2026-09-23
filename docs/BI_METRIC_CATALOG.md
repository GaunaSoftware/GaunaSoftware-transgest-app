# Catálogo de métricas BI · fases 1 y 2

Las cifras se filtran por `empresa_id` en SQL y por la empresa autenticada en el servidor. Acceso: `/informes` exige sesión, permiso del módulo, plan con `kpis_avanzados` y gerente/contable; algunos desgloses de chófer exigen gerente. La hoja de ruta tiene además `/hojas-ruta/bi`, protegido por el permiso y plan existentes de `hojas_ruta` para conservar el acceso de tráfico. `DashboardBI` conserva su acceso existente y llama al mismo servidor. Salvo indicación contraria, el corte es el final inclusivo del periodo, con fechas civiles `Europe/Madrid`.

| Indicador | Fórmula y denominador | Fuente y fecha | Unidad e impuestos | Estados/costes; cobertura |
| --- | --- | --- | --- | --- |
| Pedidos / realizados / activos / cancelados | Recuento de pedidos de empresa; realizado = entregado o facturado | `pedidos`, `fecha_bi` | pedidos; sin impuestos | El recuento cero es válido si la consulta se completó. |
| Ingreso previsto de servicios | Suma `importe` no cancelado; no es facturación | `pedidos`, `fecha_bi` | EUR netos | Incluye pedidos aún no realizados; el precio ausente requiere aviso de cobertura. |
| Ingreso de servicios realizados | Suma `importe` entregado/facturado | `pedidos`, `fecha_bi` | EUR netos | No fuerza igualdad con facturación: las fechas y conceptos difieren. |
| Pendiente de facturar realizado | Suma importe realizado sin factura válida enlazada; se consulta enlace directo y `factura_pedidos` | `pedidos` + `facturas`, `fecha_bi`, validez al corte | EUR netos | Borrador/cancelada/anulada no consume el pendiente. |
| Facturación emitida | Suma `base_imponible` de facturas válidas | `facturas.fecha` | EUR netos; total bruto separado | Excluye borrador, cancelada, anulada. Una rectificativa tiene su importe firmado. |
| Facturación total | Suma `total` de facturas válidas | `facturas.fecha` | EUR con impuestos | Mismo conjunto de facturas que base. |
| Ingreso gestionado | Base emitida + servicios realizados pendientes de facturar | Ambas fuentes y sus fechas | EUR netos | Indicador de gestión, no asiento contable ni caja. |
| Cobrado según estado | Suma `total` de facturas del periodo con `estado=cobrada`; % = cobrado / total bruto emitido | `facturas.fecha` y estado actual | EUR brutos / % | **Estimado**: no hay fecha ni pagos parciales en el TMS. Denominador cero => `null`. |
| Cobro efectivo | Cobros bancarios conciliados, fechados | No existe fuente TMS integrada | EUR brutos | `null` / `sin_datos`; no se infiere de una factura marcada cobrada. |
| Saldo al corte | Suma total bruto de facturas válidas con `fecha<=corte` actualmente no cobradas | `facturas`, fecha y estado actual | EUR brutos | **Estimado**; incluye deuda anterior al inicio del periodo. El saldo de una fecha histórica no puede reconstruirse sin eventos de pago. |
| Vencido | Pendiente actual con vencimiento anterior al corte | `facturas.fecha_vencimiento`, estado | EUR brutos | Estimación según estado/corte; deuda parcialmente pagada no conocida. |
| Margen directo | Venta neta realizada − costes directos registrados (colaborador, combustible, peajes, dietas, otros, extras) | `pedidos`, costes y `fecha_bi` | EUR netos / % de venta | `null` sin coste evaluable; con cobertura incompleta: `parcial`. No incluye flota ni estructura. |
| Resultado tras flota/estructura | Margen directo − costes de flota y estructura conciliados | Falta reconciliación por pedido/vehículo/mes | EUR | `null`; la imputación de estructura y la hoja de ruta son estimaciones separadas. |
| Ticket medio de servicio | Ingreso neto realizado / número de realizados | `pedidos`, `fecha_bi` | EUR netos/pedido | Denominador cero => `null`. |
| Ingreso por km total | Ingreso neto realizado / (km cargados + vacíos) de esos viajes | `pedidos.km_ruta`, `km_vacio`, `fecha_bi` | EUR/km total | `null` si km ausente o no válido en algún viaje. |
| Ingreso por km cargado | Ingreso neto / km cargados, mostrado solo donde se etiqueta así | `pedidos.km_ruta` | EUR/km cargado | No se equipara al km total. |
| % km vacío | km vacíos / (cargados + vacíos) | `pedidos`, periodo de servicio | % | Sin km válido => `null`. Km vacíos manuales se muestran aparte por vehículo. |
| POD disponible | Realizados con albarán/POD/CMR / realizados | `pedido_docs`, `pedidos.fecha_bi` | % | Sin realizados evaluables => `null`, nunca 100 %. |
| Rutas / clientes / chóferes / flota | Agregaciones por ruta, `cliente_id`, chófer o tractora de importes netos realizados | `pedidos` y relaciones por empresa | EUR netos, recuentos, km | Las rutas se ordenan por ingreso total y muestran también ingreso medio; ninguno equivale a rentabilidad. La factura no se atribuye a vehículo por una columna inexistente. |
| Taller | Suma intervenciones/coste con fecha dentro del periodo | `taller_estado.data.reparaciones.fecha` | intervenciones, EUR | Sin fecha no se asigna a un periodo. |
| Estructura imputada | Importe recurrente anual/12, trimestral/3, mensual o único en su mes | `gastos_estructura.fecha`, periodicidad | EUR estimados/mes | Distribución por ingreso neto de servicios; no es gasto contable devengado confirmado. En un rango de varios meses se indica `no_aplicable` hasta hacer desglose mensual. |
| Hoja de ruta | Servicios realizados del vehículo menos repostajes, dietas, taller y coste de conductor disponibles | Pedidos, km vacíos manuales y tablas de vehículo/chófer; periodo elegido | EUR netos estimados | Gasto de base sin importe, ausencia de combustible registrado con viajes o nómina sin configuración => `null`; rangos de varios meses necesitan desglose mensual. |
| Objetivos | Valor observado de la métrica anterior / objetivo configurado | Métrica BI + `objetivos_kpi` | % de objetivo | Sin valor observado u objetivo positivo => no aplicable. |

Estados de calidad de respuesta: `completo`, `parcial`, `estimado`, `sin_datos`, `no_aplicable`, `error`. La respuesta incluye definición, unidad, impuestos, denominador cuando corresponde, cobertura evaluable/total, periodo, fecha de corte y zona horaria. Los indicadores heredados se conservan como adaptadores mientras migra cada consumidor; prevalece el campo de metadatos para interpretar valores `null`.

## Inventario de indicadores operativos relacionados

| Vista / indicadores | Fuente y definición actual | Fecha, unidad y alcance | Tratamiento en fase 1 |
| --- | --- | --- | --- |
| Dashboard: cargas del día, tránsito, pendientes de asignar, entregados e incidencias | Pedidos y excepciones operativas; recuentos por estado o fecha prevista | Día operativo; pedidos de la empresa; permisos de Dashboard | Se conservan como operativa, separados de servicios realizados y facturación. |
| Informes: cancelaciones, pedidos sin precio, sin km y sin recurso | `pedidos`/`pedidos_bi`, recuentos por estado y campos faltantes | Periodo de fecha económica; pedidos; `/informes` | Se mantienen los recuentos; tasas sin denominador evaluable son `null`. |
| Informes: POD, documentación y portal | `pedido_docs`, solicitudes del portal y pedidos realizados | Periodo de pedido/documento; documentos, pedidos, %; `/informes` | POD sin realizados evaluables es `null`; fallo de consulta no se convierte en ausencia de actividad. |
| Informes: puntuación, datos maestros, cumplimiento, emisiones y cargas de retorno | Endpoints especializados existentes (`scoring-operativo`, `datos-maestros`, `cumplimiento-europeo`, `emisiones-operativas`, `cargas-retorno`) | Ventanas y unidades propias de cada módulo; permisos de su ruta | No se han cambiado sus modelos de negocio. No deben sumarse a ingresos o márgenes BI. |
| Explotación: visitas y coste de taller por vehículo/marca | Reparaciones en `taller_estado`, agrupadas tras filtrar fecha | Periodo elegido; visitas y EUR; empresa y permiso de Informes | El filtro se aplica antes de cada desglose. |
| Hojas de ruta: litros, noches, km vacíos y eventos del conductor | Repostajes, noches, `vehiculo_km_vacio`, gastos del chófer y pedidos | Periodo elegido; litros, noches, km, EUR; permiso `hojas_ruta` | Los agregados financieros usan el servidor; los formularios conservan sus totales de edición. |
| Objetivos: progreso de facturación, cobro, viajes, km y margen | Objetivo guardado frente a la métrica BI equivalente | Mes, trimestre o año natural; %; permiso de Objetivos | El progreso visual se oculta si falta observado u objetivo válido. Cobro significa estado de factura, no caja confirmada. |

Las métricas regulatorias, comerciales y de riesgo no se reclasifican como KPI financieros por el hecho de aparecer en la misma pantalla. Sus reglas específicas quedan en sus servicios existentes y fuera de esta fase de cálculo financiero.

## Matriz de fuentes y reglas · fase 2

El objeto `economia` de `/informes/bi/analitica` es el contrato v2 añadido sin eliminar el v1. Se calcula en el servidor para la empresa autenticada. La presencia de una columna no acredita que se haya rellenado: la cobertura cuenta filas evaluables. `null` indica no calculable; los costes registrados sin prueba de exhaustividad se etiquetan `parcial`.

| KPI | Tabla/campo real | Regla de cálculo | Limitaciones y calidad |
| --- | --- | --- | --- |
| Ingreso neto realizado | `pedidos.importe`, `estado`, fecha económica del CTE | Suma de entregados/facturados del rango, sin IVA | Precio ausente reduce cobertura; difiere de emisión. |
| Coste directo y margen | `pedidos.precio_colaborador`, `coste_gasoil`, `coste_peajes`, `coste_dietas`, `coste_otros`; `pedido_extracostes.importe` | CTE suma cada pedido una vez; margen = ingreso − coste registrado; % = suma margen / suma ingreso | Costes no registrados no son cero confirmado. Gastos sin enlace quedan sin conciliar. |
| Resultado tras flota y estructura | Coste directo anterior; `taller_estado.data.reparaciones.coste_total`; `nominas_emitidas.salario_base`,`ss_empresa`; `gastos_estructura.importe`,`periodo`,`fecha` | Margen directo − taller no solapado − salario base/SS registrados − estructura devengada | Parcial; no se declara beneficio neto. `coste_otros` positivo impide sumar taller por posible solape. Nómina sin ambos campos queda parcial. |
| Km físicos, vacío y €/km | `pedidos.km_ruta`,`km_vacio`,`grupaje_id`,`vehiculo_id`; `vehiculo_km_vacio.km_vacio`,`notas` | Máximo por grupo+tractora, suma entre grupos, más vacíos manuales no duplicados; ratios de sumas | Sin km de un servicio, €/km no calculable. Tramos distintos dentro del mismo grupaje requieren fuente de trayecto físico; discrepancia marcada. |
| Rentabilidad por cliente, ruta, vehículo y ejecución | `pedidos.cliente_id`,`origen`,`destino`,`vehiculo_id`,`colaborador_id`, importes y costes | Agrupa pedidos realizados guardando asignación histórica; margen de cada grupo = suma ingreso − suma coste directo | Paginación solo del detalle. Km por dimensión pueden solaparse entre clientes en un grupaje; no sumar desgloses. |
| Margen subcontratado | `pedidos.colaborador_id`,`colaborador_nombre`,`precio_colaborador`,`importe` | Ingreso neto menos precio del colaborador registrado | Sin precio, `null`; no incluye peajes u otros costes del pedido y se presenta como contribución parcial. |
| Realizado pendiente de facturar y antigüedad | CTE `pendiente_factura`, `pedidos.importe`, fecha económica; `facturas`, `factura_pedidos` | Pedidos entregados sin factura válida al corte; bandas 0–30, 31–60, 61–90, >90 días | Enlace factura-pedido no lleva importe; una factura parcial no permite calcular remanente exacto. Borradores no consumen pendiente. |
| Facturación neta/bruta, abonos | `facturas.base_imponible`,`total`,`fecha`,`estado` | Suma de cabeceras válidas del periodo con signo propio; no se multiplican por líneas | El signo de abono es el guardado; no se aplica IVA fijo. |
| Cobro efectivo | No hay libro TMS de pagos aplicados, reversos y fecha | `null` | Estado `cobrada` no acredita caja ni fecha. Se necesita pago con empresa, factura, importe, fecha y reversión. |
| Saldo/vencido al corte y antigüedad por cliente | `facturas.total`,`fecha`,`fecha_vencimiento`,`estado`,`cliente_id`; `clientes.nombre` | Cabeceras válidas emitidas hasta el corte y hoy no marcadas cobradas; vencido cuando vencimiento < corte, por cliente y edad | Estimado: no reconstruye pagos parciales ni saldo histórico real; abono firmado se incluye. |
| Concentración principal/top 5 | Ingreso neto realizado agrupado por `pedidos.cliente_id` | Suma del principal o cinco mayores / suma ingresos realizados | Sin ingresos positivos, `null`; ingresos de clientes distintos de la empresa se excluyen. |
| Pendientes de valorar / cobertura | Campos de coste de pedido, `vehiculo_repostajes.importe`,`litros`,`precio_litro`; `chofer_gastos.importe`,`estado`; `vehiculo_noches.importe` | Cuenta servicios sin coste registrado y gastos externos sin importe | Tickets importados o duplicados no se suman al pedido sin una conciliación por identidad/documento. |
| Desviación presupuestaria | `objetivos_kpi` guarda metas actuales, no presupuesto original inmutable por periodo comparable | `null` / `no_aplicable` | Se requiere presupuesto versionado, aprobado y conservado con perímetro y fecha. |

Fuentes adicionales localizadas: `factura_lineas` contiene conceptos pero no importe por pedido; puntos de carga/descarga describen paradas pero no constituyen por sí solos un libro de kilómetros físicos; `chofer_vehiculo_historial` existe, pero la asignación económica se toma del pedido para no reescribir viajes pasados. `nominas_emitidas.total_empresa` puede incluir conceptos ya reflejados en dietas y por eso no se suma sin desglose. El dato de cobros del módulo contable separado no está conciliado transaccionalmente con facturas TMS.

## Contrato visual de fase 3

`GET /informes/bi/workspace` devuelve `metadata.periodo`, `metadata.comparacion`, `metadata.actualizado_en`, `filtros`, `economia.metricas`, `evolucion`, `cascada`, `rankings`, `matriz`, `servicios`, `facturas_vencidas`, `revision` y, si existe, `objetivo`. El cálculo económico procede de `financialEconomics`; la capa de workspace únicamente filtra, forma series, desgloses, comparativos y enlaces al detalle. La ruta conserva autorización por empresa, rol, módulo y plan.

| Elemento visual | Métrica y unidad | Regla y limitación visible |
| --- | --- | --- |
| Dirección: ingreso de servicios | `ingreso_realizado`, EUR netos | Pedido realizado por fecha económica; independiente de factura emitida. |
| Dirección: margen | `margen_directo`, EUR netos | Solo costes directos registrados; no equivale a beneficio neto. |
| Dirección: ingreso/km y vacío | `ingreso_km_total` EUR/km total; `km_vacios_pct` % | Km físicos deduplicados; falta de cobertura => no calculable. |
| Dirección: pendiente de facturar | `pendiente_facturar`, EUR netos | Pedido realizado sin factura válida vinculada; la facturación parcial no se cuantifica por pedido. |
| Dirección: vencido al corte | `vencido_al_corte`, EUR con impuestos | Estado actual de factura, saldo histórico solo estimado; abonos firmados conservan signo. Sin atribución a ruta/vehículo/ejecución. |
| Rentabilidad: coste y margen | `coste_directo`, `margen_directo`, `margen_km_total` | Sumas de componentes registrados, cobertura visible. |
| Rentabilidad: cascada | Ingreso realizado → costes directos → categorías de taller, nómina y estructura incluidas → resultado parcial | Cada tramo usa importe firmado y la tabla muestra acumulado; categorías sin conciliación no se descuentan. |
| Rankings y matriz | Ingreso, coste, margen, km y vacío por cliente/ruta/vehículo/ejecución | Orden del ranking por margen registrado, no por ventas; kilómetros de grupaje entre dimensiones no son aditivos. |
| Comparación | Variación de ingreso y margen vs. periodo anterior de igual duración | Sin base anterior positiva la variación es `null`, no 0 % ni infinito. |
| Objetivo | Facturación emitida vs. `objetivos_kpi.facturacion` | Se muestra separado del ingreso realizado en vistas de mes/año calendario sin filtro de dimensión; la meta corresponde al periodo completo aunque el corte sea anterior. |

Los metadatos de cada KPI en el workspace incluyen numerador, denominador, fecha de corte, impuestos, costes incluidos, definición y cobertura. Los estados `completo`, `parcial`, `estimado`, `sin_datos` y `no_aplicable` acompañan al valor; un error de consulta produce estado de pantalla `error` con opción de reintento.

## Matriz de indicadores · fase 4

La cohorte son pedidos de transporte de la empresa seleccionada por `fecha_bi`, periodo y filtros globales; se excluyen cancelados y `origen_producto=planner`. Una fila de pedido puede tener varias paradas; la población elegible se declara por KPI y **no se sustituye un evento real por una fecha prevista**. La vista `operations` de `/informes/bi/workspace` se activa solo en las tres pestañas nuevas. Los detalles se paginan tras calcular los agregados. Estado `calculable` significa que existen filas evaluables; en una empresa concreta puede responder `sin_datos` si faltan marcas.

| KPI | Fuente y evento medido | Población elegible y denominador | Clase / cobertura y límites |
| --- | --- | --- | --- |
| Puntualidad de recogida | `pedido_chofer_pasos.data.paradas[*].carga_iniciada_at` (posicionado) frente a `puntos_carga.ventana` o `pedidos.ventana_carga` y fecha prevista | Paradas de carga de la cohorte con ventana `HH:mm-HH:mm` y llegada real | **Parcial**. Ventana ausente, no interpretable o llegada ausente reduce cobertura; no implica 0 % ni 100 %. |
| Puntualidad de entrega | `posicionado_descarga_at` frente a ventana y fecha pactadas de descarga | Paradas de descarga con ventana y llegada real | **Parcial**. `entregado` por sí solo no da puntualidad. |
| OTIF | Parada de descarga firmada, llegada en ventana y `mercancia_confirmada` con `mercancia_palets`/`mercancia_peso_kg` comparables a plan | Descargas con firma, ventana, llegada y cantidades planificadas y reales | **Parcial**. Si solo hay total de pedido y varias descargas, no se atribuye a cada parada. |
| Espera carga/descarga | Llegada a inicio (`carga_proceso_at` / `descarga_iniciada_at`) | Paradas con ambas marcas | **Parcial**. Media, mediana y p90; sin marcas, `null`. |
| Duración efectiva carga/descarga | Inicio a fin (`carga_ok_at` / `descarga_ok_at`) | Paradas con ambas marcas | **Parcial**. No incluye espera; duración negativa o superior a siete días no evaluable. |
| Incidencias por servicio | `pedidos.incidencia_creada_at` o estado `incidencia` | Pedidos no cancelados de la cohorte | **Parcial**: muestra pedido afectado, no número de episodios históricos. |
| Tiempo de resolución de incidencia | Falta par apertura–cierre enlazado y fiable | Incidencias con ambos eventos | **Requiere capturar datos**. No se deduce de un cambio posterior de estado. |
| POD/documentación pendiente | `pedido_docs.tipo/nombre/created_at`; firma de entrega real de `pedido_chofer_pasos` | Entregas firmadas; pendiente si no consta soporte de entrega | **Parcial**. Carga y documento genérico previo a entrega no acreditan POD. Tabla ausente => `null`, no cero. |
| Tiempo de recepción POD | Firma final a primer soporte de entrega | Entregas firmadas con documento posterior fechado | **Parcial**. Media, mediana, p90. |
| Recuperación de paralización | `pedidos.paralizacion_importe` existe, pero no hay conciliación de documento facturable, línea emitida y pago aplicado | Paralizaciones documentadas con enlaces monetarios | **Requiere capturar/conectar datos**. Facturado y cobrado no se estiman. |
| Calidad de colaboradores | Pasos de colaborador existen, pero faltan SLA homologado, muestra suficiente y resultado histórico completo | Servicios subcontratados con criterios comparables | **Requiere capturar/conectar datos**; no se publica nota universal. |
| Km totales, cargados y vacíos | `pedidos.km_ruta/km_vacio/grupaje_id/vehiculo_id` y `vehiculo_km_vacio` | Servicios realizados con distancia válida; tramo físico deduplicado | **Parcial**. Manual no enlazado no se atribuye a cliente/ruta. |
| Consumo por 100 km | Repostajes en `vehiculo_repostajes`, sin aforos de depósito | Litros consumidos entre lecturas comparables / km entre lecturas | **Requiere capturar datos**. Litros repostados se muestran aparte, nunca como consumo. |
| Coste combustible/km | Importe de `vehiculo_repostajes` de flota propia / km físicos propios | Vehículos con repostaje valorado y km propios completos | **Parcial**. No atribuible al filtrar por cliente/ruta/ejecución; posible desfase de repostaje respecto al trayecto. |
| Mantenimiento/km | `taller_estado.data.reparaciones.coste_total` del periodo / km propios | Vehículos con reparaciones valoradas y km propios completos | **Parcial**, mismos límites de atribución y periodo. |
| Disponibilidad/utilización | `vehiculos.estado/activo` es una instantánea, no intervalos | Tiempo disponible/activo histórico por vehículo | **Requiere capturar datos**; no se presenta porcentaje. |
| Ocupación de carga | Peso, palés, volumen o metros de pedido sin capacidad homogénea por tramo | Carga y capacidad del mismo tramo y unidad | **Requiere capturar datos**; no se mezclan unidades. |
| Servicios sin precio/km | `pedidos.importe`, `km_ruta` | Pedidos no cancelados de la cohorte | **Calculable** como recuento de ausencias; abre detalle de pedido. |
| Gastos pendientes de valorar | `economia.metricas.gastos_pendientes_valorar` de fase 2 | Servicios y gastos externos del periodo | **Parcial**; se mantiene visible en la cobertura común. |
| Emisiones por viaje/cliente/vehículo | Km del pedido × `cfg_precios.sostenibilidad.consumo_l_100km` × `factor_kg_co2_litro`; fallback orientativo existente 32 y 2,68 | Servicios realizados con km válidos y tramo no discrepante | **Estimación parcial, no certificada**. El grupaje se reparte por igual; vacío manual sin pedido no se asigna. No CO₂e ni t·km. |
| Citas y duración de carga Planner | `planner_reservas` (inicio/fin previstos), `planner_muelles`; `planner_preparaciones.carga_inicio_at/carga_fin_at` (inicio/fin reales de carga) | Empresa con Planner autorizado, pedidos `origen_producto=planner`; sección separada sin filtros de transporte | **Parcial**: número y minutos reservados por muelle, mediana/p90 de carga real con cobertura. No equivalen a ocupación física. Espera y permanencia siguen **requiere capturar datos** de llegada/salida real. Nunca mezcla stock o pedidos TMS. |

Los umbrales de puntualidad proceden de la ventana pactada en cada parada, no de un porcentaje universal. Los factores de sostenibilidad son configurables por empresa; cualquier valor orientativo se identifica en la respuesta. Las fuentes se consultan por `empresa_id` y las rutas conservan permiso de Informes, rol y plan del servidor.

## Catálogo de informes de fase 5

Estas plantillas **reutilizan** las definiciones de métricas anteriores. No crean un nuevo cálculo. La ejecución incluye `metric_contract`, periodo exacto, fecha de corte, filtros, cobertura y versión `bi.report.v1`; la tabla de detalle puede tener una dimensión distinta de la unidad de una métrica, por lo que no se suman celdas visibles para reconstruir resultados fiscales.

| Plantilla | Métricas del contrato común | Detalle y límite |
| --- | --- | --- |
| Resumen ejecutivo de gerencia | `ingreso_realizado`, `margen_directo`, `ingreso_km_total`, `km_vacios_pct`, `pendiente_facturar`, `vencido_al_corte` | Servicios realizados completos; evolución y comparación Top 8 explícita. El vencido solo es atribuible cuando el filtro fiscal lo permite. |
| Explotación por vehículo | `ingreso_realizado`, `coste_directo`, `margen_directo`, `ingreso_km_total`, `km_vacios_pct` | Matriz de vehículo histórico. Los km de pedido en detalle no se suman en grupaje; el KPI usa kilómetros físicos deduplicados. |
| Rentabilidad por cliente o ruta | `ingreso_realizado`, `coste_directo`, `margen_directo` | Matriz por cliente/ruta y margen **directo registrado**, no beneficio neto. |
| Realizado pendiente de facturar | `ingreso_realizado`, `pendiente_facturar` | Pedidos realizados con `pendiente_factura`; importes parciales facturados no se conocen por pedido. |
| Cartera vencida al corte | `saldo_al_corte`, `vencido_al_corte` | Facturas válidas no marcadas cobradas y vencidas antes del corte. Saldo histórico exacto sigue estimado sin libro de pagos. |
| Calidad de servicio para cliente | `puntualidad_recogida`, `puntualidad_entrega`, `otif`, `pod_pendiente`, `incidencias_servicio` | Requiere cliente; detalle de marcas reales sin costes, márgenes ni metadatos económicos. `entregado` no equivale a puntual. |

Para cualquier plantilla, valores `null` se exportan como «No calculable» en PDF/pantalla y como celda vacía en XLSX/CSV, junto con estado y definición. La visualización Top 8 no limita la tabla ni la exportación de detalle.

## Alcance del informe semanal de flota

El acceso de gerencia **Ver informe semanal de flota** ejecuta la plantilla «Explotación por vehículo» con `semana_anterior`: lunes 00:00 a domingo 23:59:59 de la semana civil completa anterior en `Europe/Madrid`. Puede solicitarse cualquier día; el lunes ya corresponde a la semana que acaba de cerrar. Incluye ingreso neto realizado, coste directo registrado, margen directo en euros, ingreso por km total, porcentaje de km vacíos y gastos pendientes de valorar. La matriz usa el vehículo asignado históricamente al servicio. El margen no equivale a beneficio neto: combustible no conciliado, nóminas, taller y estructura no se descuentan de forma automática. El PDF se genera a demanda desde el mismo snapshot que la pantalla; el detalle completo permanece en servidor y la vista previa se pagina de 25 en 25 filas.
