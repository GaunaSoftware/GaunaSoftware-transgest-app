# Roadmap Maestro TransGest TOP

Este documento es la cola oficial de trabajo para llevar TransGest a nivel top de mercado.

Reglas de ejecucion:

1. Se trabaja por bloques, de arriba hacia abajo.
2. No se abre un bloque nuevo mientras el bloque superior no este cerrado o suficientemente estabilizado.
3. Las nuevas ideas o peticiones se anaden a la cola, pero no rompen el orden salvo incidencia critica de produccion.
4. Cada bloque debe dejar:
   - datos persistidos en base de datos cuando afecte a operativa real;
   - permisos por empresa y por rol;
   - trazabilidad minima;
   - build frontend correcto;
   - validacion tecnica backend y prueba funcional minima.

## Leyenda

- Prioridad:
  - P0 = imprescindible para vender y operar con seguridad
  - P1 = muy importante para lanzamiento fuerte
  - P2 = diferencial competitivo
  - P3 = perlas de producto empresarial
- Complejidad:
  - B = baja
  - M = media
  - A = alta
  - X = muy alta
- Estado:
  - Pendiente
  - En curso
  - Estabilizando
  - Cerrado

## Cola maestra

### Bloque 1. Fiabilidad operativa end-to-end
Prioridad: P0
Complejidad: A
Estado: Cerrado

Objetivo: que el flujo real del negocio no falle ni deje datos a medias.

Incluye:

1. Pedidos -> Trafico -> Facturacion -> Cobro sin desincronizaciones.
2. Apertura de viajes desde cualquier vista sin perdida de fechas, horas, precios, estados ni asignaciones.
3. Prevencion de conflictos operativos:
   - mismo vehiculo en dos viajes solapados;
   - mismo chofer en dos viajes solapados;
   - pedidos facturados editables solo cuando proceda;
   - borradores y facturas finales diferenciados.
4. Historial operativo visible por pedido y por factura.
5. Eliminacion de mensajes genericos de error visibles para usuario final.
6. Refresco coherente entre pantallas sin depender de recargas manuales.
7. Revisiones completas de logs y salud backend/frontend.

Subbloques:

- 1.1 Estabilidad de Pedidos y Gestion de Trafico.
- 1.2 Cierre de Facturacion y Control de cobros.
- 1.3 Excepciones, alertas y errores operativos.
- 1.4 QA funcional de flujo critico.

Situacion actual:

- 1.1 cerrado.
- 1.2 cerrado.
- 1.3 cerrado.
- 1.4 cerrado tras ronda final de QA funcional.

Validacion de cierre realizada:

- login real con gerente demo;
- lectura y guardado de pedido ya creado;
- apertura de historial de pedido;
- creacion de factura borrador desde pedido entregado;
- cambio de factura a emitida y vuelta a borrador;
- eliminacion de borrador y limpieza de vinculo con pedido;
- cambio de estado de pedido y reversion;
- revision de logs sin 500 ni 504 persistentes en el flujo critico.

Observacion:

- la demo puede seguir mostrando errores de envio de email si no hay transporte SMTP operativo, pero el flujo de negocio ya no se rompe por ello.

### Bloque 2. Persistencia real y normalizacion de datos
Prioridad: P0
Complejidad: X
Estado: Cerrado

Objetivo: sacar del navegador cualquier dato critico que aun dependa de localStorage, caches viejas o JSON gigantes.

Incluye:

1. Taller, stock, EPIs, ropa de trabajo y tareas de mecanicos.
2. Estados auxiliares de choferes, vehiculos y ubicaciones temporales.
3. Configuraciones de empresa, nominas y parametros reutilizables.
4. Numeraciones documentales y relaciones entre documentos.
5. Migraciones versionadas y repetibles.

Situacion actual:

- EPIs por chofer sincronizados con `taller/estado`.
- Taller compartido ya persiste en backend:
  - proveedores;
  - avisos de mantenimiento;
  - tareas de mecanicos;
  - solicitudes de taller;
  - lucro cesante;
  - entregas de equipos a choferes.
- Ficha extendida de vehiculos ya persistida en backend mediante tabla auxiliar compartida.
- App chofer ya persiste en backend los pasos operativos del viaje (`carga`, `descarga`, `albaran`, `firma`) con cache local solo como apoyo/offline.
- Solicitudes de taller desde app chofer ahora priorizan backend como fuente principal y dejan la cola offline solo para falta real de conexion.
- GPS enviado por la app del chofer ya registra tambien posicion persistente sobre el vehiculo y en `gps_position_log`, incluyendo velocidad cuando el dispositivo la aporta.
- Entrada a taller y estado auxiliar de vehiculos ya se persisten en backend, con historial de eventos de estado por vehiculo.
- Vehiculos ya carga ficha y operativa desde backend sin depender de cache de session para pedidos auxiliares, y el modal muestra historial real de eventos del vehiculo.
- Vehiculos ya refresca resumen GPS y posiciones desde backend al recuperar foco y por intervalo suave, y los cambios manuales de GPS/ubicacion se propagan al momento a la lista sin depender de recarga completa.
- Taller ya inicializa proveedores, avisos, tareas, solicitudes y lucro desde backend/estado compartido, dejando el espejo local como apoyo y no como fuente principal.
- Neumaticos en Taller ya trabajan sobre estado compartido/backend para stock y montajes por vehiculo, en vez de depender de lecturas directas del navegador en cada accion.
- Avisos de mantenimiento en Taller ya calculan tambien las alertas de neumaticos desde `neumaticos_vehiculos` compartido, sin leer claves `tms_neumaticos_*` del navegador.
- Taller ya usa memoria compartida + backend como fuente principal para proveedores, avisos, tareas, solicitudes, neumaticos y entregas, reduciendo mas la dependencia de claves legacy dispersas en `localStorage`.
- Choferes ya usa el estado compartido de Taller como fuente principal para stock EPIS y entregas a choferes, eliminando copias paralelas locales de ese flujo.
- Dashboard, Avisos, Explotacion y Hojas de Ruta ya consumen backend/estado compartido como fuente principal para alertas, taller, repostajes, noches y configuracion operativa.
- La shell principal (`App`) ya calcula el badge de Taller desde backend/estado compartido, sin preleer solicitudes o tareas desde `localStorage`.
- Explotacion ya persiste los km en vacio en backend (`vehiculo_km_vacio`) y no en espejos locales por vehiculo.
- Nominas ya toma las noches/dietas por vehiculo desde la API real (`vehiculo_noches`) y no desde `tms_noches_*` en navegador.
- Nominas ya cruza jornadas registradas en la app del chofer con viajes, kilometros y noches del periodo, avisando cuando faltan datos de app para completar la hoja de ruta o la liquidacion manualmente.
- App chofer ya guarda lecturas de odometro en carga/descarga, actualiza `km_actuales` del vehiculo y calcula los km en vacio del siguiente pedido cuando existe descarga anterior y carga posterior del mismo camion.
- Palets ya trabaja backend-first para movimientos, almacen propio y almacen cliente, sin depender de los antiguos mirrors locales de movimientos y depositos.
- Informes ya consume taller y objetivos KPI desde backend, y guarda objetivos contra la API real en vez de `localStorage`.
- Gestion de Trafico ya toma `cfg_trafico` desde backend y deja de depender del merge antiguo con `tms_vehiculos_ext` para la carga principal de flota.
- Gestion de Trafico ya persiste en backend la posicion manual derivada de una entrega, en vez de guardar esa ultima ciudad solo en `localStorage`.
- App chofer ya arranca los pasos operativos del viaje priorizando backend y usa el espejo local solo como fallback real/offline; las solicitudes de mecanico limpian su cache local cuando backend vuelve a responder.
- App chofer ya mantiene los espejos de pasos del viaje y solicitudes de mecanico en memoria de runtime, importando y limpiando automaticamente los restos legacy de `localStorage` en vez de seguir dejandolos persistidos ahi tras cada uso normal.
- Colaboradores ya persiste en backend los pagos y documentos del colaborador, dejando atras las copias locales por ficha.
- Pedidos ya persiste en backend el panel de pago al colaborador por viaje, incluyendo factura recibida y fechas de pago, en vez de guardarlo solo en navegador.
- Importacion de tarifas ya crea rutas/tarifas reales por cliente mediante API, en lugar de dejarlas como un listado local efimero en el navegador.
- `useChoferConfig` y `NominaCalculadora` ya trabajan backend-first para configuracion de chofer y listado de nominas, sin depender de caches locales por chofer.
- Gestion de Trafico ya deja de leer `cfg_trafico` desde `localStorage` y usa backend/memoria de sesion como fuente real.
- Pedidos e Informes ya leen combustible/precios desde `empresa/config` y migran automaticamente las ultimas configuraciones legacy (`tms_gasoil_cfg`, `tms_combustible_cfg`) si seguian en el navegador.
- Pedidos ya trata los puntos de interes con cache en memoria + API como fuente principal y migra automaticamente los restos legacy de `tms_puntos_interes` cuando existian.
- Palets ya toma la configuracion de precios por defecto desde `empresa/config` (`cfg_precios.palets`) y migra `tms_palets_cfg` al backend si aun quedaba en el navegador.
- Taller ya trata `tms_taller_v1` como importacion legacy puntual y espejo en memoria, dejando de escribirlo como almacenamiento operativo principal y limpiandolo cuando backend sincroniza correctamente.
- Taller ya no relee `tms_taller_v1` desde `localStorage`: ese mirror legacy queda solo en memoria de runtime para compatibilidad transitoria, con backend como fuente real y sin volver a persistir operativa de taller en el navegador.
- Taller ya no usa helpers genericos de lectura/escritura contra `localStorage` para stock y reparaciones: el mirror legacy de `tms_taller_v1` queda solo en memoria del runtime y backend sigue siendo la fuente operativa real.
- Empresa, logoHelper y la cache auxiliar de API ya priorizan memoria de sesion/ventana para perfil, SMTP y logo, dejando `localStorage` como rescate legacy y limpiandolo cuando backend ya es la fuente valida.
- La capa base de API, `planFeatures` y `App` ya priorizan caches de ventana para token, usuario, bloqueo y suscripcion, reduciendo lecturas calientes de `localStorage` en la sesion activa.
- `SuperAdmin`, `Bloqueado`, `ErrorBoundary` y `logoHelper` ya priorizan caches vivas/funciones comunes de sesion para impersonacion, cierre de sesion y branding, dejando menos credenciales y restos calientes en `localStorage`.
- Los focos de navegacion entre `Avisos`, `Excepciones`, `Pedidos`, `Facturacion`, `Taller`, `Vehiculos`, `Choferes` y `Gestion de Trafico` ya viven en memoria de runtime con importacion/limpieza automatica del viejo `sessionStorage`, reduciendo mas dependencia del navegador para estados auxiliares de UI operativa.
- `Vehiculos` ya hidrata la ubicacion mostrada con la ultima posicion real de `gps_position_log` cuando esa traza es mas fresca que la ficha base, reduciendo dependencia de estados auxiliares desactualizados.
- `Vehiculos` ya usa respuestas hidratadas del servidor para cambios de estado, enlace GPS, posicion manual y guardado de ficha, reduciendo mas el optimismo local y la dependencia de refrescos completos para consolidar estado auxiliar.
- `Taller` ya mantiene su mirror legacy solo en memoria del modulo, sin colgarlo tambien de `window`.
- `SuperAdmin` ya migra su sesion propia a cache de ventana + `sessionStorage`, dejando `localStorage` solo como import legacy puntual.
- `Empresa` ya trata `tms_avisos_empresa` como migracion legacy de una sola vez y la limpia al persistir `cfg_alertas` real en backend.
- `Taller` ya borra piezas e intervenciones contra endpoints reales de backend y recarga el estado normalizado despues de guardar o eliminar, reduciendo mas la dependencia del espejo local para stock y reparaciones.
- `Taller` ya sincroniza tambien la edicion de intervenciones contra backend real, no solo el alta y cierre, cerrando otro hueco donde seguia mandando demasiado el estado local.
- `Taller` ya acepta tambien estados vacios del backend como fuente real y deja de reinyectar datos antiguos del mirror local cuando servidor devuelve listas vacias, cerrando un borde peligroso del Bloque 2.
- `historial_vh` de `Taller` ya forma parte del estado compartido real y viaja con la sincronizacion backend-first del modulo, en vez de quedar como resto semilocal al registrar mantenimientos por vehiculo.
- QA funcional reciente del bloque:
  - `Vehiculos` abre y navega sin errores de consola visibles.
  - `GET /vehiculos/:id` responde correctamente con detalle valido y ya rechaza IDs invalidos con error limpio, sin dejar rechazos sin manejar ni timeouts aguas arriba.
  - `Taller > Stock` mantiene correctamente el estado vacio tras recarga, sin resucitar datos legacy.
  - `Taller > Solicitudes choferes` carga y muestra pendientes sin errores de consola visibles.
  - `taller/estado` devuelve ya `historial_vh` dentro del estado compartido real del modulo.

