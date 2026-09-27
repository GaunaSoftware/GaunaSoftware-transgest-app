# Cierre de mejoras operativas

Solicitud: completar los pendientes funcionales identificados en `TMS_STRUCTURE_EXPENSES_AND_OPERATIONS_20260927.md`. Rama `codex/operational-completion`, base `1f07fbc`. No sustituye las instrucciones ni las evidencias anteriores.

## Reglas

- Reutilizar modelo, permisos, planes y componentes actuales; no inventar históricos, costes, tiempos, consentimientos ni certificaciones.
- Cambios aditivos, validación en servidor por empresa y rol, concurrencia/versiones e idempotencia donde proceda.
- Mantener los originales documentales y fiscales. La replanificación modifica únicamente la ejecución pendiente.
- Pruebas sintéticas locales. No crear servidores de ensayo ni restauraciones sobre el disco compartido de producción. No aumentar costes.
- La autorización de publicación previa no sustituye la comprobación de disponibilidad del servicio. No desplegar durante la incidencia de infraestructura pendiente.

## Entregas y estado

| Flujo | Estado | Criterio de cierre |
|---|---|---|
| Vigencia de gastos recurrentes | Implementado y probado localmente | Cambio desde mes, finalización inclusiva, histórico de nuevas versiones, protección de meses cerrados y revisión concurrente |
| Replanificación y relevos | Implementado con límites | Nueva versión de la secuencia pendiente y recursos propios; conserva actividad, originales y asignaciones anteriores; no divide el tramo restante en nuevos viajes |
| Optimización con restricciones | Implementado como propuesta | Ventanas Madrid, precedencia, capacidad en kg, pausas configuradas, restricciones del proveedor y conflictos explícitos; sin certificación de tacógrafo ni óptimo global garantizado |
| Paralizaciones | Documentación → aprobación → facturación implementado | Documento del pedido, intervalo real declarado, acuerdo comercial y motivo; línea separada en factura. Cobro atribuido y reclamación externa siguen pendientes |
| Automatismos Planner | Implementado y probado localmente | Reposición por mínimos/objetivo FEFO, conteos según último confirmado, sugerencias de muelle; ejecución física confirmada por usuario |
| Cierre económico Network | Implementado hasta registro de factura recibida | Consentimiento bilateral; PDF original, enlace de encargo y documentos de entrega, diferencias y revisión humana; no crea pagos ni acredita cobro |
| Cadena internacional/eCMR | Pendiente de alcance contractual | Identificar países/partes/procedimiento; no denominar certificado al borrador actual |

El resumen BI de Operaciones añade recuperación de paralizaciones por cohorte filtrada: última revisión auditada al corte, documentado facturable (excluye rechazadas), aceptado, líneas emitidas, porcentaje ponderado y detalle paginado. Los importes manuales sin expediente quedan identificados aparte; cobro aplicado no calculable. Las facturas usan estado vigente y fecha hasta el corte, no un historial de estados fiscal inventado.

Las activaciones externas (GPS, correo entrante, publicación Android y proveedor fiscal) requieren configuración y verificación real. No se consideran cumplidas por disponer de código.

## Verificación

### Pruebas ejecutadas el 27/09/2026

Desde `transgest-bloque6-backend/transgest-backend`:

- `npm run operations:regression`: aprobado. Vigencias y meses cerrados, reintentos/empresa, ventanas y cambio horario, pesos/precedencias/pausas, persistencia de propuesta y conciliación de paralizaciones.
- `node scripts/operational_model_check.cjs`: aprobado. Migración repetida, rollback, identidad de envíos declarados reutilizada, fechas reales conservadas y bloqueo de documentos antiguos sin correspondencia verificable.
- `npm run check`: aprobado, código de salida 0. Incluye regresiones existentes de BI, operativa, pedidos, Planner, app del chófer, documentos, geocodificación, IA, permisos y aislamiento. Necesitó permiso de creación de procesos locales por `EPERM` del sandbox; no acceso a producción.
- `$env:AUDIT_BROWSER='0'; node scripts/audit_workflows_regression_check.cjs`: aprobado, salida 0, `passed:true`, `schemaErrors:[]`. 141 comprobaciones en el listado principal más subbaterías, entre ellas 34 de esta entrega, 11 de replanificación y 67 de Network. PostgreSQL compatible PGlite aislado, correo y conexiones externas sustituidos por sumideros locales.
- PostgreSQL nativo local: batería HTTP final aprobada con reintentos simultáneos de paralizaciones, reposiciones y replanificación. `AUDIT_PG_PORT=55437`, `AUDIT_PG_PASSWORD_FILE=<archivo local>`, `AUDIT_PG_BIN=<binarios locales>`, `AUDIT_BACKUP_DIR=<directorio local>`, `AUDIT_BROWSER=0 node scripts/audit_workflows_regression_check.cjs`. Las 68 migraciones se aplicaron y la segunda ejecución no alteró el registro. `pg_dump`/`pg_restore` verificaron 196 tablas / 852 filas sintéticas mediante huellas, sin datos reales. La primera ejecución de arranque en sandbox falló por token de Windows; el arranque local autorizado funcionó.
- La prueba HTTP usa las fronteras reales de autenticación, módulo y plan del optimizador: Planner sin TMS recibe 403; un transportista autorizado tampoco puede consultar un pedido de otra empresa (404).
- Ingreso de prueba: porte 1.000 € que ya incluye 50 € de combustible + paralización separada 150 € = 1.150 €. Dos servicios suman 2.300 € en tarjeta, evolución, detalle y proyección del informe. Validado PDF real y CSV; XLSX generado mediante el exportador común. Las baterías BI existentes validan tipos/celdas y reconciliación de exportaciones.
- Factura automática y factura manual: una sola línea de paralización enlazada al pedido, base correcta y bloqueo de edición posterior al borrador. Ninguna factura histórica modificada.

