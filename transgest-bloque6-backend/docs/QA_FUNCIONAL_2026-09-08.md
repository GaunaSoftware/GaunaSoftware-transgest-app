# Testeo funcional de TransGest - 8 de septiembre de 2026

## Alcance

Revision del checkout `122a9ee` y ejecucion de pruebas locales con datos ficticios.
Se han usado navegador Edge/Playwright, utilidades de dominio y PostgreSQL en memoria (PGlite).
No se han modificado pedidos reales ni creado facturas, pagos o documentos en produccion.
La auditoria inicial no cambio reglas de negocio. A continuacion se implementaron
las correcciones solicitadas, con las pruebas de regresion indicadas abajo.

## Correcciones posteriores

- Los tres P1 descritos abajo son hallazgos historicos: corregidos en esta revision.
- BI usa el mes atribuido para viajes realizados; no modifica las fechas operativas.
- Un borrador sigue pendiente de facturar hasta su emision. Las anulaciones vuelven al pendiente.
- Margen operativo = venta realizada neta menos colaborador, gasoil, peajes, dietas y otros costes registrados. Cobros conserva importes con impuestos.
- Claves API generales y por empresa: modo explicito, cifrado, conservacion de clave al guardar campos, aislamiento de formularios, UPSERT y cambio GPS atomico.
- Pedidos: periodo actual por defecto incluso al filtrar, historico explicito, importes antiguos recalculados al leer sin modificar facturas y orden accesible con borrador.
- Asignacion: selector unico buscable por recurso, disponibles/ocupados y lista acotada; pruebas con 100 vehiculos y 100 conductores.
- Importe tras asignar: la lista reconstruia una ficha completa y recalculaba con campos ausentes. Las acciones rapidas/lote/IA ahora envian solo cambios explicitos; el backend combina cambios de tarifa con los valores persistidos, sin introducir valores predeterminados de campos omitidos. Pruebas: 480 EUR antes y despues de asignar, horas, cambios parciales y cero explicitamente solicitado.
- Orden impresa: paradas en columnas carga/descarga, referencias junto a los datos, sin estado ni bloques de ubicaciones repetidos; condiciones al final.
- Pruebas de SQL usan enums reales y aislamiento por empresa; las pruebas de navegador usan exclusivamente APIs simuladas.

## Hallazgos prioritarios reproducidos

### P1. BI ignora el mes de facturacion elegido

- Caso: viaje entregado de 300 EUR, descarga el 31 de agosto, atribuido a septiembre mediante `facturacion_mes`.
- Resultado: la consulta BI de septiembre devuelve 0 viajes realizados, en lugar de 1.
- Causa: `src/routes/informes.js:79` filtra por descarga/carga/pedido/creacion sin considerar `facturacion_mes`. Tambien se repite en los agrupados por cliente.
- El calculo local del dashboard si considera ese campo (`Dashboard.js:84`), pero la respuesta BI tiene prioridad (`Dashboard.js:704`). Por tanto, el problema no se limita a un informe secundario.
- Correccion propuesta: separar fecha operativa, periodo atribuido y fecha de factura; reutilizar una definicion comun en todos los agregados economicos. No mover las fechas reales del viaje ni antedatar facturas emitidas.
- Prueba de aceptacion: un viaje trasladado de agosto a septiembre debe aparecer una sola vez en los indicadores de atribucion de septiembre; sus indicadores operativos deben conservar la fecha real.

### P1. Un viaje con factura borrador desaparece del pendiente de facturar

- Caso: viaje entregado de 300 EUR enlazado a un borrador.
- Resultado: pendiente de facturar = 0 y facturado = 0. Los 300 EUR no aparecen en ninguno de los dos conceptos.
- Causa: `src/routes/informes.js:63` exige `factura_id IS NULL`, mientras que las facturas borrador quedan excluidas del importe facturado (`:92`).
- El frontend ya contempla que un borrador no equivale a facturar (`Dashboard.js:55`), pero BI vuelve a sobrescribir ese calculo (`:704`).
- Correccion propuesta: consultar el estado efectivo de la factura enlazada; los borradores deben seguir pendientes de facturar, con tratamiento explicito de anulaciones/rectificaciones.
- Prueba de aceptacion: crear borrador no cambia el ingreso gestionado; emitirlo mueve el importe de pendiente a facturado sin duplicarlo.

### P1. El margen mezcla total de factura con base del viaje y omite costes registrados

- Caso: base del viaje 300 EUR, factura total 363 EUR, coste colaborador 100 EUR y gasoil registrado 50 EUR.
- Resultado actual: margen BI = 263 EUR. La base menos esos dos costes es 150 EUR.
- Causa: `src/routes/informes.js:87` agrega `facturas.total`; despues `:235-237` lo suma al pendiente de pedidos y resta solo el coste de colaborador.
- Consecuencia: crear una factura puede cambiar artificialmente ingreso gestionado, margen y EUR/km; los viajes propios tampoco reflejan sus costes de forma completa en ese calculo.
- Correccion propuesta: usar bases netas coherentes para ventas/margen y reservar totales con impuestos para cobros. Definir costes directos incluidos y evitar sumar costes ya incluidos en el precio del colaborador. Mostrar cobertura de costes cuando falten datos.
- Prueba de aceptacion: el margen no debe cambiar solo por pasar de pedido a factura. Conciliar el resultado con los costes incluidos, sin doble contabilizacion.

Reproduccion local de los tres casos, usando las consultas SQL del propio endpoint:

```powershell
cd transgest-bloque6-backend/transgest-backend
node scripts/financial_kpi_regression_check.js
node scripts/api_keys_regression_check.js
node scripts/pedido_read_regression_check.js
```