### Bloque 3. Cumplimiento legal y fiscal
Prioridad: P0
Complejidad: X
Estado: En curso

Objetivo: dejar el programa listo para operar con exigencia legal real.

Incluye:

1. VERIFACTU por empresa:
   - configuracion por empresa;
   - readiness;
   - cola fiscal;
   - webhook;
   - sincronizacion manual;
   - conector real de proveedor.
2. SII por empresa sobre la misma base.
3. Documento de Control Digital:
   - soporte operativo;
   - app chofer;
   - cliente;
   - colaborador;
   - remision formal.
4. Clausulas de combustible y documentos de transporte alineados con normativa vigente.
5. Facturacion, reclamaciones y trazabilidad documental.

Situacion actual:

- La prueba de canal fiscal ya devuelve diagnostico estructurado tambien para `SII` y `VERIFACTU directo`, validando endpoint, formato de URL, uso de HTTPS en produccion y presencia de certificado, aunque el conector real siga pendiente.
- La ultima prueba fiscal ya queda guardada por empresa y visible en `Empresa` y `SuperAdmin`, incluyendo fecha/hora, checks, issues y señal de vigencia (`reciente`, `conviene revisar`, `caducada`).
- El `readiness` fiscal ya tiene en cuenta la vigencia de la ultima prueba: si falta, conviene revisarla o esta caducada, el estado fiscal lo refleja automaticamente y en produccion puede bloquear el `production_ready`.
- Cada empresa ya conserva un historial corto de pruebas fiscales recientes para soporte y despliegue, visible tanto en `Empresa` como en `SuperAdmin`.
- `Empresa` y `SuperAdmin` ya muestran un resumen corto de cola fiscal (aceptados, pendientes, errores y ultimos atascos), para detectar incidencias sin tener que entrar primero en Facturacion.
- La vista de factura ya resume mejor la salud del documento fiscal (aceptacion, encadenado, huella, UUID y reintentos), para que soporte y administracion entiendan el estado sin leer eventos crudos.
- `Empresa` y `SuperAdmin` ya muestran mejor los documentos fiscales recientes, incluyendo referencia aceptada, UUID de proveedor y siguiente reintento cuando existe, para una lectura ejecutiva mas util sin entrar siempre en Facturacion.
- Los resumenes fiscales ya distinguen tambien documentos `atascados`, separando lo pendiente normal de lo que necesita intervencion mas directa en soporte o administracion.
- `SuperAdmin` ya puede actuar sobre la cola fiscal de una empresa desde soporte: reencolar documentos atascados y sincronizar envios VERIFACTU/Verifacti con UUID de proveedor sin entrar como usuario de la empresa.
- `SuperAdmin` ya permite procesar una tanda controlada de cola fiscal de una empresa desde soporte, con auditoria y resumen de aceptados, diferidos y errores.
- `Empresa` queda normalizada sin BOM, sin mojibake visible y sin iconografia informal en sus textos de configuracion fiscal/email/avisos, manteniendo el build limpio.
- La tabla principal de `Facturacion` ya deja leer mejor el semaforo fiscal por documento, incluyendo aceptacion, error o pendiente con detalle corto y siguiente reintento cuando existe, sin necesidad de abrir cada factura.
- El Documento de Control Digital ya registra eventos de apertura, impresion, descarga, copia y comparticion desde `Pedidos` y `AppChofer`, dejando trazabilidad en el historial del viaje.
- La zona de escaneo de albaranes de `AppChofer` queda reparada y funcional: carga/descarga guardan el tipo correcto, el nombre del archivo sale limpio y el flujo de pasos vuelve a compilar.
- `Pedidos` ya permite buscar/crear colaborador desde el propio pedido, autocompletar puntos guardados en cargas/descargas y fuerza coste de gasoil a 0 cuando el viaje lo carga un colaborador, tambien desde backend.
- `Pedidos` ya calcula km mediante el optimizador backend y el proveedor configurado, con fallback local OSRM/Nominatim sin depender de llamadas sueltas del navegador.
- `Clientes` ya normaliza y persiste horarios partidos de carga/descarga como `08:00-13:30; 15:00-18:00`, con validacion tambien en backend.
- `Pedidos` ya sanea UUIDs de cliente/ruta/vehiculo/chofer/remolque/colaborador en frontend y backend, guarda `remolque_id` al editar y devuelve error limpio si una asignacion ya no existe.
- `Mi Empresa` ya separa condiciones de pago de clientes y colaboradores; la orden de carga de transporte propio imprime la forma de pago del servicio y la orden de colaborador mantiene sus condiciones propias.
- La orden de carga refuerza instrucciones operativas, carga lateral/trasera, intercambio de palets, cinchas y clausula de revision de combustible con referencia legal documentada.
- El Documento de Control Digital ya incorpora condiciones de pago, operativa de carga y clausula de combustible, y sus checks avisan si faltan hora/ventana de carga o descarga.
- Facturacion ya descarga el justificante fiscal como HTML imprimible, con resumen ejecutivo, comprobaciones, ultimos envios, eventos fiscales y metadatos de software, en vez de entregar solo JSON tecnico.
- Facturacion ya permite descargar un informe HTML de control de cobros, con resumen de vencidas/reclamadas/sin cobrar, politica activa, proximas revisiones y facturas en riesgo.
- El Documento de Control Digital ya permite marcar formalmente la remision desde la orden de carga, con confirmacion del usuario y evento `documento_control.remitido` aceptado por backend.
- La remision formal del Documento de Control Digital ya queda protegida: si faltan datos obligatorios, el backend devuelve bloqueo 409 con faltantes y solo gerencia puede confirmar expresamente la remision incompleta, dejando score y faltantes en el historial.

### Bloque 4. Seguridad, aislamiento y auditoria
Prioridad: P0
Complejidad: A
Estado: Cerrado

Objetivo: que una empresa nunca vea ni toque datos de otra, y que toda accion critica quede trazada.

Incluye:

1. Permisos finos por rol en todos los modulos.
2. Auditoria completa por usuario, accion, modulo y resultado.
3. Revisiones de endpoints multiempresa.
4. Rate limit, secretos, CORS y despliegue seguro.
5. Historial visible para gerencia de acciones criticas.

Situacion actual:

- El registro de actividad de gerencia ya consume la auditoria SaaS filtrada por `empresa_id`, con metodo, ruta, modulo, estado, request id y criticidad normalizados desde backend.
- La pantalla de actividad ya permite filtrar por criticidad (`critica`, `alta`, `media`, `baja`) y muestra un semaforo para priorizar errores, borrados y cambios sensibles.
- La autenticacion ya normaliza `req.empresaId` para todos los endpoints autenticados, reduciendo variaciones entre rutas y haciendo mas consistente el aislamiento por empresa.
- Los permisos configurables de `Usuarios y Roles` ya cubren los modulos backend reales que faltaban, incluyendo agenda, actividad, almacen/palets, grupajes, colaboradores, IA, excepciones y portal cliente.
- Las funcionalidades premium quedan bloqueadas tambien en backend por plan: IA solo Enterprise, rutas/optimizacion para Profesional/Enterprise e informes avanzados fuera del plan basico.
- Rutas y tarifas ya valida empresa/cliente antes de leer o escribir precios y repartos auxiliares, evitando tocar relaciones de otra empresa aunque se conozca un identificador interno.
- Los enlaces publicos de ruta recomendada ya actualizan apertura/aceptacion comprobando tambien el token hash, no solo el identificador interno del envio.
- El filtro de criticidad de actividad ya busca con margen interno antes de recortar el limite visible, evitando que se oculten eventos criticos recientes por el paginado inicial.
- El historial de tractoras/remolques por chofer ya queda aislado por empresa tanto al consultar como al cerrar el periodo activo anterior, validando tambien que chofer y vehiculos pertenezcan a la empresa.
- Portal cliente ya valida estados, decisiones y vinculacion de pedidos antes de editar solicitudes desde gestion, impidiendo enlazar una solicitud a un pedido de otra empresa o de otro cliente.
- El detalle de pedidos ya lee los extracostes cruzando contra el pedido validado por empresa, no solo por `pedido_id`.
- El detalle de facturas ya lee lineas y extracostes cruzando contra la factura validada por empresa, homogeneizando el aislamiento de datos auxiliares.
- La auditoria legacy de cambios de estado de factura ya incorpora `empresa_id`, indice por empresa/factura y filtrado compatible con historico anterior.
- Informes ya refuerza joins de clientes y vehiculos con `empresa_id` explicito en dashboard, cobros y rendimiento por chofer.
- Usuarios y roles ya valida que cualquier `cliente_id` vinculado pertenezca a la empresa y solo se use en usuarios de rol cliente; tambien evita que un gerente desactive su propia cuenta.
- Los enlaces publicos del Documento de Control Digital ya usan tokens HMAC con comparacion constante, manteniendo compatibilidad transitoria con enlaces emitidos con el token anterior.
- El webhook de Stripe ya rechaza eventos sin firma en produccion si no hay `STRIPE_WEBHOOK_SECRET`, manteniendo tolerancia solo en entornos no productivos.
- El backend ya normaliza permisos base por rol al autenticar: los modulos nuevos dejan de quedar abiertos por omision si un usuario antiguo no tenia reglas explicitas.
- Notificaciones queda protegida por el permiso de `avisos`, igual que la pantalla de roles.
- Portal cliente ya aplica permisos diferenciados: `portal-cliente` para usuarios cliente y `solicitudes` para las rutas internas de gestion.
- Login y `/auth/me` ya devuelven permisos normalizados por rol; el menu frontend deja de mostrar modulos sin regla explicita cuando existen permisos configurados.
- El plan basico ya no muestra `excepciones`, evitando que el usuario entre en una pantalla dependiente de informes avanzados bloqueados por plan.
- El fallback frontend de permisos por rol queda alineado con los identificadores reales de modulos, para que sesiones antiguas no recuperen nombres legacy como `docs` o `facturas`.

### Bloque 5. Portales externos profesionales
Prioridad: P1
Complejidad: A
Estado: En curso

Objetivo: que cliente y colaborador puedan trabajar de verdad sin romper operativa interna.

Incluye:

1. Portal cliente:
   - solicitudes;
   - reprogramacion;
   - seguimiento;
   - descarga documental;
   - DCD;
   - aislamiento por empresa.