Desde `transgest-bloque6-backend/transgest-frontend`:

- `CI=true npm test -- --watchAll=false --runInBand`: **65 suites, 161 pruebas aprobadas**.
- `CI=false GENERATE_SOURCEMAP=false REACT_APP_LOCAL_SERVER=true npm run build`: aprobado, salida 0; limitador local de trabajadores en `NODE_OPTIONS` para este equipo. Avisos de lint existentes, sin errores de compilación. La opción local es exclusivamente para el ensayo; el despliegue debe compilar con la configuración de producción existente.
- Nuevas pruebas de interfaz: pedido nuevo/sin permiso no abre mutaciones; paradas empezadas no se desplazan; fallo API visible; conflicto de ruta no aplicable; propuesta parcial explícita; cobro no conocido no se presenta como cero.
- Prueba en navegador local con empresa sintética: acceso, navegación Finanzas → Costes, formulario de vigencia a 390 px, selección por teclado, guardado de versiones y conservación de septiembre al guardar una nueva renta de octubre. Comparativa a 768 px, ancho de documento igual al viewport. Se mantuvieron componentes y temas del programa. Replanificación a 1440 px: cambio de descargas guardado como versión 2, cargas finalizadas conservadas, reapertura con secuencia actualizada. Paralizaciones a 390 px: formulario sin desbordamientos y Escape cierra solo el modal superior. Planner a 1920 px: propuestas y nueva regla alineadas; ancho documento/viewport 1920/1920.

### Defectos detectados durante implementación y corregidos

- Migración de reclamaciones dependía de un campo creado más tarde al iniciar: ahora declara el campo aditivamente antes de instalar su protección.
- La consulta de muelles comparaba un literal que no pertenece al enum de pedidos: usa estado textual conforme al modelo existente.
- La factura automática omitía la paralización registrada por separado; se corrigieron ambas vías de generación y el contrato común de ingreso.
- La incorporación de un viaje podía crear otra identidad de envío: reutiliza las identidades declaradas y bloquea correspondencias ambiguas.
- La prueba de previsiones tenía un número fijo que dejó de ser válido al recibir la factura sintética de Network: se ajustó al saldo previo. No era una duplicación de previsiones en la aplicación. El intercambio reutiliza el servicio de revisión, conserva original e idempotencia y no acepta ni paga al recibir.
- Al ampliar las pruebas, una nueva prueba React importaba una biblioteca que este proyecto no usa: se reescribió con React DOM existente. Otra prueba intentó asignar `anulada` al enum nativo de facturas, que no contiene ese literal: se corrigió la prueba para utilizar los estados reales. No se modificó el esquema para hacer pasar la prueba.
- Los mocks anteriores de almacén no contemplaban el nuevo endpoint: se actualizaron; las respuestas incompletas muestran un error, no una falsa lista vacía.
- Un `ChunkLoadError` del ensayo visual se produjo por recompilar mientras estaba abierta la versión anterior; recargando la compilación terminada se resolvió. No se presenta como error de negocio corregido.

## Uso y alcance funcional

