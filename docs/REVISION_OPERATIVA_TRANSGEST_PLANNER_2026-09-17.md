# Revisión operativa de TransGest y Planner

Fecha: 17/09/2026. Repositorio: GaunaSoftware/GaunaSoftware-transgest-app.

## Resultado y alcance

Se han revisado los fallos comunicados, el flujo de expedición de Planner, los permisos por producto, la separación de facturación y las regresiones automatizadas disponibles. Las modificaciones se han probado en un entorno aislado. La consulta de datos reales y la comparación con Dashdoc han sido de solo lectura. No se han cancelado, reasignado, facturado ni eliminado pedidos reales como prueba.

Este informe distingue lo comprobado de lo que aún requiere una prueba con los servicios y dispositivos de cada instalación. No constituye una certificación de ausencia de fallos ni de cumplimiento fiscal de cualquier configuración.

## Hallazgos y correcciones

| Área | Problema confirmado | Resultado implementado |
|---|---|---|
| Asignación | Limpiar desde el listado conservaba el colaborador y datos externos; la acción múltiple no contemplaba todas las asignaciones. | Limpieza común de proveedor, vehículos, conductores y matrículas externas, conservando precios y demás datos del pedido. |
| Asignación rápida | Faltaban matrícula, remolque, conductor y negociación económica al asignar proveedor. | Formulario con esos campos, venta, coste y margen del transporte. Los precios vacíos conservan el importe actual; un cero explícito se respeta. |
| Enlaces del proveedor | Un cambio de proveedor no revocaba los enlaces de confirmación de la asignación anterior. | Caducidad de los enlaces del pedido y reinicio de la aceptación al cambiar de proveedor. |
| Tarifas | La selección automática podía confundir municipios de una misma provincia o elegir arbitrariamente entre tarifas equivalentes. | Coincidencia por municipio/provincia y alias bilingües. Si hay varias tarifas con la misma prioridad se muestran para elegir; no se modifica la dirección. |
| Textos | Aparecía «Anadir» en puntos de carga y descarga. | «Añadir». |
| Planner | Cargas y muelles duplicaban la planificación. | Entrada única «Cargas y muelles», con cuadrante diario/semanal y cola de solicitudes pendientes. |
| Planner | Una carga nueva no aparecía como solicitud si el proveedor no había solicitado hueco. | La cola incluye todas las cargas abiertas de Planner sin muelle, con fecha, cliente y proveedor o aviso de asignación pendiente. |
| Muelles | Se exigía duración y se bloqueaba por capacidad/solape. | Se asigna una llegada, sin límite de palets ni duración obligatoria. Varias cargas pueden compartir muelle. Un camión cargando genera aviso y requiere continuar expresamente. |
| Confirmación | Confusión entre planificación y aceptación comercial. | Arrastrar una carga pendiente la deja confirmada operativamente. La aceptación del proveedor mantiene su registro independiente: no se inventa una aceptación que no ha ocurrido. |
| Tiempos | Se usaba una duración teórica como restricción. | Inicio y fin reales de carga, media por muelle y número de muestras. Información orientativa disponible en el cuadrante y en los portales del proveedor y cliente. |
| Stock | Cambiar cantidades directamente podía desincronizar la preparación y el dibujo del camión. | Si hay mercancía reservada/expedida, se cambia desde la preparación. Liberarla restaura reservas y vacía peso, palets, bultos y metros del pedido. Sin preparación, vaciar bultos también vacía los datos del dibujo. |
| Borrado | Los pedidos con historial de almacén podían fallar por referencias en la base de datos. | Mensaje explicativo: conservar el pedido cancelado y liberar mercancía pendiente; no borrar su trazabilidad de stock. |
| Costes | El coste del viaje no tenía reparto trazable por producto. | Registro de costes por preparación y evento histórico. Por peso; si no hay peso, por unidades. También permite elegir unidades o venta. Reparto exacto al céntimo, conservando el coste del catálogo. |
| Facturación | Planner reutilizaba la pantalla general con facturas de TransGest. | Pantalla y consultas específicas de ventas de mercancía y sus rectificaciones. Exclusión de las cargas Planner en pendientes de transporte y de sus facturas en el listado ordinario de TransGest. |
| Albaranes | Documento insuficientemente estructurado y distinto entre productos. | Plantilla común con emisor, cliente, logo disponible, transporte, matrículas, puntos, mercancía, lotes, cantidades, peso, reparto y recepción. Acceso PDF también desde el pedido de TransGest. |

### Caso Capa / Alboraya

Alboraya figura en el diccionario como municipio de Valencia. En la consulta real de tarifas de Capa aparecieron dos destinos equivalentes, «VALENCIA» y «VALENCIA/VALÈNCIA», con precios distintos (14,69 y 13,45). No es correcto decidir silenciosamente cuál está contratado. La aplicación presenta las alternativas. Conviene revisar comercialmente estas tarifas y conservar ambas solo si representan acuerdos distintos. No se han alterado los precios reales.

### Qué significa el margen