2. Portal colaborador:
   - confirmacion;
   - matriculas;
   - carga/en camino/descarga;
   - adjuntos;
   - DCD;
   - orden de carga.
3. App chofer:
   - pasos operativos;
   - incidencias;
   - albaranes tipo escaner;
   - solicitudes taller;
   - cierre de sesion;
   - mejoras moviles.

Situacion actual:

- Portal cliente ya abre y descarga el Documento de Control Digital desde la URL real devuelta por backend, incluyendo enlaces construidos en `remision.download_url`.
- Portal cliente ya mantiene seguimiento, solicitudes, reprogramacion, albaranes, facturas y DCD aislados por cliente/empresa.
- Portal cliente ya permite abrir una factura emitida con lineas, extras, viajes vinculados, documentos e impresion/guardado en PDF desde una ruta aislada por cliente y empresa.
- Portal cliente ya permite descargar un resumen HTML de sus solicitudes, con referencias, estados, pedidos convertidos y respuestas de gestion; tambien se limpia iconografia/mojibake visible del seguimiento.
- Portal colaborador ya muestra un resumen operativo del transporte en confirmar, carga, en camino y descarga, con fechas, horas, mercancia, peso, matriculas y precio cuando corresponde.
- Portal proveedor ya puede abrir desde cada viaje el Documento de Control Digital/eCMR/eFTI-ready, con enlace publico tokenizado, descarga del soporte y traza de consulta en el historial del pedido.
- El soporte publico del DCD ya registra consulta, descarga o impresion segun el uso real del enlace, mejorando la trazabilidad del portal de colaborador/cliente.
- App chofer ya evita romper el modal de incidencias cuando todavia no hay imagen adjunta, manteniendo el alta de incidencias operativa.
- App chofer ya sincroniza la cola offline por elemento, sin bloquear toda la cola si una accion falla, e informa al conductor cuando se suben acciones pendientes.
- Solicitudes de taller desde app chofer ya muestran estados legibles, respuesta de taller, orden de trabajo y ultimos eventos; el backend evita duplicar/notificar solicitudes repetidas al resincronizar offline.
- Usuarios de rol chofer ya pueden vincularse a una ficha de chofer y a su matricula habitual; la app muestra viajes por chofer asignado o por vehiculo/matricula asignada al viaje.
- App chofer ya incorpora registro interno de jornada con inicio/cierre, km inicial/final, actividades, noche fuera y avisos operativos basados en 4h30 de conduccion, pausa de 45 minutos y limites diarios.
- Plan basico y permisos frontend quedan alineados con los bloqueos backend antes de profundizar en portales externos.

### Bloque 6. Operativa avanzada de trafico
Prioridad: P1
Complejidad: A
Estado: Cerrado

Objetivo: que trafico pueda mover volumen con criterio profesional.

Incluye:

1. Grupajes dentro de trafico, sin duplicidades.
2. Optimizacion de rutas con proveedor real y experiencia limpia.
3. Rutas recomendadas a chofer y colaborador.
4. ETA dinamico, tiempos de parada, km en vacio y consumo.
5. Autoasignacion y alertas de conflicto.
6. Prefacturas asistidas y sugerencia automatica de precio segun tarifa.

Situacion actual:

- Gestion de trafico ya muestra un resumen operativo semanal con viajes, asignaciones incompletas, conflictos, pendientes de completar, kilometros en vacio, rutas sin kilometros y viajes de colaborador.
- El resumen operativo semanal ya es accionable: cada metrica aplica su filtro correspondiente, incluyendo km en vacio y rutas sin kilometros.
- El resumen de trafico ya incluye control economico semanal: margen total, viajes sin precio y viajes con margen negativo, con filtros directos y aviso dentro de cada tarjeta de viaje.
- Al editar un viaje desde trafico ya se propone la tarifa existente por origen, destino y cliente, con recargo de combustible y minimos, y se puede aplicar al importe del viaje desde el propio modal.
- El cuadrante ya mantiene avisos criticos plegables y marcables como leidos, evitando que la pantalla se llene de alertas persistentes.
- Ya existen conflictos operativos por solape de recursos, acciones rapidas por estado, retraso por dias, copia semanal y agrupacion por cliente.
- Plan diario queda disponible como cuadrante operativo por fecha: cruza vehiculos, remolques, choferes, pedidos del dia, avisos de documentacion, taller/mantenimiento, agenda y notas manuales persistidas por camion/dia.

### Bloque 7. Taller, almacen y suministros
Prioridad: P1
Complejidad: A
Estado: En curso

Objetivo: profesionalizar el backoffice fisico y tecnico.

Incluye:

1. Intervenciones propias y externas limpias y sin duplicidades.
2. Stock de piezas, neumaticos, EPIs y ropa de trabajo.
3. Etiquetas, codigos de barras y escaneo.
4. Entregas de EPIs con firma y registro documental.
5. Solicitudes de taller desde chofer conectadas al taller real.
6. Multi-almacen.

Situacion actual:

- Taller ya tiene stock con categoria ROPA DE TRABAJO, EPIS, codigos de barras, etiquetas imprimibles y escaneo.
- Intervenciones ya distinguen taller propio/externo, crean el taller externo si no existe y evitan duplicar proveedor/importe de factura como dos conceptos separados.
- Solicitudes de chofer ya llegan al taller real con estados, respuesta, eventos y posibilidad de abrir orden de trabajo.
- Entregas de EPIs a chofer ya validan stock disponible antes de registrar, descuentan unidades de forma controlada y generan documento numerado con firma/confirmacion del receptor.
- Se ha limpiado el texto visible principal de Taller para evitar mojibake e iconos informales en categorias, KPIs, stock, intervenciones, neumaticos, solicitudes y tareas.

### Bloque 8. Almacen logistico y palets
Prioridad: P1
Complejidad: M
Estado: En curso

Objetivo: cerrar bien la operativa de almacen, palets y devoluciones.

Incluye:

1. Palets por cliente y por obra sin inconsistencias.
2. Devoluciones editables hasta confirmacion real.
3. Importe de devolucion, albaran y factura borrador.
4. Alertas de antiguedad y almacenamiento. Estado: Implementado; Palets muestra lotes con 14+ dias pendientes, criticos desde 30 dias, palets afectados y coste estimado si hay precio de almacenaje configurado. Dashboard Ejecutivo tambien muestra estas alertas para gerencia.
5. Almacenes multiples y movimientos historicos.

Situacion actual:

- Las devoluciones de palets quedan editables mientras estan pendientes y pasan a bloqueo de edicion al confirmar la salida real, evitando cambios posteriores sin trazabilidad.
- Las entradas y devoluciones de palets nuevas ya requieren cliente propietario valido desde backend, y las devoluciones tambien exigen numero de albaran antes de registrarse, reforzando la separacion por cliente y la trazabilidad documental.
- La vista `Dev. Cliente` ya genera informe HTML imprimible/guardable por cliente con lineas separadas, totales y filtro por periodo.
- La pantalla `Palets / cliente` y el historial ya imputan los movimientos por `propietario_cliente_id`, evitando que registros normalizados por backend queden fuera del cliente o aparezcan como cliente desconocido.
- Las devoluciones preparadas ya no descuentan ni limpian alertas de antiguedad hasta confirmar la salida real; el resumen backend tambien las deja con impacto cero hasta confirmacion.
- La vinculacion de factura en devoluciones de palets ya queda blindada en backend: solo acepta facturas borrador de la misma empresa y del mismo cliente propietario.
- Al eliminar una factura borrador vinculada a devoluciones de palets, el backend desvincula tambien esos movimientos para evitar referencias a facturas inexistentes.
- QA funcional cubre registros separados por cliente y fecha, mas el flujo de devolucion: creacion pendiente, edicion antes de confirmar, confirmacion con fecha real y bloqueo de edicion posterior.

### Bloque 9. Nominas y personas
Prioridad: P1
Complejidad: A
Estado: En curso

Objetivo: que la parte laboral sea util, seria y no un duplicado confuso.

Incluye:

1. Nominas generadas una a una, con persistencia y reutilizacion de parametros.
2. Historial de nominas emitidas.
3. Caducidades y documentacion de choferes.
4. Historial real de vehiculos usados por cada chofer.
5. Preparacion para revision asistida por IA.

Situacion actual:

- Configuracion laboral por chofer y nominas emitidas quedan reforzadas con validacion de pertenencia a la empresa antes de leer, guardar o emitir.
- QA funcional cubre el flujo base de nominas: lectura de configuracion del chofer, historial filtrado, emision temporal, aparicion en historial y borrado limpio.

### Bloque 10. KPI, direccion y cuadro de mando
Prioridad: P1
Complejidad: M
Estado: En curso

Objetivo: que gerencia vea la empresa en tiempo real y pueda decidir bien.

Incluye:

1. Dashboard ejecutivo.
2. Informes de gestion con KPI avanzados por plan.
3. Rentabilidad por cliente, ruta, vehiculo y colaborador.
4. Facturacion prevista vs real.
5. Alertas de margen, tiempos muertos, km en vacio y retrasos.

Situacion actual:

- Informes de gestion ya cruza objetivos KPI configurados con datos reales del periodo: facturacion, pedidos, kilometros totales, porcentaje de kilometros en vacio, coste de taller y margen estimado.
- QA funcional valida la estructura ejecutiva de gestion, incluyendo desviaciones frente a objetivos y salud operativa.

### Bloque 11. Integraciones por empresa
Prioridad: P1
Complejidad: X
Estado: En curso

Objetivo: integrarse con el ecosistema real de cada cliente sin mezclar credenciales.

Incluye:

1. HERE por empresa.
2. GPS por empresa:
   - Locatel;
   - Tacogest;
   - Movildata;
   - generico.
3. IA por empresa, compatible con distintos proveedores.
4. SMTP/correo transaccional por empresa o global controlado.
5. Stripe y planes de suscripcion.
6. Mapeo matricula-dispositivo GPS.

Situacion actual:

- Mi Empresa ya dispone de endpoint de estado de integraciones por empresa, saneado y sin secretos, para rutas/HERE/ORS, GPS, IA, SMTP y Stripe.
- QA funcional valida que el estado de integraciones devuelva estructura operativa, resumen booleano por area y que no exponga claves API, tokens hash ni secretos SMTP/Stripe.

### Bloque 12. Superadmin y gestion SaaS
Prioridad: P1
Complejidad: A
Estado: En curso

Objetivo: operar TransGest como software SaaS serio.

Incluye:

1. Alta y bloqueo de empresas.
2. Facturacion del programa, no la de los clientes.
3. Integraciones por empresa desde superadmin.
4. Impersonacion segura.
5. Marcadores de cobro, estados de suscripcion y bloqueo por impago.
6. Backups y restauracion gestionados por superadmin.

Situacion actual:

- SuperAdmin ya dispone de resumen agregado de salud SaaS: empresas por color, activas/no activas, bloqueadas, vencidas, proximas a vencer, backups pendientes, usuarios activos y pedidos 30 dias.
- La pestaña Salud de SuperAdmin ya muestra tarjetas ejecutivas con el resumen SaaS y listas cortas de empresas criticas o en seguimiento antes de la tabla de detalle.
- QA funcional valida el resumen de salud SaaS cuando hay credenciales de superadmin disponibles, sin bloquear el despliegue de empresa si no estan configuradas.

### Bloque 13. UX, consistencia visual y copy
Prioridad: P2
Complejidad: M
Estado: En curso

Objetivo: que el programa se sienta uniforme, claro y profesional en todas las pantallas.

