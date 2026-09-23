# TransGest BI · checklist de auditoría de fase 6

Fecha de revisión: 23/09/2026. Rama aislada `codex/bi-phase1-reliability`. **El push de la rama no es un despliegue ni una aprobación de producción.** Datos sintéticos exclusivamente; ninguna consulta a una empresa productiva.

## Funciones comprobadas y evidencia

| Área | Evidencia de esta revisión | Estado |
| --- | --- | --- |
| Definiciones económicas | `bi_phase1_check.cjs`, `bi_phase2_check.cjs`, `bi_phase6_check.cjs`: IVA neto/bruto, cobro parcial como fórmula, borrador/anulada/rectificada, abono firmado, deuda anterior, cancelados y futuros, ratios de sumas, coste registrado y km de grupaje | Comprobado con datos sintéticos; las limitaciones de cobro real y facturación parcial siguen abiertas |
| Fecha civil Europe/Madrid | Pruebas UTC cerca de medianoche, semana completa anterior y cambios de horario de marzo/octubre; SQL PGlite para firma `TIMESTAMPTZ` | Corregido y probado en estos casos |
| Reconciliación | Mismo snapshot: KPI, evolución, detalle, PDF, XLSX, CSV. PDF corto/largo/sin datos/parcial y XLSX/CSV sintéticos en `output/` | Comprobado en muestras; no con datos reales |
| Más de 1.500 servicios | 1.501 en PGlite; panel pagina detalle en 20, vista previa de informe en 25; el snapshot completo queda en servidor para exportar | Medido: 16 consultas y 4.426–7.261 ms en dos ejecuciones locales (la segunda concurrente con el build); respuesta paginada del panel 18.145 bytes. No son cifras de producción |
| Aislamiento y permisos | PGlite con empresas A/B, gerencia/contable/chofer y dueños distintos; pruebas de consultas, vistas, descargas y caché | Comprobado en rutas y middleware ensayados; falta sesión integrada real |
| Interfaz | Suite React de vistas guardadas, paginación y acceso semanal; build de producción y revisión visual local sintética | 390/768/1440/1920 px sin desbordamiento de documento; contraste oscuro corregido. Falta sesión integrada y revisión completa de todos los estados |
| Regresiones operativas | `npm run check` backend y suite frontend cubren pedidos, tráfico, facturación, chofer, hojas de ruta y Planner | Suite frontend: 28/28 y 77/77; `npm run check` backend terminó con código 0 |

## Defectos corregidos en fase 6

1. La vista previa devolvía al navegador **todas** las filas de un informe. Ahora responde con 25 y pagina la misma ejecución privada desde servidor; PDF/XLSX/CSV conservan el detalle completo y los KPI invariables.
2. Una firma `TIMESTAMPTZ` próxima a medianoche podía clasificarse por fecha UTC. La fecha económica de firma y los helpers de fecha se interpretan en `Europe/Madrid`; se añadieron casos de cambio de horario.
3. El informe semanal solicitado queda como acceso directo para gerencia en el centro de informes: al abrirlo calcula la semana completa anterior, con costes directos, margen y km por camión, y ofrece descarga PDF. Usa las definiciones comunes. **No se presenta como beneficio neto** ni envía correos automáticamente.
4. En tema oscuro, las tarjetas del centro de informes quedaban blancas con texto claro porque `--surface` no pertenece a la paleta del programa. Se cambiaron a `--card-bg`/`--bg2`; los textos secundarios y avisos usan variables de tema.

## Riesgos y validaciones pendientes

- **Bloqueante para afirmar exactitud financiera en producción:** TransGest TMS no tiene un libro de cobros parciales con fecha y reversos conciliados. `estado=cobrada` solo permite una estimación actual; un pago posterior al corte impide reconstruir el saldo histórico exacto. `cobros_efectivos` permanece no calculable.
- **Bloqueante para el pendiente exacto de servicios parcialmente facturados:** el enlace factura–pedido no aporta importe aplicado por pedido. Un pedido con factura parcial puede parecer totalmente facturado. La métrica se etiqueta parcial y debe validarse o completarse con una fuente de importes antes de usarla para cierre contable.
- Costes de chófer, tickets externos, combustible, nóminas, taller y estructura requieren conciliación de identidad y período para publicar beneficio completo. Se informa margen directo registrado y cobertura, no beneficio neto.
- El ensayo de rendimiento es local en PGlite. Faltan latencia, memoria, plan SQL, volumen de una base no productiva representativa y concurrencia. No se añadieron índices sin evidencia.
- Falta ensayo integrado con una sesión autenticada y migraciones aplicadas a una copia no productiva; las pruebas de interfaz sintética no acreditan los datos/plan/permisos configurados en clientes reales.
- Los snapshots y binarios expiran a las 24 h para lectura. La purga se ejecuta cuando se genera otro informe de la empresa; debe observarse crecimiento de almacenamiento si una empresa deja de generar informes.
- El informe semanal es **a demanda dentro del programa**: el lunes ya permite consultar la semana cerrada y también puede pedirse después. No existe envío programado por correo ni generación nocturna; se eligió la alternativa ofrecida por el solicitante para evitar una comunicación automática de métricas todavía parciales.