El formulario rápido muestra venta menos coste del transporte, antes de otros gastos operativos. En Planner, el reparto registrado suma precio del transportista, gasóleo, peajes, dietas y otros costes guardados. No estima gastos inexistentes ni modifica el coste maestro de los artículos. Si cambian los costes antes de la salida, se puede recalcular; al expedir se toma una instantánea final. El importe del proveedor debe representar el transporte facturado; no se debe registrar otra vez ese mismo importe en «otros costes».

## Flujo de trabajo propuesto y aplicado a Planner

1. Dar de alta clientes/destinatarios y proveedores de transporte. La flota propia puede organizarse como proveedor propio.
2. Crear referencias, unidades por palet, coste y venta. Registrar recepción, fabricación, devolución o ajuste con motivo y ubicación/lote.
3. Crear la carga con cliente, fechas y puntos. Aparece en solicitudes pendientes sin exigir que primero exista una petición del proveedor.
4. Preparar mercancía y repartos. Los artículos y los palets facturables se añaden como líneas separadas; por ejemplo, 64 sacos y 1 palet. Se aplican descuentos por línea.
5. Asignar transportista y enviar el encargo por el flujo existente. El proveedor acepta desde su enlace o portal; una vinculación entre empresas permite llevarlo a su TransGest de transporte.
6. Arrastrar la carga al muelle/hora, o usar «Asignar muelle» en móvil. También se puede planificar antes de terminar la preparación.
7. Registrar espera, inicio de carga y camión cargado. La media se calcula con cargas terminadas, no con horarios previstos.
8. Generar albarán y el DCD mediante su circuito específico. Confirmar expedición descuenta existencias una sola vez y registra el coste por producto.
9. El transportista comunica los estados y aporta POD. La factura de mercancía se crea desde la preparación expedida, se revisa y después se emite en Facturación de Planner.

Al liberar una asignación de muelle vuelve a pendientes. Al liberar mercancía se conserva el historial y se eliminan sus reservas. Son acciones distintas y no deben mezclarse.

## Productos y permisos

| Oferta | Código actual | Lectura operativa |
|---|---|---|
| TransGest Go | lite | Acceso básico y módulos limitados. No debe venderse como el TMS completo. |
| TransGest Control | basico | Operación de transporte con restricciones de módulos avanzados. |
| TransGest Pro | profesional | Operación ampliada, planificación, taller/contabilidad y BI según permisos. IA no incluida por defecto. |
| TransGest Pro Intelligence | enterprise | Funciones avanzadas, IA e importación, sujetas a configuración y cuota. |
| TransGest Planner | planner | Almacén, cargas, muelles, proveedores, documentos y venta de mercancía. |
| TransGest Pro Planner | pro_planner | Dos espacios operativos para una empresa: TMS y Planner. No implica IA automáticamente. |

Los módulos visibles también dependen del rol y los permisos del usuario. Los catálogos de empresa/clientes pueden compartirse; cargas, preparación de mercancía y listados de facturación deben diferenciar el producto. La contabilidad fiscal de la misma entidad jurídica y ciertas configuraciones de empresa siguen siendo comunes: «espacios separados» no significa dos empresas fiscales ni dos bases de datos.

No se han inventado precios comerciales para Planner. La definición económica de los planes y los límites que deban anunciarse comercialmente deben validarse antes de venderlos. La interfaz conserva códigos internos históricos; conviene mantener una única matriz comercial publicada para evitar confusiones.

## Comparación con Dashdoc (solo lectura)

Se observó una cuenta invitada con acceso a transporte, planificación y recursos. La facturación no estaba activada, de modo que su funcionamiento real no se pudo comparar. No se tuvo acceso a su código backend.

| Observado | Aplicación útil a TransGest / Planner |
|---|---|
| Bandejas por etapa: confirmar, planificar, enviar al conductor, en curso, terminado y facturación. | Mantener colas claras con acciones por fase, evitando mostrar todas las operaciones a la vez. La cola de cargas pendientes y el cuadrante unificado aplican este criterio. |
| Planificación con cargas pendientes al lado y conductores/conjuntos en columnas o filas. | Asignación por arrastre y alternativa por botón, con datos operativos visibles. |
| Origen y destino con dirección, población/código postal y horarios separados. | Mantener puntos y ventanas explícitos; no sustituirlos por una única etiqueta ambigua. |
| Recursos vinculados a conductor, tractor y remolque; estado de acceso a la app. | Mostrar la composición del conjunto y el estado de invitación en el proveedor, evitando duplicar matrículas dentro del nombre. |
| Dashdoc Flow separa la planificación del sitio logístico del transporte. | Planner organiza el almacén y los muelles; el TMS del transportista organiza su viaje. Se conectan mediante aceptación y seguimiento. |