Avance reciente: Documentos, Choferes, Avisos, Clientes, Colaboradores, Dashboard, Explotacion y Cuadrantes revisados en copy visible, sin mezcla de iconos informales y con mojibake corregido en los textos principales.

Incluye:

1. Eliminar mojibake.
2. Eliminar mezcla de emoticonos y estilos incoherentes.
3. Homogeneizar titulos, botones, tablas, avisos y modales.
4. Estados vacios y de carga.
5. Modo oscuro mejor equilibrado.

### Bloque 14. QA, monitorizacion y despliegue
Prioridad: P2
Complejidad: A
Estado: En curso

Objetivo: reducir sustos, incidencias y regresiones.

Incluye:

1. Smoke tests criticos.
2. Tests end-to-end de login, pedidos, facturacion, taller y portales.
3. Monitorizacion de errores y logs utiles.
4. Checklist de despliegue y restauracion.

Avance reciente: anadido smoke de despliegue publico (`npm run deploy:smoke`) para validar health, frontend servido por Nginx y proxy protegido de API tras cada build. Documentado el checklist operativo en `docs/QA_DESPLIEGUE.md`, incluyendo functional check autenticado contra `http://localhost`.

Avance GPS/API: reforzada integracion Movildata con prueba real de `Users/GetVehiculos`, sincronizacion por `Users/GetLastLocations`, parseo flexible de matriculas/IMEI/posiciones, diagnostico de vehiculos remotos no encontrados, proveedores GPS restantes preparados como webhook/API externa y limpieza de clave propia restaurando modo global.

### Bloque 15. Diferenciales TOP de mercado
Prioridad: P3
Complejidad: X
Estado: En ejecucion avanzada

Objetivo: pasar de producto serio a producto memorable y muy competitivo.

Incluye:

1. Torre de control operativa:
   - excepciones por retraso, paralizacion, falta de documentacion, margen bajo, GPS sin senal y viajes sin asignar;
   - bandeja unica de incidencias con responsable, estado, SLA, comentario y resolucion;
   - propuesta de accion desde cada alerta.

Avance reciente Control Tower/Bandeja:

- La bandeja de excepciones ya permite resolver manualmente una incidencia con nota de cierre, ademas de revisar, posponer, reasignar y reabrir; el informe HTML incluye la nota operativa del estado.
- Control Tower ya devuelve acciones recomendadas estructuradas por senal (reasignar, notificar cliente, adjuntar soporte, reclamar cobro, revisar GPS, simular margen) y las muestra en el dashboard para orientar la decision.
- Las acciones recomendadas del Control Tower ya son accionables desde el dashboard: abren gestion de trafico, facturacion o vehiculos con foco contextual y la accion elegida.
2. Facturacion y cash-flow de nivel mercado:
   - wizard previo de revision de factura, albaran, referencia, lineas, impuestos y adjuntos;
   - envio de factura con PDF adjunto real y log de entrega;
   - pagos a colaboradores con ordenes de pago, vencimientos, factura recibida, documentacion y conciliacion;
   - prevision de tesoreria cliente/proveedor.
3. Portales externos:
   - portal cliente con pedidos, documentos, facturas, estados y solicitudes;
   - portal colaborador con ordenes, confirmacion, documentacion, factura y pagos;
   - acceso seguro por token y trazabilidad completa de aperturas/descargas.
4. App chofer avanzada:
   - jornada, conduccion, pausas, descansos, noches, km inicial/final, firma y albaranes;
   - secuencia de viaje paso a paso sin mostrar acciones futuras;
   - avisos legales y operativos a trafico/gerencia.
5. Rutas y tarifas inteligentes:
   - tarifas por cliente, vehiculo/remolque, minimo, combustible, tonelada, hora o cerrado;
   - importacion Excel/PDF asistida por IA;
   - deteccion de incompatibilidad entre ruta y remolque;
   - margenes por ruta, cliente, vehiculo y colaborador.
6. Integraciones de mercado:
   - GPS/telematica real con diagnostico por proveedor;
   - HERE/ORS para kilometros y tiempos;
   - email, contabilidad, bancos, EDI/API para clientes grandes;
   - conectores preparados con estado de salud visible.
7. IA documental y operativa:
   - lectura de facturas, albaranes, nominas, documentos de vehiculo, vencimientos y EPIS;
   - clasificacion y archivo con revision humana;
   - resumen de riesgos e inconsistencias.
8. KPIs predictivos:
   - margen por viaje, ruta, cliente, chofer, camion y colaborador;
   - km en vacio, EUR/km, rendimiento, absentismo, taller y coste por vehiculo;
   - avisos de bajada de rendimiento y recomendaciones.
9. Calidad empresarial:
   - pruebas end-to-end de flujos criticos;
   - monitor de salud con codigo de seguimiento consultable;
   - auditoria, permisos, backup/restauracion y checklist de despliegue.

Analisis de mercado 2026:

- Los TMS/fleet punteros compiten por integraciones, tracking, portales, auditoria economica, automatizacion de excepciones y analitica. TransGest ya cubre muchas bases, pero para posicionarse como producto top necesita cerrar mejor los flujos completos y reducir el trabajo manual.
- Nueva estimacion de avance con criterio "top mercado": 82-85% completado. Queda aproximadamente 15-18% de trabajo real, concentrado en conectores externos reales, pruebas visuales con usuarios, QA multiempresa con datos reales y estabilizacion final de IA operativa.
- Estimacion temporal al ritmo actual de pasadas intensivas: 2-4 semanas para una beta comercial muy fuerte, 5-8 semanas para un cierre top con QA profundo y estabilizacion, y 8-12 semanas si se incluyen conectores externos reales, contabilidad/EDI, OCR certificado y pruebas con datos de varios clientes.

## Orden de ejecucion actualizado por benchmark TOP

El estudio comparativo 2026 reordena el trabajo pendiente para competir no solo como TMS, sino como plataforma de decision para pymes y medianas flotas europeas.

Orden actual de ejecucion:

1. Rentabilidad predictiva y pricing operativo.
   - margen esperado por pedido antes de aceptar o asignar;
   - coste estimado vs real;
   - recomendacion aceptar/revisar/subcontratar/buscar retorno;
   - margen por cliente, ruta, vehiculo, chofer y colaborador.
2. Automatizacion documental-cobro.
   - POD/albaran obligatorio segun cliente;
   - facturas bloqueadas por falta documental;
   - reclamaciones y avisos automaticos;
   - conciliacion entre entrega, documento, factura y cobro.
3. Control Tower TOP.
   - vistas Hoy, Riesgos y Rentabilidad;
   - incidencias con accion recomendada;
   - retrasos, margen bajo, GPS sin senal, falta documental y cobros bloqueados.
4. Scoring de clientes y colaboradores.
   - puntualidad, esperas, incidencias, margen, calidad documental y pagos;
   - alertas antes de aceptar pedidos de bajo rendimiento.
5. Cumplimiento europeo avanzado.
   - eCMR/eFTI-ready;
   - firma electronica avanzada;
   - datos maestros obligatorios;
   - tacografo, cabotaje, ADR, ZBE y reglas por pais.
6. Sostenibilidad y CO2.
   - CO2 por viaje, ruta, cliente y vehiculo;
   - base ISO 14083/GLEC;
   - simulacion de emisiones antes de aceptar cargas.
7. IA operativa accionable.
   - copiloto sobre datos reales;
   - preguntas de riesgo, margen, cobro y documentos;
   - recomendaciones con permiso y confirmacion.
8. Integraciones y red colaborativa.
   - GPS/ETA predictiva;
   - WhatsApp/email inteligente;
   - OCR documental;
   - cargas de retorno, marketplace y carriers verificados.

Los bloques 1-14 anteriores se mantienen como base operativa ya construida o en estabilizacion. A partir de ahora, el Bloque 15 se ejecuta siguiendo este orden porque es el que mas acerca TransGest al posicionamiento "copiloto operativo y financiero para empresas de transporte".

## Trabajo en curso ahora mismo

Bloque activo: Bloque 15 - Diferenciales TOP de mercado

Subbloque activo:

- 15.7 IA operativa accionable y Bandeja IA de pedidos;
- 15.8 Integraciones y red colaborativa: EDI/API cliente, portal cliente/feed, marketplace interno y diagnostico de APIs;
- 15.5 Cumplimiento europeo avanzado: DCD, eIDAS, eFTI/eCMR y DIWASS/eAnnex VII;
- hardening SaaS final: TransGestAdmin, aislamiento multiempresa, QA de despliegue y salud de APIs.

Estado consolidado tras cambios externos revisados el 2026-06-03:

- Los frentes 15.1 a 15.6 ya no estan como foco principal: rentabilidad, cobros/documentos, Control Tower, scoring, cumplimiento preventivo y CO2 tienen base operativa y QA funcional parcial o completo.
- El foco actual pasa a convertir esas bases en producto diferencial: IA que crea pedidos desde documentos, trazabilidad visible, integraciones B2B/EDI, firma/evidencia auditable, salud SaaS y conectores reales.
- La Bandeja IA ya es una subpestana operativa en Pedidos, con historial, estado de proveedor visual, documentos de texto/imagen/PDF, avisos de faltantes y paso trazado a pedido real.
- Integraciones B2B/EDI avanzan desde "preparacion" a contrato usable: feed JSON, manifiesto tecnico, credenciales `tedi_...`, scopes, rate limit, auditoria y uso visible en Mi Empresa.
- TransGestAdmin concentra cada vez mas la operacion SaaS: salud multiempresa, salud de APIs, gestion de claves/cuotas y diagnosticos por empresa.
- Pendiente inmediato recomendado: usar el programa en operativa diaria controlada, validar visualmente Bandeja IA/EDI/firma con usuarios reales, ejecutar `npm run daily:ready` al iniciar jornada y `npm run qa:deploy` despues de cada despliegue, y cerrar conectores externos reales donde haya API disponible.

Ultimos avances:

- Dashboard ya calcula alertas de taller, documentacion y empresa con datos de backend (`vehiculos`, `taller_estado`, `cfg_alertas`) sin depender de `tms_vehiculos_ext`, `tms_taller_v1` ni marcas locales de entrada a taller.
- Avisos ya usa backend como fuente principal para reparaciones y configuracion de avisos de mantenimiento, y la configuracion se guarda en `empresa.cfg_alertas` en lugar de `localStorage`.
- Explotacion ya carga reparaciones y costes de taller desde `taller/estado` compartido, dejando `localStorage` solo para el registro legacy de km en vacio que aun queda por migrar.
- Hojas de Ruta ya usa backend como fuente principal para taller, gasoil, repostajes y noches, eliminando las caidas habituales a caches locales antiguas.
- Explotacion ya persiste `km en vacio` en backend (`vehiculo_km_vacio`) y deja de depender de `tms_km_vacio_*` como almacenamiento operativo principal.
- App de chofer, Mi Cuenta, Bloqueado y la prueba SMTP de Empresa ya reutilizan la capa comun de token/cache (`getToken`) en lugar de leer credenciales crudas desde `localStorage`, reduciendo incoherencias de sesion entre modulos.
- Pedidos ya sustituye el retraso por dias basado en prompt nativo por un modal propio con validacion, y pedido rapido permite crear viajes sin asignar con multiples puntos de carga y descarga.
- Palets ya permite editar movimientos creados mientras no tengan factura vinculada, con confirmacion previa y bloqueo limpio desde backend si el movimiento ya esta facturado.
- Rutas y tarifas ya evita duplicidades incorrectas: las rutas quedan aisladas por empresa y pueden coexistir para el mismo origen/destino cuando cambia el cliente o tipo de vehiculo, mostrando tambien precio final con recargo de combustible.
- Rutas y tarifas ya normaliza minimos segun tipo de tarifa en backend, importacion y rutas de cliente: en tarifas por tonelada un minimo `24000` se guarda como 24 toneladas/unidades y no como importe minimo facturable; QA funcional crea y limpia una ruta temporal para evitar regresiones.
- Documentos ya deja mas trazable el volcado asistido por IA: muestra campos detectados, propone nombre de archivo archivistico y marca en el historial si el documento tiene archivo registrado.
- Nominas ya incorpora un diagnostico preparatorio de transparencia retributiva por categoria disponible, con alertas internas a partir del 5%, campos laborales pendientes e informe imprimible.
- Pedidos ya persiste la base sin combustible, el porcentaje de recargo y el importe de revision; la factura borrador generada automaticamente desglosa la revision de combustible en linea separada.
- El Documento de Control Digital ya incorpora hora/ventana de carga y descarga, enlaces de Google Maps y todos los puntos de carga/descarga cuando el pedido tiene varias paradas.
- El Documento de Control Digital ya genera exportacion JSON estructurada eFTI/eCMR-ready con identificadores, partes, ruta, mercancia, readiness, sobre de firma pendiente y hash SHA-256 de integridad; Pedidos permite descargarla desde la orden de carga y QA funcional valida el contrato.
- El Documento de Control Digital refuerza el acceso de inspeccion: los enlaces publicos llevan token y codigo de verificacion, la pagina se sirve con noindex/no-store y la exportacion eFTI/eCMR incluye el bloque de verificacion auditable.
- El Documento de Control Digital incorpora preparacion DIWASS/eAnnex VII: fechas 2026, senal automatica de posibles residuos, indicio transfronterizo, datos requeridos si aplica y bloque `waste_annex_vii` dentro de la exportacion interoperable.
- La firma de entrega ya guarda evidencia tecnica interna preparatoria eIDAS: hash SHA-256 de la firma, firmante, ruta, IP, user-agent, actor, origen de captura, fecha e integrity hash; existe endpoint de consulta y QA funcional valida la estructura.
- Mi Empresa/Integraciones ya expone diagnostico de firma electronica avanzada/eIDAS por empresa: proveedores de firma saneados, datos maestros, Documento de Control Digital, dominio QR, canal fiscal, faltantes y siguiente accion sin revelar secretos; la pantalla Mi Empresa lo muestra junto al DeCA y QA funcional valida el contrato.
- La app de chofer ya muestra en el bloque DCD el resumen de horarios, paradas y accesos a Maps antes de abrir, imprimir, descargar o compartir el soporte.
- La app de chofer queda limpia de mojibake visible y textos rotos en viajes, DCD, asistencia mecanica, offline/PWA y cabecera movil.
- Facturacion permite descargar un justificante fiscal JSON por factura, con registro, eventos y envios saneados para soporte/auditoria sin exponer secretos de integracion.
- Los endpoints fiscales de Empresa y Facturacion ya devuelven configuracion saneada al navegador: las claves Verifacti y secretos webhook quedan enmascarados y se preservan al guardar si el usuario no introduce una clave nueva.
- Facturacion ya incorpora prevision de tesoreria cliente/proveedor por vencido, 0-7, 8-30 y 31-60 dias, cruzando facturas pendientes con pagos a colaboradores y mostrando neto de los proximos 30 dias.
- Portal cliente avanza en seguimiento real: cada viaje ya puede desplegar actividad operativa saneada desde `pedido_eventos`, y QA funcional valida el acceso autenticado del cliente a pedidos, facturas, documentos, solicitudes y actividad por viaje.
- Portal cliente incorpora resumen ejecutivo desde backend con viajes activos, facturas pendientes/vencidas, documentacion, solicitudes y acciones pendientes enlazadas a cada pestana; QA funcional valida el contrato autenticado.
- Informes incorpora recomendador inicial de cargas de retorno/red interna: cruza camiones que descargan con pedidos proximos que cargan desde la misma zona, prioriza oportunidades, estima km vacio evitable, lista viajes sin retorno y zonas con demanda; la accion abre Gestion de Trafico con foco contextual y QA funcional valida el contrato.
- Scoring operativo evoluciona a verificacion de carriers/colaboradores: cruza datos maestros, documentacion del proveedor, vehiculos, incidencias, facturas y pagos para etiquetar cada carrier como verificado, condicionado o bloqueado antes de asignarle mas viajes; Informes lo muestra y QA funcional valida el contrato.
- Retornos ya conecta red interna con carriers verificados: el informe de cargas de retorno incluye colaboradores recomendados, score, estado apto/condicionado/bloqueado, bloqueantes y siguiente accion para subcontratacion controlada cuando no convenga usar flota propia.
- Retornos ya prepara solicitud operativa para carrier: desde una oportunidad genera preflight con destinatario, bloqueantes, avisos, asunto y cuerpo de email para revisar disponibilidad antes de asignar o enviar el flujo de colaborador; QA funcional valida el contrato.
- Retornos ya permite enviar la solicitud al carrier con bloqueo por datos/documentos criticos, plantilla de email propia, registro en email_log/audit_log/pedido_eventos y notificacion interna a gerencia/trafico para trazabilidad de subcontratacion.
- Retornos permite elegir el carrier recomendado por cada oportunidad antes de preparar o enviar la solicitud, evitando que trafico use siempre el primer proveedor apto por defecto cuando hay varios colaboradores posibles.
- Retornos incorpora bandeja de solicitudes recientes a carriers: guarda cada solicitud enviada/simulada como registro propio, la muestra en Informes con pedido, carrier, ruta, estado y fecha, y QA funcional valida el contrato de datos.
- Retornos incorpora workflow basico de respuesta de carrier: las solicitudes pueden marcarse como respondidas, asignadas o descartadas desde Informes, quedando trazadas en pedido_eventos/audit_log con notas y fecha de respuesta.
- Mi Empresa incorpora checklist de puesta en marcha comercial: backend calcula score operativo vendible con datos reales de empresa, usuarios, clientes, flota/colaboradores, choferes, SMTP, facturacion, DCD, soporte documental, cobros y cola fiscal; la UI muestra bloqueantes, avisos, metricas y acciones prioritarias, con QA funcional.
- Rentabilidad predictiva arranca en backend y UI de pedido: cada viaje calcula ingreso, coste, margen, EUR/km, riesgos y recomendacion ejecutiva con QA funcional, preparando el dato para Control Tower, Informes y futuro copiloto.
- Rentabilidad operativa ya esta agregada en Informes: resume ingreso, coste, margen, EUR/km, datos incompletos, riesgos economicos/documentales y clientes a revisar por margen, con contrato funcional validado.
- Automatizacion documental-cobro incorpora bloqueos visibles en Gestion financiera: pedidos entregados sin POD/albaran/CMR, facturas con soporte pendiente y cobros en riesgo documental, con endpoint y QA funcional.
- Control Tower arranca en Dashboard con feed priorizado desde backend: mezcla trafico retrasado, asignaciones incompletas, margen bajo/sin precio, POD pendiente, cobros en riesgo y GPS sin senal, con KPIs de hoy y QA funcional.
- Control Tower ya abre el pedido con contexto de la alerta y acciones directas: reasignar, notificar al cliente con email trazado desde el pedido, saltar a documentos o facturacion segun el tipo de riesgo; QA funcional valida el preflight de aviso sin enviar emails reales.
- Control Tower ya excluye pedidos con cualquier factura vinculada de las senales operativas y KPIs de trafico, planificacion, margen, documentacion e incidencias; QA funcional cruza el feed contra pedidos con `factura_id` para evitar regresiones incluso si la factura sigue en borrador.
- Dashboard/Control Tower ya muestra estados operativos con etiquetas saneadas (`En ruta`, `En descarga`, etc.) y sus alertas de palets solo descuentan devoluciones confirmadas, no salidas preparadas.
- Control Tower TOP avanza con vistas separadas `Todas`, `Hoy`, `Riesgos`, `Rentabilidad` e `Incidencias`, marcadas desde backend por cada senal para que el dashboard no dependa de filtros visuales improvisados; QA funcional valida el contrato.
- Copiloto operativo inicial queda disponible en Dashboard: genera briefing accionable desde datos reales de trafico, cobros, documentos, margen, asignaciones y GPS, sin depender todavia de proveedor LLM externo; QA funcional valida el contrato.
- Copiloto operativo ya incorpora playbooks y accesos rapidos por prioridad, llevando al usuario a trafico, facturacion, informes, vehiculos u optimizacion con contexto de la accion recomendada.
- Facturacion pasa a mostrarse como Gestion financiera, con selector interno de area de trabajo para facturas de clientes, seguimiento de cobros y pagos/tesoreria; el capital actual de caja/bancos se administra desde Mi Empresa > Tesoreria con autorizacion reforzada de gerente y superadmin, y se usa para calcular saldo previsto a 30 dias.
- El asistente de facturacion ya revisa referencias, albaranes/documentos, importes cero y diferencias entre lineas editadas y total de pedidos antes de crear el borrador.
- Pagos a proveedores ya bloquea el marcado como pagado accidental cuando faltan factura o documentacion, exigiendo confirmacion explicita.
- Facturacion ya permite descargar un informe HTML de tesoreria con resumen por plazo, proximos movimientos, cobros pendientes y pagos previstos a colaboradores/proveedores.
- Portal cliente ya incorpora una pestaña de estado de cuenta con deuda corriente/vencida por antiguedad, acceso directo a facturas y descarga de informe HTML para administracion del cliente.
- Portal cliente ya carga un resumen documental desde backend para sus viajes: albaranes disponibles/pendientes, documentos totales y documentos de factura, visible sin abrir viaje por viaje.
- Portal cliente ya permite descargar un informe HTML de resumen documental con viajes revisados, albaranes disponibles/pendientes, documentos de viaje y documentos de factura.
- Colaboradores ya permite descargar una liquidacion HTML por colaborador desde Viajes y facturas, cruzando viajes, facturas recibidas, pagos registrados, pendiente de factura y pendiente de pago.
- Colaboradores ya puede generar un enlace publico seguro y caducable de liquidacion para el colaborador, con token hasheado, caducidad y primera apertura registrada.
- Colaboradores ya muestra una bandeja interna de ultimos enlaces de liquidacion generados, indicando caducidad y si el colaborador ya lo ha abierto.
- Colaboradores ya permite revocar enlaces publicos de liquidacion activos desde la bandeja interna, manteniendo el historial de creacion/apertura y cortando el acceso inmediatamente.
- Colaboradores ya permite enviar por email un enlace seguro de liquidacion desde Viajes y facturas, usando SMTP/logs del programa, generando token caducable y dejando trazabilidad para revisar apertura o revocar.
- El portal publico de liquidacion de colaboradores ya incorpora acuse de recibo/revision: el colaborador puede confirmarlo desde el enlace y administracion ve el estado Confirmado/Revisado en la bandeja interna.
- El portal publico de liquidacion de colaboradores y el informe interno ya incluyen documentacion registrada, caducidades y avisos de documentos caducados/proximos sin exponer archivos ni contenido sensible.
- El portal publico de liquidacion de colaboradores ya permite descargar el informe HTML desde el propio enlace y registra fecha, IP, user-agent y contador de descargas, visible despues para administracion.
- El portal publico de liquidacion de colaboradores ya muestra semaforo administrativo de facturas vencidas, vencimientos a 7 dias y facturas sin numero, y QA funcional comprueba tambien el acuse de revision.
- Portal proveedor/colaborador arranca sobre enlaces seguros: cada colaborador puede revisar viajes y liquidacion, ver albaranes de sus viajes, subir albaranes/POD/CMR por pedido y dejar trazabilidad/notificacion interna; QA funcional valida subida, listado, descarga y limpieza.
- Portal cliente refuerza los albaranes de viaje con descarga directa segura por documento, manteniendo aislamiento por cliente/empresa y QA funcional con albaran temporal.
- Portal proveedor permite subir facturas recibidas vinculadas a un viaje desde el enlace seguro, descargarlas despues, notificar a administracion y dejarlas en estado pendiente de revision; QA funcional valida subida, descarga y limpieza.
- Portal proveedor bloquea la subida de factura si el viaje no tiene albaran/POD/CMR adjunto, obligando a respetar el flujo documental antes de generar deuda con el colaborador.
- Portal cliente muestra tambien los albaranes/POD/CMR de los viajes incluidos dentro del detalle de factura, con enlaces de descarga directa aislados por cliente.
- Portal cliente trata albaran, POD y CMR como soporte documental descargable tambien desde la ficha del viaje y el resumen documental, registrando en el historial del pedido cada descarga realizada por el cliente.
- Portal proveedor ya expone un estado claro de sus facturas recibidas (pendiente de revision, vencida, vence pronto, revisada o pagada), ofrece endpoint publico seguro para consultarlas y registra en el historial del pedido cada descarga de factura realizada por el proveedor.
- Portal proveedor ya expone tambien un endpoint publico seguro de pagos, con resumen de total por viajes, facturado, pagado, pendiente de factura, pendiente de pago, pagos registrados y facturas pendientes para que el colaborador pueda consultar su estado financiero sin llamadas manuales.
- Portal proveedor ya expone un endpoint publico seguro de documentacion administrativa del colaborador, con semaforo de documentos caducados, proximos 30 dias y sin caducidad para reducir llamadas y anticipar bloqueos documentales.
- Portal proveedor ya expone un endpoint publico seguro de vehiculos del colaborador, incluyendo ITV, seguro, tacografo y tarjeta de transporte con semaforo de caducidad para anticipar bloqueos antes de asignar o ejecutar viajes.
- Portal proveedor ya dispone de un resumen ejecutivo publico seguro que consolida viajes, soporte documental, facturas, pagos, documentos administrativos, vehiculos y acciones priorizadas para abrir el portal con "que revisar hoy".
- La pagina publica del portal proveedor ya muestra directamente prioridades, avisos de vehiculos y tabla de vehiculos con documentacion, usando los mismos semaforos del resumen para que el colaborador vea los bloqueos sin depender de endpoints separados.
- Portal proveedor ya permite descargar un informe HTML de acciones pendientes con prioridades, viajes sin soporte documental, facturas en riesgo, documentacion administrativa y documentacion de vehiculos; QA funcional valida descarga y contenido.
- Colaboradores ya muestra internamente las mismas acciones pendientes del proveedor en `Viajes y facturas`, con endpoint propio para administracion/trafico y QA funcional de riesgos documentales.
- Colaboradores ya permite descargar internamente el informe HTML de acciones pendientes del proveedor sin crear enlace publico, con descarga autenticada y QA funcional de contenido.
- Portal proveedor ya permite subir documentacion administrativa general desde el enlace publico seguro, guardar archivo adjunto, notificar a administracion y descargarlo despues desde el mismo portal.
- QA funcional ya comprueba el flujo publico de liquidacion de colaborador: creacion de enlace, apertura sin token interno, descarga HTML trazada, reflejo del contador en administracion y revocacion del enlace.
- Colaboradores ya permite revisar liquidaciones enviadas y generar avisos internos de seguimiento cuando un enlace lleva mas de 48h sin abrirse o mas de 72h abierto sin acuse, evitando duplicados con marcas de aviso persistidas.
- La ficha de colaborador ya incorpora semaforo de riesgo de pago a proveedor: facturas vencidas, vencimientos en 7 dias, facturas sin vencimiento y facturas sin numero, tambien reflejado en el informe HTML de liquidacion.
- El flujo publico de colaborador ya registra trazabilidad DCD cuando se remite por email y cuando el colaborador consulta confirmar/carga/camino/descarga, visible despues en el historial del pedido.
- El soporte publico del Documento de Control Digital ya registra tambien aperturas y descargas reales desde el enlace con token, diferenciando consulta y descarga en el historial del pedido.
- La confirmacion de descarga del colaborador deja trazabilidad documental mas completa: registra numero de adjuntos y metadatos saneados de albaranes sin guardar contenido pesado en el historial.
- El flujo publico del colaborador ya genera acuses descargables/imprimibles al confirmar transporte, carga, salida hacia destino y descarga, sin romper los tokens de un solo uso.
- El historial de pedidos y el modal de trafico ya muestran mejor los eventos DCD, incluyendo canal, accion, codigo, origen y documentos adjuntos sin exponer contenido sensible.
- Informes ya incorpora scoring operativo de clientes y colaboradores, combinando margen, cobros, incidencias, documentacion, facturas/pagos pendientes y accion recomendada para priorizar revisiones comerciales u operativas.
- Scoring operativo ya incorpora decision previa a aceptar mas viajes: aceptacion normal, condicionada o con autorizacion de gerencia, controles obligatorios y condiciones recomendadas para clientes/colaboradores de riesgo; Informes lo muestra como prioridades y QA funcional valida el contrato.
- Informes ya incorpora diagnostico de datos maestros para DCD/eCMR/eFTI: score por clientes, colaboradores, choferes y vehiculos, faltantes obligatorios, acciones recomendadas y QA funcional para evitar regresiones antes de activar firma o integraciones certificadas.
- El Documento de Control Digital ya incorpora checklist preventivo de cumplimiento operativo por viaje: senales ADR, ZBE/accesos urbanos, internacional/eCMR/eFTI, cabotaje/subcontratacion y tacografo/horas, tambien incluido en la exportacion interoperable y cubierto por QA funcional.
- Informes ya dispone de una bandeja de cumplimiento europeo preventivo para viajes proximos: resume senales ADR, ZBE, internacional, cabotaje y tacografo, prioriza viajes con riesgo y devuelve acciones recomendadas para trafico/gerencia antes de confirmar o asignar.
- La bandeja de cumplimiento europeo queda visible en Informes con pestana propia, KPIs de senales, acciones recomendadas, tabla de viajes a revisar y apertura directa en Gestion de Trafico con foco contextual.
- Pedidos incorpora Bandeja IA de pedidos: interpreta texto/email/orden de carga, detecta cliente, origen/destino, fechas, matricula, mercancia, precio, ruta/tarifa existente, conflictos y campos pendientes antes de abrir el borrador editable.
- Bandeja IA queda preparada para IA visual con la API configurada en SuperAdmin: imagenes y PDF se envian al proveedor disponible, se extraen campos estructurados cuando hay respuesta valida y se mantiene fallback local si no hay clave o el documento no devuelve JSON fiable.
- Bandeja IA registra trazabilidad tecnica de cada analisis (`ai_inbox_runs`): proveedor, estado, confianza, adjuntos saneados, issues, warnings y sugerencias, sin devolver ni persistir base64 en el historial de soporte.
- Pedidos muestra ya el historial reciente de la Bandeja IA dentro del modal de creacion: fecha, estado, proveedor/local, confianza, adjuntos y pendientes, con QA funcional sobre el endpoint de runs.
- Pedidos incorpora la Bandeja IA como subpestana propia dentro de la pantalla de Pedidos, y el backend interpreta tambien documentos no fotograficos con texto: PDF de texto, TXT/EML/HTML/XML/CSV y DOCX/XLSX basicos sin depender de OCR visual.
- Pedidos normaliza toneladas/peso tanto en frontend como backend: `25,6` o `25.6` se interpreta como 25,6 t / 25.600 kg, evita importes tipo `10024`, y permite pago a colaborador por tonelada con minimo facturable propio y margen calculado contra ese coste.
- Informes ya incorpora un primer modulo de sostenibilidad/CO2 operativo: estima emisiones por viaje, cliente, vehiculo y ruta con base preparatoria ISO 14083/GLEC, separando viajes sin km para no falsear reporting.
- Mi Empresa ya permite configurar consumo medio de flota, factor kg CO2/litro y nota metodologica para que el reporting CO2 use parametros propios de la empresa en vez de un valor fijo.
- Informes ya permite descargar un informe HTML de CO2 con resumen, metodologia, ranking por cliente, vehiculo y ruta, y aviso de viajes sin kilometros para licitaciones o reporting ESG inicial.
- Sostenibilidad/CO2 ya genera acciones ESG priorizadas: viajes sin km, exceso de km en vacio, clientes con mayor intensidad y rutas con retorno deficiente, visibles en Informes y cubiertas por QA funcional.
- Gestion de Trafico queda limpiada en las zonas visibles principales de tarjeta/modal: flechas, euros, acentos rotos, dias y textos de guardado ya no aparecen con mojibake.
- Pedidos queda limpiado en las zonas visibles principales de edicion, costes, asignacion, carta de porte/CMR, firma y paginacion, dejando fuera solo comentarios internos antiguos.
- Palets y almacen queda limpiado de mojibake visible en resumen, historial, devoluciones, almacen propio/cliente, albaranes e informes de almacenaje; tambien se corrigen textos e importes para salida profesional.
- Palets/almacen ya filtra los ultimos movimientos de mercancia propia por almacen seleccionado y por origen propia desde backend, evitando mezclar entradas/salidas de otros almacenes o depositos de clientes.
- En movimientos de mercancia propia se muestra el almacen de cada entrada/salida, para que la vista "Todos los almacenes" sea auditable de un vistazo.
- Almacen refuerza integridad de stock: un movimiento no puede imputarse a un almacen distinto al de la mercancia y las salidas quedan bloqueadas si no hay stock suficiente; QA funcional lo verifica contra la API.
- Palets refuerza la separacion por cliente tambien en backend: entregas y devoluciones exigen cliente propietario valido de la empresa, y las devoluciones exigen numero de albaran para poder registrarse; QA funcional valida ambos bloqueos.
- Palets corrige la imputacion visual por cliente en `Palets / cliente` e `Historial`, usando el cliente propietario normalizado por backend y no solo el antiguo `cliente_id`.
- Palets alinea stock y alertas con el flujo real: una devolucion preparada no altera stock ni alertas hasta que se confirma la salida; QA funcional valida que el resumen backend solo descuenta al confirmar.
- Palets refuerza la trazabilidad factura-devolucion: la API impide vincular facturas de otro cliente, de otra empresa o no borrador, y QA funcional valida una vinculacion correcta con factura borrador real.
- Facturacion refuerza la limpieza de borradores: al borrar una factura borrador se limpian referencias en pedidos y en movimientos de palets, evitando registros que parezcan facturados con factura inexistente.
- QA funcional de palets valida el caso operativo de `Dev. Cliente`: dos entradas del mismo cliente en dias distintos se conservan como dos registros separados con sus cantidades y fechas.
- `Dev. Cliente` ya permite generar un informe HTML imprimible/guardable con registros separados por cliente, fechas, albaranes, referencias, estados, cantidades e importes.
- `Dev. Cliente` ya permite filtrar por periodo desde/hasta y el informe HTML respeta ese rango, facilitando cierres mensuales o revisiones por cliente.
- Nominas ya muestra correctamente el historial persistido desde backend normalizando los importes planos de la API a los campos de calculo de la pantalla, y el borrado elimina tambien la nomina en base de datos.
- Nominas queda saneada en textos principales de la calculadora/historial, sin iconografia informal ni restos mojibake en botones, titulos, secciones e importes visibles.
- Informes de gerencia queda saneado en pestañas, cabeceras y objetivos KPI, eliminando iconografia informal y signos propensos a mojibake; QA funcional verifica tambien la ruta de objetivos KPI.
- Portal cliente ya muestra el historial de eventos de cada solicitud para el propio cliente, filtrado por empresa/cliente y sin exponer rutas internas de administracion.
- Portal cliente ya permite descargar un acuse HTML individual por solicitud con datos clave, estado, respuesta de gestion e historial trazable.
- Portal cliente ya destaca propuestas de reprogramacion pendientes de aceptar/rechazar y las incluye en el resumen HTML de solicitudes con fecha, hora y decision.
- Portal cliente ya muestra resumen de movimientos por solicitud y ultimo evento directamente en el listado y en el informe HTML descargable, sin obligar al cliente a abrir el historial para saber si ha habido gestion.
- La ficha de cliente ya muestra tambien movimientos y fecha del ultimo evento en las solicitudes recibidas desde portal, para soporte/gerencia sin saltar a otra pantalla.
- Solicitudes clientes ya permite descargar un informe HTML interno filtrado con resumen, SLA de +24h, estado, pedido vinculado y respuesta/nota para seguimiento de trafico y gerencia.
- Solicitudes clientes ya muestra trazabilidad resumida de movimientos en el listado interno y en el informe HTML: numero de eventos y fecha del ultimo movimiento sin abrir cada historial.
- Torre de control/Excepciones ya incorpora SLA por prioridad, contador de incidencias fuera de plazo y etiqueta por incidencia con horas objetivo/abiertas; QA funcional cubre tambien la ruta de excepciones.
- Torre de control/Excepciones ya permite descargar un informe HTML filtrado con resumen, responsables, accion recomendada y SLA por incidencia para seguimiento de gerencia.
- El informe HTML de Torre de control/Excepciones ya incluye mis tareas, resueltas en 7 dias y primera/ultima deteccion por incidencia, mejorando seguimiento de SLA y responsabilidades fuera de la app.
- QA funcional de despliegue ya verifica tambien fronteras de permisos y rutas sensibles: sin token debe responder 401, el portal cliente debe bloquear a perfiles internos con 403 y las rutas de solicitudes/colaboradores/agenda no deben devolver 500.
- QA funcional ya valida la estructura operativa de Torre de control/Excepciones: resumen, SLA por incidencia y workflow activo, evitando regresiones silenciosas en la bandeja ejecutiva.
- QA funcional ya valida el Documento de Control Digital sobre un pedido real cuando existe: codigo de control, readiness, checks, normativa 2026/2027 y remision descargable.
- QA funcional ya valida la configuracion fiscal de empresa y la cola fiscal resumida, comprobando `production_ready`, checks, registros recientes/cola y que las claves Verifacti no vuelvan al navegador sin enmascarar.
- QA funcional ya valida la estructura de control de cobros y pagos pendientes a colaboradores, protegiendo los datos que alimentan Gestion financiera y la prevision de tesoreria.
- QA funcional ya valida el diagnostico GPS de empresa: proveedores disponibles, conteos de enlaces/senal, duplicados, vehiculos sin senal y ayuda operativa para incidencias GPS.
- QA funcional ya valida la bandeja de solicitudes de backup y que las empresas no puedan ejecutar ni descargar backups directamente fuera de TransGestAdmin.
- QA funcional ya valida la auditoria de actividad de gerencia: estructura enriquecida, totales y filtro de criticidad para que soporte y direccion no pierdan trazabilidad.
- QA funcional ya valida el contrato base del optimizador de rutas: proveedores configurables, rechazo de paradas insuficientes y consulta de ultima ruta/envios por pedido sin depender de servicios externos.
- QA funcional ya valida el bloque de correo/SMTP sin enviar emails reales: configuracion saneada, log, rechazo de test sin destinatario y preflight de envio de factura.
- QA funcional ya valida puntos guardados para pedidos/rutas: creacion, reutilizacion de duplicados por direccion, filtro por tipo/busqueda y borrado logico.
- Bloque 8 avanza: QA funcional ya valida el ciclo de devolucion de palets pendiente/editable, confirmada con fecha real y bloqueada ante edicion posterior.
- Bloque 9 avanza: QA funcional ya valida configuracion laboral por chofer y el ciclo de nomina emitida temporal, con aislamiento por empresa en backend.
- Bloque 10 avanza: Informes de gestion ya compara objetivos KPI contra datos reales del periodo y QA funcional valida desviaciones ejecutivas.
- Bloque 11 avanza: Mi Empresa ya expone diagnostico saneado de integraciones por empresa y QA funcional comprueba estructura y ausencia de secretos.
- Bloque 12 avanza: SuperAdmin ya tiene resumen agregado de salud SaaS y QA funcional opcional para validar operacion multiempresa.
- Bloque 12 avanza tambien en UI: la pestaña Salud de SuperAdmin muestra resumen ejecutivo SaaS y prioridades de soporte sin entrar empresa por empresa.
- QA funcional ya valida que las solicitudes del portal cliente mantengan trazabilidad resumida (`eventos_count` y `ultimo_evento_at`) en la API interna de gestion, evitando regresiones en listados e informes.
- Documento de Control Digital avanza hacia firma eIDAS: cada pedido puede descargar un paquete JSON de firma avanzada con payload canónico, firmantes, politica eIDAS, evidencias existentes y hashes SHA-256; QA funcional valida estructura y hashes para evitar regresiones antes de conectar proveedor real.

