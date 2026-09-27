# Gastos de estructura y revisión operativa — 27/09/2026

## Alcance y ubicación

Cambio acotado de Gastos de estructura y su entrada de navegación. Se conservan las rutas, permisos, temas, datos y procesos del resto del programa. Ubicación: **Finanzas → Costes → Gastos de estructura**. Dentro hay **Gestión de gastos** y **Comparativa**.

Se retira el párrafo técnico de la cabecera. El alta conserva nombre, categoría, importe, frecuencia mensual/puntual/trimestral/anual, mes de inicio y notas. Conserva edición, baja lógica, justificante, cierre/reapertura y reparto a partes iguales o por ingresos. La creación empieza en el mes seleccionado. No se ha restituido código antiguo ni eliminado controles de meses cerrados.

Se usan PageHeader, Section, KpiCard, Tabs, Modal y DataTable compartidos. El listado se presenta como fichas en móvil; las tablas comparativas mantienen desplazamiento propio. Errores visibles y respuestas antiguas descartadas.

## Comparación y límites del dato

Contrato aditivo `comparativa` en `GET /empresa/gastos-estructura/resumen?periodo=AAAA-MM`, calculado en `structureExpenses.js` sobre la misma fuente y empresa que el total. Incluye mes seleccionado, mes anterior y mismo mes del año anterior, categorías, diferencia en euros y porcentaje; no hace tres peticiones de históricos al navegador. Gráfico con leyenda y tabla numérica equivalente.

- Comparación de meses civiles completos, no últimos 30 días. No extrapola el mes en curso.
- Cada gasto mensual se incluye desde su inicio; puntual solo en su mes; anual/12 y trimestral/3, conforme al comportamiento previo.
- Sin registros: null / «Sin datos». Sin base positiva de comparación: porcentaje no calculable; si la categoría anterior era cero dentro de un mes informado, se puede mostrar la diferencia absoluta.
- Totales y variaciones se calculan en servidor. Las categorías suman el total. Los justificantes no se duplican dentro de la comparativa.
- Importes registrados sin desglose fiscal en esta tabla: no afirmar que todos son netos ni aplicar IVA fijo.
- Cobertura parcial: solo gastos de estructura registrados. No equivale a todos los costes ni al beneficio neto.
- El histórico se reconstruye con fichas vigentes; no existe una versión temporal por cada cambio de importe. Cerrar un mes bloquea las modificaciones correspondientes, pero no genera un snapshot contable. No se inventan importes anteriores.
- El reparto sigue siendo orientativo sobre flota activa actual; no se ofrece una falsa comparación de camiones históricos. No crea cargos duplicados.
- Consulta sujeta al módulo y empresa autorizados en servidor; mutaciones de gerente/contable y permisos de edición. No migración necesaria.

## Referencias de organización