Documentación oficial de referencia: [planificación de sitios en Dashdoc Flow](https://help.dashdoc.com/en/articles/9250642-dashdoc-flow-manage-planning-at-your-logistics-sites), [conexión entre TMS y muelles](https://www.dashdoc.com/en/blog/tms-flow-seamless-planning-to-dock). Estas fuentes explican el producto; no demuestran cómo está implementado su backend privado.

## Documentos y marco normativo

El albarán identifica entrega, partes y mercancía. Incluye espacio para recepción y reservas sin inventar firma, fecha efectiva ni aceptación. Un PDF recién generado no equivale a un POD firmado. El documento puede incorporar un logo cargado como imagen válida; si falta, conserva la identidad escrita.

El documento de control del transporte tiene sus propios datos obligatorios. La Orden FOM/2861/2012 permite que otro documento cumpla su función solo cuando contiene todos los datos exigidos. Por eso no se etiqueta automáticamente el nuevo albarán como DCD válido. Fuente: [BOE, Orden FOM/2861/2012, artículos 2, 5 y 6](https://www.boe.es/buscar/act.php?id=BOE-A-2013-154).

El albarán tampoco sustituye a la factura fiscal. Se conserva la revisión y emisión de la factura en el circuito correspondiente. Fuente: [AEAT, obligación de facturar](https://sede.agenciatributaria.gob.es/Sede/iva/facturacion-registro/facturacion-iva/obligacion-facturar.html).

## Verificación realizada

- Frontend: 49 pruebas en 22 suites, incluidas asignación de proveedor desde el formulario, matrículas, conductor, precios y margen, tarifas ambiguas y permisos por producto.
- Backend: suite general; preparación/stock real en PostgreSQL aislado (PGlite), repetición segura de operaciones, insuficiencia de stock, concurrencia por versión, secuencia del camión, expedición única, liberación y nueva preparación.
- Nuevas pruebas: reparto de céntimos, ausencia de peso, modificación de cantidades con reserva, aislamiento de facturas y rectificaciones, asignación sin límite de palets y aviso por muelle ocupado. Confirmación del plan sin falsificar aceptación del proveedor.
- Seguridad: aislamiento entre empresas, documentos, permisos, sesiones de soporte, protección de secretos, SSRF, SMTP local y revocaciones de producto. No son un test de intrusión independiente.
- Auditoría funcional existente: creación de empresa/usuario/cliente/conductor/vehículo, facturación y revisión documental, rectificaciones, cobros, documentación de vehículos, taller y neumáticos. Ejecutada en entorno aislado, no contra pedidos reales.
- Integraciones: contratos de petición/respuesta HERE/ORS y SMTP probados con respuestas simuladas o servidor local. No demuestran entrega real de correo ni disponibilidad de todos los proveedores de una instalación.
- Compilación de producción completada; quedan advertencias de lint anteriores en otros componentes.
- Navegador Edge local: navegación unificada, formulario de muelle sin duración/capacidad, arrastre y actualización de la cola, etiqueta de colaborador pendiente, formulario móvil, consulta de facturas exclusiva de Planner y ausencia de excepciones no controladas.
- Albarán PDF generado y renderizado para comprobar maquetación.

## Límites y comprobaciones todavía necesarias por instalación

1. Verificar la llegada de un correo real al transportista de pruebas y la aceptación desde un navegador externo. El SMTP local comprueba el mensaje, no su entrega por el proveedor contratado.
2. Ejecutar un flujo con un transportista conectado de prueba, un conductor de prueba y un teléfono real para comprobar conectividad, permisos de cámara/subida y notificaciones.
3. Verificar el proveedor fiscal contratado y sus credenciales en el modo que corresponda. Las pruebas aisladas no acreditan presentación tributaria real.
4. Comprobar restauración de una copia PostgreSQL y retención de documentos en la infraestructura concreta. El entorno aislado no valida el plan de recuperación de producción.
5. El instalador Windows, firma del ejecutable, actualización automática y conectividad de una instalación local requieren su propio ciclo de empaquetado y prueba. Compilar la web no prueba el EXE ni una instalación sin Internet.
6. Los informes contables/fiscales generales de una misma empresa pueden consolidar ambos productos. Esta entrega separa los listados operativos de facturas y los pendientes de transporte; no crea dos contabilidades legales independientes.
7. La comparativa de Dashdoc no cubre módulos no habilitados en la cuenta ni su backend privado.

## Prueba de aceptación sugerida

En una empresa de pruebas: crear artículo de 25 kg y 64 unidades por palet; recibir 64 sacos y un palet; crear carga; preparar ambas líneas; asignar proveedor con matrículas y conductor; comprobar margen; arrastrar a muelle; intentar una segunda carga mientras la primera carga y verificar el aviso; registrar inicio/fin; expedir; comprobar stock, reparto de coste, albarán y borrador de mercancía. Revisar y emitir. Comprobar que esa factura está en Planner y no en el listado de facturas de transporte, y que una factura TMS no aparece en Planner.

En TransGest: usar un pedido de prueba con proveedor, limpiar la asignación y recargar; volver a asignar desde los tres puntos con matrículas/conductor/precios; verificar los datos sin abrir la ficha. Para Capa/Alboraya, comprobar que se ofrecen las dos tarifas equivalentes para elegir y que se mantiene la dirección del pedido.