- Bandeja IA de pedidos mejora su historial como bandeja operativa: cada analisis devuelve prioridad, accion recomendada, datos detectados, faltantes y alertas, para que trafico sepa si puede abrir el borrador o debe completar datos antes de crear el pedido.
- Bandeja IA refuerza la carga de documentos: selector visible, arrastrar y soltar, limite ampliado y avisos claros cuando un documento escaneado requiere API visual configurada.
- Bandeja IA expone estado operativo sin secretos: modo basico local siempre disponible, deteccion de proveedor visual configurado y guia visible para distinguir documentos de texto frente a imagenes/PDF escaneados.
- Bandeja IA refuerza el paso a pedido real: la previsualizacion avisa cuantos documentos se adjuntaran y al guardar queda trazado el origen IA con confianza, estado, adjuntos y proveedor visual sin persistir contenido sensible.
- La trazabilidad visible del pedido ya traduce el evento de creacion desde Bandeja IA con origen, documento, confianza, estado, adjuntos y proveedor visual, para que trafico y gerencia puedan auditar el alta sin entrar en soporte tecnico.
- Orden de carga/ruta recomendada evita duplicar visualmente carga o descarga cuando el nombre del punto y la direccion son iguales, especialmente en viajes copiados desde puntos guardados.
- Ordenes de colaborador incorporan previsualizacion interna autenticada antes de enviar el enlace, con regla economica blindada: precio cerrado no imprime importes y pago por tonelada solo imprime EUR/tn y minimo acordado cuando ambos estan configurados; QA funcional valida ambos casos.
- Firma/eIDAS avanza en salida operativa: ademas del paquete JSON tecnico, Pedidos permite descargar un informe HTML de evidencia de firma con firmante, origen de captura, hashes SHA-256, integridad y nota legal preparatoria para auditoria.
- Firma/eIDAS incorpora control postfirma: la evidencia guarda hash del contexto firmado y el informe compara origen, destino y fechas actuales para advertir cambios posteriores sensibles antes de auditoria o remision.
- Firma/eIDAS registra trazabilidad automatica cuando se modifica origen, destino o fechas despues de firmar, mostrando el aviso en el historial del pedido y validandolo con QA funcional sobre un pedido temporal firmado.
- Firma/eIDAS eleva los cambios postfirma a notificacion interna de gerencia con deduplicacion por pedido y hash del contexto actual, evitando que una modificacion sensible quede solo como historial pasivo.
- Pedidos/orden de carga muestra aviso visible de integridad de firma cuando hay cambios postfirma, indicando los campos afectados y recomendando descargar el informe de evidencia antes de remitir o auditar.
- La remision formal del Documento de Control Digital queda bloqueada si la firma tiene cambios posteriores sensibles, salvo confirmacion expresa de gerencia; el backend devuelve los campos afectados y deja trazada la confirmacion cuando se permite continuar.
- Retornos/marketplace interno avanza de seguimiento a accion: al marcar una solicitud de carrier como asignada, el backend intenta asignar el pedido al colaborador si sigue libre y sin factura, registra evento/auditoria/notificacion y devuelve si la asignacion fue aplicada o bloqueada por conflicto operativo.
- Mi Empresa/Integraciones incorpora diagnostico EDI/API cliente B2B: score, checks y faltantes para clientes con contacto, portal cliente, DCD/eFTI exportable, SMTP, soporte documental, fiscalidad y URL publica, sin exponer secretos y con QA funcional del contrato.
- Portal cliente incorpora feed JSON autenticado `transgest.portal_cliente.feed.v1` para integraciones B2B/EDI preliminares: exporta viajes, facturas y metadatos documentales sin base64 ni secretos, incluye hash de integridad y registra trazabilidad de exportacion en los pedidos.
- El feed EDI/API del portal cliente incorpora bloque de gobierno de datos y auditoria SaaS especifica por exportacion (`EXPORT portal_cliente.integracion_feed`), con export id, contadores, ventana, hash de integridad y QA funcional de trazabilidad.
- Mi Empresa/Integraciones ya muestra el uso real auditado del feed EDI/API cliente: ultimo export, muestra de exports, clientes, viajes/facturas/documentos exportados, hash de integridad y gobierno de metadatos sin binarios ni secretos.
- El feed EDI/API del portal cliente ya soporta sincronizacion incremental con `since` ISO y devuelve bloque `sync` con modo, cursor siguiente y compatibilidad delta, reduciendo descargas completas para clientes integrados.
- Portal cliente incorpora manifiesto tecnico EDI/API descargable (`transgest.portal_cliente.manifest.v1`) con autenticacion, endpoints, parametros, contrato de campos, flujo delta recomendado, gobierno de datos, ejemplos y hash de integridad.
- Clientes/Portal incorpora credenciales tecnicas EDI/API por cliente (`tedi_...`) con hash en servidor, mascara, caducidad, ultimo uso, revocacion, auditoria SaaS y compatibilidad directa con manifesto/feed sin login manual.
- Las credenciales tecnicas EDI/API ya aplican scopes reales (`manifest`, `feed`): el backend bloquea el acceso fuera de alcance, la ficha cliente muestra los permisos concedidos y QA funcional valida token solo-manifest contra feed denegado.
- Seguridad EDI/API reforzada: los tokens tecnicos `tedi_...` quedan limitados exclusivamente a endpoints de integracion y no pueden abrir resumen, pedidos, facturas, solicitudes ni otras rutas del portal cliente humano.
- Las credenciales tecnicas EDI/API incorporan contadores de uso, ventana horaria y limite por token para detectar integraciones abusivas o sincronizaciones demasiado frecuentes; la ficha cliente muestra consumo y QA funcional valida los campos.
- Los endpoints tecnicos de manifest/feed ya devuelven cabeceras `X-RateLimit-Limit`, `X-RateLimit-Remaining` y `X-RateLimit-Reset`, documentadas en el manifiesto para que ERPs/clientes externos puedan sincronizar sin ir a ciegas.
- Mi Empresa/Puesta en marcha ya permite descargar un informe HTML de salida comercial con score, bloqueantes, avisos, metricas y checklist completo, util como acta de go-live para gerencia/implantacion y validado por QA funcional.
- Mi Empresa/Puesta en marcha incorpora control de continuidad: estado de solicitudes de backup inicial, metricas de pendientes/resueltos, aviso dentro del checklist y accion de gerente para solicitar backup de salida gestionado por TransGestAdmin.
- Cumplimiento europeo incorpora DIWASS/eAnnex VII como senal propia de alto riesgo: detecta indicios de residuos, expone datos requeridos si aplica, lo muestra en Informes y QA funcional valida el contrato.
- TransGestAdmin/Salud incorpora diagnostico multiempresa de implantacion: gerente activo, usuarios, clientes, actividad 30 dias, backup, IA disponible, score por empresa, motivos accionables y QA funcional de contrato.
- TransGestAdmin/Salud permite descargar informe HTML de salud SaaS con empresas criticas, avisos, score de implantacion, actividad, backups e IA, validado por QA funcional para soporte y go-live multiempresa.
- TransGestAdmin/Integraciones incorpora diagnostico de salud de APIs: IA basica/visual, HERE/ORS, GPS/webhooks, SMTP, fiscal y seguridad de claves, con score, acciones prioritarias y QA anti-secretos.
- TransGestAdmin/Integraciones se consolida como pantalla unica de APIs: version del programa, salud, claves globales, claves por empresa, cuota IA por empresa, limites por proveedor, GPS, HERE/ORS y fiscalidad quedan gestionados desde `Empresas y APIs`; la antigua IA duplicada sale de Configuracion.
- TransGestAdmin/Integraciones queda simplificado en modo operativo por empresa: sin bloques duplicados de HERE/GPS/IA, GPS muestra por defecto solo el proveedor en uso, el diagnostico Movildata prueba vehiculos y posiciones con conteos enlazados, y VERIFACTU/SII permite definir email de alertas fiscales por empresa.
- Optimizador de rutas refuerza el proveedor gratuito: corrige coordenadas nulas `lat/lng` que se convertian en `0,0`, anade fallback local de ciudades espanolas y estimacion por carretera si OSRM/Nominatim no responden; QA funcional valida Madrid-Valencia con kilometros utiles.
- Calendario laboral de TransGestAdmin exige seleccionar empresa concreta, confirmar la asignacion de comunidad autonoma y guarda la CCAA por empresa para reutilizarla en consultas y alertas, sin opcion accidental de refrescar todas las empresas desde la UI.
- QA de despliegue endurecido: `npm run check` y `npm run qa:deploy` ejecutan auditoria estricta de aislamiento multiempresa; se han reforzado joins operativos de facturas/colaboradores con `empresa_id` explicito.
- Clientes/Rutas y tarifas incorpora diagnostico de salud por cliente: detecta rutas duplicadas, tipos de tarifa mezclados, rutas sin precio/km y minimos incoherentes; la UI muestra score/acciones y QA funcional valida el contrato.
- Cierre operativo de uso diario: backend incorpora `npm run daily:ready` para validar entorno, health, frontend y API protegida antes de empezar la jornada; frontend captura errores no controlados con codigo de incidencia y descarga JSON para soporte, incluyendo ruta, usuario, stack resumido y ultimo error API/request id.
- Mi Empresa/Puesta en marcha incorpora control de jornada diaria: endpoint, tarjeta e informe HTML con trafico vencido, cargas/descargas de hoy, incidencias, asignaciones, precios/margen, soporte documental, cobros, pagos a colaboradores y cola fiscal para arrancar el dia con prioridades claras.
- Pedidos/Trafico arranca en filtro de mes actual y mantiene un boton directo de semana actual que cambia a lunes-domingo de la semana en curso con agrupacion automatica por dias.
- QA visual de uso diario avanza: filtros activos de Avisos, Trafico, Facturacion, Pedidos, Taller y cuadrantes quedan normalizados con fondo activo solido y texto blanco; `npm run check` incorpora auditoria de contraste para evitar que vuelva el patron de texto azul/teal sobre estados activos.
- Ordenes de carga de colaborador por toneladas quedan corregidas para datos existentes: si el pedido tiene EUR/t y minimo manuales, imprime precio por tonelada; si tiene un total manual de colaborador, respeta ese importe como precio cerrado, refrescando el pedido completo antes de imprimir; QA funcional cubre ambos casos.
- WhatsApp Business queda preparado sin credenciales: servicio Meta Cloud API enchufable, configuracion segura por empresa, webhook publico, log auditado, preflight/envio por pedido a cliente o colaborador y modo simulado trazado hasta introducir WABA/Phone ID/token/plantillas.
- Mi Empresa incorpora pestaña WhatsApp para cargar Phone Number ID, WABA ID, token permanente, App Secret, Verify Token, plantillas aprobadas y consultar el log de envios/simulaciones sin tocar codigo.