Consulta de documentación oficial, no acceso a cuentas de terceros:
- [Dashdoc: costes y rentabilidad](https://www.dashdoc.com/es/blog/ideas-sobre-rentabilidad-controla-costos-maximiza-margenes): agrupa costes recurrentes en rentabilidad. Se toma la proximidad entre registro de costes y análisis.
- [Dashdoc: costes de compras](https://help.dashdoc.com/es/articles/9250659-gestiona-tus-costos-de-compras-en-dashdoc): relaciona costes con el expediente de transporte y conserva los precios de operaciones ya registradas. No copiamos su definición de ingreso; TransGest mantiene su contrato económico.
- [Holded: informe de gastos](https://help.holded.com/es/articles/7913844-consultar-el-informe-de-gastos): informe por periodo y categorías dentro de Analítica.
- [Holded: informes financieros](https://www.holded.com/es/informes): comparación de periodos y variaciones monetarias/porcentuales.

**Decisión propia:** mantener la operación en Finanzas/Costes y el análisis en una pestaña del mismo módulo evita obligar al usuario a buscar dos pantallas distintas. No se mueve Control horario ni se amplían permisos comerciales.

## Revisión funcional de la evolución tipo Dashdoc

Esta es una revisión de capacidades del código actual y sus límites. «Existe» significa recorrido implementado; no presupone activación de un proveedor externo ni despliegue de esta rama. No es una lista de fallos de pruebas.

### Ya existe y conviene aprovechar antes de añadir módulos

| Operativa | Evidencia en código | Alcance |
|---|---|---|
| Mesa de tráfico, grupajes, secuencia de paradas, disposición y asignación conjunta | `groupagePlan.js`, `journeyAssignment.js`, `journeyProjection.js` | Planificación previa al inicio; identidad de envíos explícita en multiparada |
| Seguimiento operativo y app del chófer por parada | `operationalModel.js`, `controlTowerFlow.js`, flujos driver journey | Eventos reales, mercancía, carga/descarga y documentación por ejecución |
| Posición, geocercas y ETA por carretera | `vehicleTracking.js`, `driverTrackingContext.js` | Frescura y origen visibles; ETA a demanda, sin confundir línea recta con ruta |
| Documentos versionados y evidencias de firma | `transportDocumentVersions.js`, `transportShipments.js` | Conservación del original; no se debe anunciar como eCMR contractual completo |
| Almacén, preparación, muelles, stock, lotes, calidad, conteos y packing | `plannerInventory.js`, `plannerLoading.js`, `plannerWms.js` | Procesos manuales auditables y propuestas FIFO/FEFO |
| Colaboradores, aceptación, intercambio entre empresas, POD y estados | `networkConsent.js`, `plannerExchange.js` | Consentimiento bilateral y alcances concretos; no compartir facturación interna |
| Costes por viaje y revisión de facturas de proveedor | `journeyCosts.js`, `financialJourneys.js`, `supplierInvoiceReview.js` | Referencias y conciliación; solapes no conciliados quedan pendientes |
| Bandeja de pedidos, importación, revisión antes de facturar e informes | flujos order inbox/importación, `invoiceOperationalWorkflow.js`, servicios BI | Reutilizar antes de abrir una segunda bandeja o módulo de costes |

### Qué falta operativamente y orden recomendado

| Prioridad | Capacidad pendiente | Situación comprobada | Resultado deseable |
|---|---|---|---|
| 1 | Replanificar un viaje ya iniciado o documentado | `journeyAssignment.js` rechaza pedidos iniciados/facturados; `groupagePlan.js` protege planes con eventos reales | Cambiar tractora/conductor, hacer relevo o dividir el tramo restante mediante nueva versión, conservando fechas reales, originales y quién autorizó |
| 1 | Optimización con restricciones de explotación | La planificación actual no equivale a un optimizador con ventanas, capacidad, restricciones de camión y pausas | Propuesta explicada, con conflictos y validación de tráfico; no mover citas automáticamente |
| 1 | Ciclo completo de paralizaciones | Existe importe y marcas operativas; catálogo BI identifica falta de enlace documental → importe facturable → línea emitida → cobro | Detectar espera, justificar, aprobar/cotizar al cliente, facturar y reclamar desde el expediente; medir recuperación real |
| 2 | Vigencia y fin de gastos recurrentes | `gastos_estructura` tiene inicio/frecuencia, sin intervalo de vigencia ni versión económica por cambio | «Cambiar desde este mes» y «Finalizar recurrencia» sin reescribir importes anteriores; después comparación histórica exacta |
| 2 | Automatización del almacén | `plannerWms.js` tiene conteos, traslados y sugerencia FIFO/FEFO; la sugerencia no reserva automáticamente | Reposición por mínimos, conteos cíclicos y propuesta de muelle con reglas operativas configuradas; aprobación humana inicial |
| 2 | Cierre económico del transporte subcontratado entre empresas | Network no incluye facturas en su catálogo de permisos; la revisión de proveedor existe separada | Compartir factura autorizada, conciliar contra encargo y POD, resolver diferencias y dejar lista la liquidación |
| 3 | Cadena internacional / eCMR completa | Versiones documentales preparadas, sin solución contractual completa declarada | Definir primero países, participantes y proceso de aceptación; no basta cambiar el título del PDF |

### Activaciones distintas de funciones nuevas

GPS/telemática, recepción externa de pedidos, push Android, distribución de la app y proveedor fiscal tienen código/conectores, pero dependen de configuración, contrato, despliegue o dispositivo. No se presentan como módulos inexistentes ni como integraciones verificadas automáticamente. El registro de un conector tampoco demuestra que esté conectado.

La prioridad recomendada para la siguiente evolución es **replanificación y relevos → optimización con restricciones → paralizaciones**. Aportan capacidad diaria de tráfico y recuperación de costes. No se han implementado silenciosamente estas ampliaciones en este cambio de Gastos de estructura.

## Verificación

Los resultados y comandos finales se registran en `BI_VALIDATION.md`. El cambio de gastos es compatible con clientes anteriores del endpoint y no requiere SQL nuevo. La web nueva indica «Comparativa no disponible» si recibe un backend anterior. La reversión del cambio de gastos no altera registros ni documentos.

## Continuación posterior solicitada

La petición «Haz todo lo que quede pendiente de las mejoras operativas» desarrolla la tabla anterior en la rama `codex/operational-completion`. Estado vigente, alcance implementado, pruebas y pendientes: `TMS_OPERATIONAL_COMPLETION.md`. Se conserva aquí la revisión de partida como registro; sus pendientes y ausencia de nuevas migraciones describen el cambio inicial de gastos, no la ampliación posterior.