Los casos de diagnostico se convirtieron a pruebas con las expectativas correctas y se incorporaron a `npm run check`.

## Otros hallazgos

### P2. Errores de carga pueden parecer ausencia de actividad

Revision de codigo, no fallo provocado en produccion: `Dashboard.js:378-387` transforma timeouts y errores en listas vacias. La consulta BI tambien silencia su error (`:412-415`). El usuario puede terminar viendo ceros o ausencia de alertas cuando la carga esta incompleta.

Propuesta: conservar el ultimo dato valido, marcar cada bloque como no actualizado, mostrar la ultima actualizacion y permitir reintentar. No representar un fallo de conexion como cero financiero.

### P2. Validacion incompleta de fecha del mandato en contabilidad

Prueba local de `normalizePartyInput`: acepta `mandate_date: '2026-02-31'`. `transgest-accounting-api/src/domain/parties.js:46` comprueba el formato, pero no si existe la fecha. No se ha intentado guardar ese valor en la base real.

Propuesta: validacion de calendario compartida y respuesta de validacion antes de llegar a SQL; incluir fechas imposibles y anos bisiestos en las pruebas.

### P2. La CI no ejecuta el testeo funcional disponible

`.github/workflows/security.yml` ejecuta auditoria de dependencias y sintaxis de backend, pero no las suites de dominio ni Playwright. En contabilidad han fallado 2 de 157 pruebas: las expectativas de terceros no incluyen los nuevos campos bancarios/provincia que el normalizador devuelve como null.

Esto confirma desactualizacion de las pruebas, no demuestra por si solo un fallo al crear clientes. Actualizar las expectativas debe acompanarse de pruebas de los nuevos campos, no limitarse a quitar aserciones.

Propuesta: ejecutar las suites y la compilacion en cada PR, anadir las comprobaciones de navegador con fixtures, y verificar la version publicada tras cada despliegue. Revisar tambien el fallback de `npm ci` a `npm install`, que permite continuar con instalaciones no reproducibles.

## Resultados ejecutados

| Comprobacion | Resultado | Limite |
| --- | --- | --- |
| Backend TMS `npm run check` | Correcto | Incluye sintaxis, auditoria estatica de tenant y regresiones, no prueba exhaustiva de permisos HTTP |
| Portal: importes, puntos y matching de tarifas | Correcto | Funciones con datos/consultas simuladas |
| Geocodificacion: Burgos/Skretting, Aspe, coordenadas vacias, pin frente a encuadre | Correcto | No valida disponibilidad ni precision de todos los proveedores externos |
| Configuracion IA | Correcto | No se ha enviado ningun PDF a OpenAI ni consumido API de pago |
| SQL: deduplicacion, aislamiento de puntos, guardado de tarifas y reintento de automatismos | Correcto | Base en memoria y esquema reducido |
| SQL: incidencias fuera del periodo, estado y aislamiento cliente/empresa | Correcto | No prueba carga con miles de pedidos |
| Frontend Jest | 4 pruebas correctas, 2 suites | Cobertura unitaria pequena para el tamano del frontend |
| Navegador escritorio 1440x1000 y movil 390x844 | Correcto | API simulada; no prueba integracion con la base real |
| Navegador: abrir/cerrar sin cambios, editar poblacion, vaciar pais, coma decimal, grupaje, puntos y mapa MapLibre | Correcto | Escenarios concretos, no todos los formularios de la aplicacion |
| Navegador: devoluciones con 30 lotes y selector original/actual/siguiente | Correcto | Flujo de interfaz; no emite facturas reales |
| Contabilidad `npm test` | 155 correctas, 2 fallidas, 157 total | Incluye contratos y comprobaciones estaticas de migraciones, no 157 flujos HTTP reales |
| Regresion de KPIs en PGlite | Correcta | Mes atribuido, cambio de ano, borrador, emision, anulacion, margen, costes y cobros |

## Produccion comprobada sin cambios

- `https://transgest-backend.onrender.com/health`: HTTP 200, base conectada y release `122a9eea763a9ca5bc9a74695850330a1954b0d3`.
- `https://app.gauna.es/`: HTTP 200. El modulo publicado `6488.c0fdbf9e.chunk.js` contiene el selector del mes original y `incluir_incidencias`.
- La cabecera del frontend sigue indicando `2026-09-07-puntos-geocoding`; por si sola no identifica de manera fiable todos los cambios publicados. Conviene exponer el commit de frontend, igual que en el backend.
- Esto confirma disponibilidad puntual y presencia de los ultimos cambios, no un testeo autenticado completo de produccion ni un benchmark de rendimiento.

## Orden recomendado

1. Corregir y conciliar los tres calculos economicos anteriores antes de anadir mas indicadores.
2. Distinguir datos pendientes/fallidos de ceros reales en dashboard e informes.
3. Cerrar pruebas y validaciones contables; incorporar las suites a CI.
4. Preparar una empresa QA aislada para probar con la API real el ciclo solicitud -> pedido -> asignacion -> incidencia -> entrega -> borrador -> factura. Bloquear envios reales de correo, fiscalidad y otros servicios externos en ese entorno.
5. Probar permisos de cliente, chofer, invitado/colaborador, trafico y gerente contra la API, incluyendo intentos de leer otro cliente/empresa. La auditoria estatica actual no sustituye esas pruebas.
6. Completar pruebas de devoluciones parciales por obra/referencia, concurrencia, doble clic y reintentos; medir guardados y consultas con volumen representativo.

No se afirma que falten los modulos de solicitudes, incidencias, palets o permisos: existen. Lo pendiente es demostrar su comportamiento extremo a extremo y corregir las discrepancias concretas identificadas.