- Plan diario queda implementado y desplegado: pantalla nueva en Cuadrante/Operaciones para preparar hoy/manana con semaforos, pedidos sin asignacion completa, avisos cruzados y notas por vehiculo/dia; el endpoint real `/plan-diario` ha sido probado contra datos de la empresa demo.
- Importacion evoluciona a pantalla de puesta a punto de datos maestros: muestra score real de clientes, colaboradores, choferes y vehiculos, lista pendientes por modulo, permite descargar CSV de faltantes, abre el modulo de correccion y anade plantilla/importacion de colaboradores.
- Estabilizacion de uso diario: datos maestros, puesta en marcha, jornada diaria, integraciones y parser IA de pedidos quedan compatibles con el esquema real desplegado, eliminando errores DB capturados que ensuciaban logs y podian dejar paneles incompletos.
- DCD/eCMR queda profundizado: el DCD devuelve expediente documental por pedido con score, bloqueos, acciones, documentos POD/CMR/albaran, trazabilidad de remision/descarga/firma, bloque eCMR explicito y export eFTI/eCMR enriquecido; los enlaces publicos de DCD, portal cliente y portal proveedor se normalizan para usar el host real cuando la URL de entorno local no sirve en despliegue/QA.
- Estado legal del bloque DCD/eCMR/eFTI: preparado para certificacion e integracion, no certificado todavia. Para marcarlo como certificado falta conectar proveedor/plataforma eCMR/eFTI/eIDAS, registrar identidad/firma/sello de tiempo/evidencias devueltas, bloquear o versionar cambios postfirma y superar las pruebas de conformidad del proveedor/organismo aplicable.