## Migración y ensayo previo al despliegue

La única migración BI nueva es `transgest-backend/scripts/migrations/20260923_bi_report_center.sql`: tablas `bi_report_views`, `bi_report_runs` y `bi_report_exports` con índices por empresa/usuario/caducidad. Es aditiva; no altera facturas ni pedidos. Se aplicó solo a PGlite durante las pruebas.

En una copia no productiva de la base: hacer respaldo, ejecutar `npm run migrate` desde `transgest-backend`, verificar `schema_migrations` y las tres tablas, repetir el migrador para confirmar idempotencia, crear una vista personal y una compartida, generar/descargar cada formato y comprobar 403/404 con otra empresa y otro usuario. Probar también caducidad y una sesión gerencia/contable/chofer. Registrar duración y uso de memoria con más de 1.500 pedidos representativos.

## Compatibilidad, despliegue y reversión propuestos (no ejecutados)

Los endpoints BI previos y las pantallas anteriores permanecen; los contratos comunes mantienen adaptadores. El nuevo centro exige la migración antes de usar sus rutas. La vista previa cambia de devolver todas las filas a 25 con `metadata.total_rows` y `GET /informes/bi/reportes/ejecuciones/:id?pagina=N`; los clientes del centro incluidos en esta rama consumen ese contrato. No hay cambio de plan comercial.

Procedimiento para un responsable de despliegue, **solo después de cerrar los bloqueantes**: (1) respaldo y prueba de restauración; (2) desplegar backend compatible con el frontend anterior; (3) ejecutar migraciones y validar checksum; (4) pasar smoke de permisos, informes y procesos operativos en staging; (5) desplegar frontend; (6) monitorizar errores, latencia, tamaño de snapshots y reconciliación de importes con casos conocidos.

Reversión: retirar el frontend BI nuevo y volver al backend previo compatible, manteniendo las tablas aditivas sin borrarlas. No eliminar tablas ni documentos fiscales durante una reversión urgente. Si se revierte el backend después de crear vistas, conservar la base respaldada y los snapshots para diagnosticar. La reversión de código no reinterpreta ni corrige datos históricos.

## Recorrido de demostración para gerencia

1. Abrir **Informes → Dirección**; seleccionar mes y comprobar definición, cobertura y corte de ingreso, margen y vencido.
2. Filtrar cliente y ruta, abrir un pedido desde el detalle y volver conservando filtros. Cambiar tamaño de página y observar que los KPI no cambian.
3. Abrir **Rentabilidad** y comparar flota propia/subcontratación, matriz por vehículo y los km físicos del grupaje.
4. Abrir **Centro de informes**, elegir una plantilla, guardar vista personal y luego una compartida; comprobar que otro rol solo ve el alcance autorizado.
5. Pulsar **Ver informe semanal de flota**; revisar semana anterior, costes registrados, km vacíos, margen directo y advertencias; descargar PDF y cotejar un pedido con CSV/XLSX.
6. Mostrar un informe sin datos y otro parcial; explicar que `—` no equivale a cero y que saldo histórico/cobro efectivo siguen pendientes de fuente conciliada.

## Comandos y resultados reales

| Comando (desde el paquete indicado) | Resultado real |
| --- | --- |
| Backend: `npm run bi:regression` (dentro de `npm run check`) | Pasaron fases 1, 2, 4, 5 y 6; 1.501 servicios sintéticos, formatos y aislamiento. |
| Backend: `npm run check` | Código 0: auditoría de empresa, portal, geografía, IA, operativa, producción, Planner y app del chófer. |
| Frontend: `CI=true; npm test -- --watch=false --runInBand` | 28 suites y 77 pruebas, todas pasaron. |
| Frontend: `npm run check` | Pasó sintaxis y auditoría de contraste. |
| Frontend: `npm run build` | Compiló tras retirar la vista temporal de prueba; advertencias de dependencia dinámica y ESLint en archivos ajenos al centro BI. |
| Git: `git -c core.whitespace=cr-at-eol diff --cached --check` | Pasó sin errores tras limpiar espacios; 48 archivos de código y documentación preparados para el commit. |

`BI_VALIDATION.md` conserva la evidencia detallada de cada fase. La auditoría **no** permite afirmar todavía que el BI esté listo para producción por los límites de fuente y de ensayo integrado descritos arriba.