1. **Finanzas → Costes → Gastos de estructura:** «Cambiar desde un mes» conserva el importe original y añade vigencia con motivo/usuario. «Finalizar recurrencia» incluye el último mes indicado. Las comparativas y BI leen las mismas versiones.
2. **Pedido → Replanificación y relevos:** incorpora únicamente viajes simples compatibles o usa su modelo materializado. Reordena las paradas aún pendientes; las anteriores a la última con actividad también conservan su sitio. Relevo de flota propia con lugar, motivo y versión, validando empresa, disponibilidad y conflictos. El chófer vigente continúa la secuencia física. El cambio de proveedor conserva su flujo de aceptación independiente.
3. **Plan del grupaje → Proponer con restricciones:** revisa fecha/hora de salida, ventanas, capacidad útil, perfil del conjunto y pausas. Datos ausentes generan propuesta parcial; conflictos requieren corrección. Guardar el plan conserva el resultado como estimación revisada por tráfico. Referencias de proveedor: [HERE Route Sections](https://docs.here.com/routing/docs/routing-v8-route-section), [HERE Calculate Routes](https://docs.here.com/routing/reference/routing-api-v8-calculateroutes), [ORS Directions](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/requests-and-return-types).
4. **Pedido → Paralizaciones documentadas:** adjunta previamente evidencia al expediente, registra intervalo finalizado/acuerdo/importe y revisión. La cantidad aceptada se suma como concepto separado al facturar, manteniendo combustible en su propia línea. No se deduce un cobro del estado fiscal.
5. **Planner → almacén/WMS:** reglas por artículo y ubicación, disponibles liberados no caducados, movimientos propuestos por FEFO. Confirmar requiere la huella/versiones actuales; repetir no descuenta de nuevo. El conteo propuesto reutiliza un conteo abierto de esa versión y su confirmación física sigue en el flujo existente. Muelle sugerido muestra actividad/cola y mediana histórica real, no convierte el tiempo previsto en duración real.
6. **Conexiones Planner/Network → Cierre económico:** gerencias autorizan bilateralmente el alcance de facturas; emisor elige factura emitida de esa conexión y PDF original. Destinatario revisa precios y documentos de entrega desde conciliación existente. La existencia de POD/albarán no certifica su contenido. Facturas multiencargo requieren reparto manual de líneas antes de cerrar la revisión. Una revocación corta el intercambio, conservando el original ya recibido.

## Pendientes reales (no declarados terminados)

- Dividir físicamente el tramo restante en varios viajes y repartir km/costes entre recursos anteriores y posteriores: el relevo conserva ambos, pero marca atribución histórica como no calculable si falta evidencia de tramo/odómetro. No inventa el reparto.
- Adopción de pedidos multiparada antiguos o con documentos sin identidad de envío: requiere correspondencia documental revisada. El flujo anterior sigue disponible; no se reconstruyen firmas/documentos automáticamente.
- Recuperación cobrada de paralizaciones, liquidación bancaria Network y antigüedad exacta de cobros aplicados: falta un libro de movimientos aplicado por concepto. Se devuelve `null` y se etiqueta el pago declarado por el destinatario por separado.
- Envío externo de reclamaciones al cliente: el expediente, revisión, facturación y agregado BI están implementados; el envío externo específico queda pendiente. No se ha enviado ninguna comunicación real.
- eCMR internacional: sin respuesta aún sobre países, participantes y proveedor/procedimiento de firma. No se presenta una cadena contractual certificada.
- Proveedores de rutas reales, tacógrafo, push en dispositivo Android, SMTP externo y proveedor fiscal: no verificados en este ensayo sin conexiones externas. La heurística no es un solver de optimización global.
- Carga real, disponibilidad y rendimiento en Render: pendientes. La concurrencia de reintentos HTTP, las migraciones y la copia/restauración sí se comprobaron en PostgreSQL nativo local; no es una prueba de carga de producción.
- Despliegue: condicionado a resolver la incidencia previa de PostgreSQL. No se ha ampliado disco, creado instancia alojada ni otra copia de restauración en Render.

## Migraciones, compatibilidad y publicación

Migraciones nuevas `20260928_structure_expense_effectivity.sql`, `20260928_journey_replanning.sql`, `20260928_detention_claims.sql`, `20260928_planner_automation_rules.sql`, `20260928_network_billing.sql`. Son aditivas; no rellenan eventos históricos ni cambian documentos fiscales. Las tablas del optimizador mantienen su inicialización compatible y añaden `constraint_review` cuando existen.

Aplicación prevista, **no ejecutada**: confirmar recuperación del servicio y espacio libre; disponer de copia externa verificable sin restaurarla en el disco compartido; desplegar migraciones/backend con `npm run migrate`, después frontend con variables de producción. Comprobar login, listado, gastos, nuevo pedido, factura en borrador y Planner según permisos. No enviar mensajes externos en una comprobación sin destinatario autorizado.

Reversión: restaurar versión anterior de código solo tras revisar uso de las nuevas funciones; conservar tablas/campos/auditorías. Una versión antigua no conoce vigencias ni la línea de paralización y no debe editar esos registros. Si ya se han utilizado, detener esas mutaciones y corregir hacia delante; no retirar el trigger ni borrar el historial para permitir escrituras antiguas. No hay una reversión ciega garantizada.

## Estado de publicación

Comprobación de Render del 27/09/2026: PostgreSQL figura **suspended**, con aviso de almacenamiento casi lleno. Soporte muestra la escalada a equipo humano sin respuesta técnica nueva. No se pulsó reanudación, no se amplió disco ni se desplegó. Publicar una rama de revisión no activa estas funciones en producción.


## Continuación 27/09/2026

La integración y validación vigentes, la autorización posterior de ampliación y los límites de publicación se documentan en `ANDROID_DETENTION_RELEASE_20260927.md`. Se conserva este historial.