Checkpoint de avance (2026-06-08):

- Producto operativo vendible para empezar uso diario controlado: 98-99%.
- Producto profesional robusto para varias empresas: 88-91%.
- Producto "top mercado" segun roadmap ampliado: 84-86%.
- Pendiente principal: conectores reales de firma/EDI/OCR/WhatsApp/GPS externo, pruebas visuales intensivas con usuarios y datos reales, y ajuste fino de incidencias detectadas en operativa diaria.

## Incidencias y mejoras anadidas a cola (2026-05-05)

## Incidencias y mejoras anadidas a cola (2026-05-25)

### P0 - Usabilidad y estabilidad operativa

1. Facturacion debe quedar separada en tres vistas operativas: facturacion a clientes, seguimiento de cobros y pagos a proveedores. Estado: Implementado en frontend; pendiente QA visual final con usuarios.
2. Facturacion no debe mostrar estados tecnicos como `sin_facturar` ni textos mojibake visibles. Estado: Implementado; el estado tecnico queda eliminado tambien de filtros, selectores de cambio de estado y detalle de factura.
3. Pedido rapido debe admitir matricula de colaborador, remolque de colaborador y tipo de descarga; el resto de datos de descargas adicionales se podra completar despues. Estado: Implementado en frontend y payload.
4. Crear pedido no debe fallar si llega una ruta obsoleta o ya no visible para la empresa. Estado: Backend endurecido para descartar `ruta_id` inexistente y crear el pedido sin romper.
5. Guardar ruta desde pedido no debe insistir si la ruta ya existe o si existe como ruta global/vinculada por precio de cliente. Estado: Backend y frontend ajustados para reutilizar rutas existentes.

### P1 - Cumplimiento documental digital 2026-2027

1. Documento de Control Administrativo digital en Espana: la Ley 9/2025 exige que sea digital a los diez meses desde la entrada en vigor de la ley; fecha operativa calculada: 2026-10-05. Requisito producto: DCD emitido, firmado, conservado y accesible en inspeccion con QR/enlace seguro, auditoria de aperturas, descargas y cambios. Estado: Mejorado; el DCD ya muestra score de preparacion digital, faltantes bloqueantes y avisos eCMR/eFTI.
2. Firma electronica avanzada: documentos como DCD, carta de porte/e-CMR y flujos de aceptacion deben prepararse para firma compatible con eIDAS. Requisito producto: proveedor de firma, identificacion del firmante, sello de tiempo, evidencia tecnica y deteccion de cambios posteriores. Estado: Preparado en diagnostico; pendiente elegir/conectar proveedor real.
3. DIWASS/eAnnex VII: desde 2026-05-21 DIWASS aplica a procedimientos de notificacion y documentos de movimiento de residuos; Annex VII tiene enfoque transitorio hasta 2026-12-31. Requisito producto: modulo preparatorio para residuos transfronterizos con datos maestros, codigos de residuo, partes, transportistas, firmas y futura conexion API/DIWASS cuando sea estable.
4. eFTI/e-CMR: el marco eFTI sera plenamente aplicable el 2027-07-09 para aceptacion de informacion electronica por autoridades via plataformas certificadas. Requisito producto: modelo documental interoperable, identificador unico verificable, QR para inspeccion, permisos B2A/B2B y exportacion estructurada.
5. Datos maestros: antes de activar flujos digitales obligatorios, clientes, cargadores, destinatarios, transportistas, colaboradores, conductores y vehiculos deben tener NIF/VAT, domicilio, pais, contactos, email/telefono y roles completos. Requisito producto: semaforo de completitud y bloqueo/avisos antes de emitir documentos digitales. Estado: Implementado preparatorio en DCD; distingue faltantes obligatorios y avisos recomendados de contacto/firma/eFTI.

### P0 - Muy importantes

1. Corregir errores de edicion de viaje que disparan 500 al reasignar vehiculo por payload completo del frontend. Estado: Implementado y desplegado.
2. Mejorar resolucion de direcciones y puntos guardados en pedidos para calculo de km y rutas, eliminando mensajes mojibake. Estado: Implementado y desplegado.
3. Persistir correctamente horarios partidos y horarios habituales de clientes en base de datos. Estado: Implementado y desplegado.

### P1 - Importantes

1. Permitir crear viaje rapido sin asignar, manteniendo multiples cargas y descargas. Estado: Implementado.
2. Permitir copiar viajes desde pedidos/trafico con criterio operativo reutilizable. Estado: Implementado.
3. Filtro avanzado de pedidos/trafico con agrupacion desplegable por cliente. Estado: Implementado.
4. Poder editar movimientos de palets una vez creados con reglas claras de bloqueo y confirmacion. Estado: Implementado.
5. Revisar y redisenar la duplicidad entre tarifas y rutas hacia un modelo unificado de rutas y tarifas con minimos, combustible y tipo de precio. Estado: Mejorado; minimos normalizados en backend/importacion y diagnostico de salud en Cliente/Rutas para detectar duplicidades e incoherencias antes de crear pedidos.

### P2 - Diferencial / cumplimiento a estudiar

1. Volcado de documentos de vehiculos para analisis, archivo y organizacion asistidos por IA. Estado: Implementado; los adjuntos se analizan, rellenan campos y se guardan con nombre archivistico por entidad, tipo y vencimiento.
2. Revisar impacto de la ley de transparencia salarial en nominas, usuarios y trazabilidad del programa. Estado: Implementado preparatorio; nominas calcula bruto mensual/anual/hora, diferencias internas, brecha mujer/hombre si hay datos, campos pendientes y reporte imprimible. Pendiente de ajustar cuando Espana publique la transposicion definitiva de la Directiva UE 2023/970.
