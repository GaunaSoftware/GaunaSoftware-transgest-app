# Avisos, AvImp e Intelligence — 27/09/2026

## Alcance y decisiones

Trabajo sobre `codex/alerts-intelligence-workflows`, desde `800ba829`, en worktree aislado. Se conserva el checkout principal y sus cambios ajenos. Continúa la autorización del usuario para publicar las correcciones comprobadas; no se usan facturas, tareas ni pedidos reales como datos de prueba.

- Dashboard, Avisos e Intelligence comparten `noticeCenter`: facturas y cobros, vehículos/remolques, conductores y plataformas. Cada registro abre su factura o ficha; las fichas se sitúan en documentación o plataformas. Funciona también cuando la pestaña de destino ya está montada y cuando la factura no está en la página del listado.
- Se conserva el destino interno `vehiculos` cuando el menú autorizado contiene tractoras/remolques. Sin ese adaptador, el menú reorganizado devolvía al Dashboard al intentar abrir una ficha desde un aviso.
- Antelación por tipo (0–365 días), activación y configuración de mantenimiento conservada. Solo gerencia con permiso de edición modifica la configuración. Cada consulta aplica empresa y permisos de módulos en servidor. Los perfiles de taller ven únicamente las fuentes autorizadas.
- Se distinguen vencido, vence hoy y próximo. Fechas de calendario Europe/Madrid. Un documento renovado sustituye al anterior del mismo tipo en el centro de vencimientos; el archivo documental existente permanece disponible.
- El importe mostrado de una factura es **su total con impuestos**, no un saldo conciliado. El estado indica factura no marcada como cobrada; se informa expresamente de la limitación de cobros parciales. No se modifican documentos fiscales ni se recalculan sus importes.
- AvImp «Leído» marca todos los avisos elegibles del usuario en el servidor, no solo los 80 visibles. La lectura persiste por empresa/usuario. Un cambio relevante de condición puede generar un nuevo aviso; el mero paso de minutos no lo vuelve a abrir.
- Un aviso promovido a Agenda no se duplica en AvImp. Se reconocen también las tareas automáticas de carga sin finalizar y entrega vencida. La promoción valida el aviso y el destinatario en servidor y es idempotente bajo bloqueo transaccional. Marcar leído no completa una tarea.
- Intelligence añade vencimientos y análisis económico mediante los servicios compartidos, más seis consultas guiadas según permisos. Devuelve fuentes, alcance, cobertura y enlaces obtenidos de los registros consultados, no URLs inventadas por el modelo. Sigue siendo de consulta: no envía reclamaciones ni cambia asignaciones. Planner solo se consulta si el producto está autorizado.

## Pruebas

Ejecutadas con scripts reales; los fixtures son sintéticos y locales:

| Comando | Resultado |
|---|---|
| Backend `npm run check` | Superado: permisos, tenant, geocodificación/HERE, agenda, IA, operativa, BI, facturación, Planner y chófer incluidos en el script |
| Backend `npm run security:regression` | Superado, incluidas las nuevas regresiones de avisos y las existentes de CORS Android, SSRF, SMTP y aislamiento |
| Backend `node scripts/notice_center_check.cjs` | Superado: dos empresas, permisos, estados fiscales, renovación documental, plataformas, conservación de configuración, Madrid/DST, 301 lecturas, usuarios independientes y referencias de IA verificadas |
| Backend `node scripts/operative_alert_http_check.cjs` | Superado: 301 avisos/80 visibles, leído global, parámetros manipulados, tareas activas/cerradas, promoción canónica, reintento sin duplicados, rechazo de destinatario de otra empresa |
| Backend `node scripts/intelligence_regression_check.js` | Superado: herramientas, validación, aislamiento y compatibilidad |
| Frontend `npm test -- --watchAll=false --runInBand` (`CI=true`) | 68 suites, 172 pruebas superadas |
| Frontend `npm run build` (`CI=false`) | Compilación de producción; se mantienen advertencias previas de lint/dependencias del proyecto |
| `git diff --check` | Sin errores de espacios en el cambio |

El primer intento local de `npm run check` encontró un `EPERM` del sandbox al crear procesos; el reintento autorizado terminó con código 0. Un intento de compilación con `CI=true` trata las advertencias existentes como errores; se emplea la configuración de build habitual `CI=false`. Un intento de preload Node con ruta Windows mal escapada falló antes de compilar y se corrigió usando barras `/`. Ninguno de esos intentos se presenta como prueba superada.

La primera ejecución de CI detectó que el fixture de auditoría invocaba reservas Planner sin declarar ese producto en el contexto del usuario. Se mantiene la denegación en servidor y se corrige el fixture: verifica rechazo para TransGest solo, y acceso con Planner explícitamente autorizado. La auditoría añade además ejecución de las dos nuevas herramientas sobre el esquema completo sintético.

## Verificación visual

`frontend/scripts/notice_center_preview.cjs` sirve el build real con una API exclusivamente sintética en `127.0.0.1`; no llama a producción ni se importa en el bundle.

- En navegador: «Ver factura» abre el detalle de `QA-2026-0072` con base 1.000 y total 1.210; no abre Avisos genéricos.
- «Leído» elimina el contador de 92 avisos del fixture. El caso completo de 301 se valida por HTTP real contra PGlite.
- Configuración: cambio de antelación, desactivar plataformas, guardar y comprobar que el listado pasa de tres avisos a dos.
- Intelligence: consulta guiada con proveedor simulado, respuesta estructurada, tabla, fuentes y enlace a la factura. No se han enviado datos operativos reales a un proveedor de IA en esta validación.
- Abrir ITV de remolque desde Dashboard: ficha del remolque y pestaña Documentación. Apertura de factura desde una referencia de Intelligence; selección explícita de la pestaña Facturas. Consulta guiada accesible con Enter.
- Revisión visual a 390, 768 y 1440 px: cabecera, pestañas desplazables, formulario y tarjetas sin desbordamiento horizontal de la página. Las tablas de respuestas permiten desplazamiento dentro de su contenedor.

## Migración y reversión

Nueva migración aditiva: `20260928_operational_alert_reads.sql`. Crea exclusivamente `avisos_operativos_leidos`, con clave `(empresa_id, usuario_id, alert_key)` y fecha de lectura. El despliegue debe ejecutar el mecanismo existente `npm run migrate` antes de atender tráfico. Los ensayos SQL son en memoria; no se crean clones de la base de producción.

La configuración reutiliza `empresas.cfg_alertas` con entradas `tipo_aviso`; se preservan las reglas de mantenimiento. La API antigua de mantenimiento preserva esas entradas, incluso ante una pantalla antigua abierta.

Reversión: desplegar el commit anterior de API y web. Conservar la tabla aditiva y la configuración; no borrar datos ni facturas. Los clientes antiguos siguen consumiendo los endpoints operativos anteriores y los nuevos campos son aditivos.

## Límites explícitos

- El centro no acredita conciliación bancaria ni pagos parciales: revisar la factura antes de reclamar. Un vencimiento futuro se etiqueta como próximo.
- No se ha validado el renderizado en un dispositivo físico iOS/Android; sí en viewport de navegador.
- La calidad lingüística de una respuesta del proveedor real de IA puede variar. La integración de herramientas, aislamiento y presentación se prueban con proveedor simulado y datos sintéticos.
- El ámbito temporal operativo existente de AvImp se mantiene (histórico de 60 días para colaboradores, 10 días para eventos de chófer). Eliminar el límite de 80 al marcar leído no amplía ese ámbito histórico.
- Una fuente de avisos inaccesible produce cobertura parcial/error visible, no ausencia de actividad confirmada.
