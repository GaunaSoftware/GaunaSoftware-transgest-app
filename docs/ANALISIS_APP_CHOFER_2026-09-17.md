# Análisis previo de la app del chófer de TransGest

Fecha: 17/09/2026. Estado: análisis de código; implementación pendiente de aprobación.

Se ha revisado el árbol local de `codex/operational-review-planner`, HEAD `b6eb19ba`, cuya entrega anterior se integró en main como `97896d2d`. Esta revisión no acredita por sí sola el comportamiento del despliegue actual: no se han realizado nuevas operaciones en producción ni pruebas reales de correo o Android. No se ha modificado código de la aplicación.

El código actual define las funciones que hay que conservar. El mockup define el estilo, no añade requisitos funcionales por sí mismo. La Parte 1 pide análisis previo sin modificar código; el texto adjunto de implementación se considera la fase posterior. Sus restricciones de refactor visual se separan de las nuevas reglas de negocio solicitadas expresamente.

## 1. Archivos que forman la experiencia

Las rutas siguientes parten de `transgest-bloque6-backend/`.

| Archivo | Responsabilidad actual |
|---|---|
| `transgest-frontend/src/pages/AppChofer.js` | 3.707 líneas: navegación interna, carga de datos, viajes, pasos, DCD, firmas, incidencias, escáner, jornada, conjunto, vacaciones, datos, taller y sincronización. |
| `transgest-frontend/src/pages/driver/DriverUI.js` | Componentes existentes: cabecera, iconos, títulos, inicio, menú Más y navegación inferior. |
| `transgest-frontend/src/pages/driver/driver.css` | Diseño móvil, tarjetas, formularios, navegación fija, áreas seguras y reglas adaptativas. |
| `transgest-frontend/src/App.js` | Selección de experiencia por rol, módulos permitidos y selección TransGest/Planner. |
| `transgest-frontend/src/context/AuthContext.js` | Sesión, recuperación del usuario, permisos y cierre de sesión. |
| `transgest-frontend/src/pages/SupplierApp.js` | Experiencia distinta para colaboradores y sus conductores: viajes, estados, albaranes y operativa limitada. |
| `transgest-frontend/src/services/api.js` | Clientes HTTP para pedidos, DCD, pasos, firmas, jornada, conjunto, vacaciones, GPS, taller y notificaciones. |
| `transgest-frontend/src/services/mobileRuntime.js` | Ubicación en navegador/Capacitor y estado de red; seguimiento en primer plano. |
| `transgest-frontend/src/services/offlineQueue.js` | Cola local, deduplicación, reintentos y acciones bloqueadas. |
| `transgest-frontend/src/components/RutaMapa.js` | Mapa compartido que puede recibir puntos y posición del vehículo; candidato a reutilizar en el detalle. |
| `transgest-frontend/src/utils/adr.js` | Información ADR, requisitos y exenciones utilizados en viajes. |
| `transgest-frontend/src/utils/serverConfig.js` | Selección del servidor: configuración local, variable de compilación o API en la nube. |
| `transgest-backend/src/routes/choferes.js` | Jornada, conjunto, firma base, vacaciones y GPS de la app. |
| `transgest-backend/src/routes/pedidos.js` | Acceso a pedidos, creación desde chófer, pasos operativos, estados, documentos, DCD, clientes, puntos y rutas. |
| `transgest-backend/src/routes/taller.js`, `notificaciones.js`, `supplier_app.js` | Solicitudes de taller, avisos y operativa de proveedores/conductores externos. |
| `transgest-frontend/capacitor.config.json`, `android/` | Proyecto nativo Android existente, permisos, identidad y compilación. |
| `transgest-frontend/scripts/driver_browser_check.cjs` | Pruebas de navegador existentes con API simulada. Son reutilizables, pero no demuestran funcionamiento real de GPS, SMTP o servicios externos. |

Para los fallos adicionales también intervienen `Login.js`, `branding.js`, `utils/planFeatures.js`, `planner/PlannerApp.js`, `planner/access.js`, y los servicios del backend `email.js` y `supplierInvitations.js`.

## 2. Vistas y navegación actual

No existe una ruta URL independiente por cada pestaña del chófer: `AppChofer` cambia una variable de estado local. El detalle se expande dentro de la tarjeta del viaje. Además existe el módulo de rutas recomendadas para chófer dentro de la navegación general.

La barra inferior ya contiene Inicio, Mis viajes, Jornada, Avisos y Más. Simultáneamente aparece otra barra con Activos, Nuevo, Jornada, Datos, Vacaciones, Historial y Taller. Hay duplicación de accesos, pero no significa que sobren las funciones.

## 3. Funciones que se conservarán

| Vista | Funcionalidad real |
|---|---|
| Inicio | Resumen de viajes y jornada, accesos a crear viaje, datos/firma e historial, estado de conexión y sincronización. |
| Activos | Pedidos asignados, estados, agrupación por grupaje, aviso de varios viajes activos, selección del viaje y acceso al detalle. |
| Detalle de viaje | Cliente, ruta, mercancía, fechas, datos ADR, documentación visible para el chófer, DCD, pasos operativos, fotos, incidencias, firmas y apertura de mapas externos. |
| DCD | Consulta, QR, compartir/copiar enlace, impresión y revisión/disponibilidad. Se conservarán también las acciones secundarias que existan en el flujo documental. |
| Nuevo viaje | Cliente, ruta, origen, destino, fechas y horas, mercancía, peso, bultos, referencia, notas, creación de viaje y DCD. También puede proponer puntos y rutas para revisión de tráfico. |
| Jornada | Inicio/cierre con kilómetros, actividad, tiempos y avisos internos, eventos, notas, noche fuera y lugar de pernocta. |
| Mi conjunto | Consulta/cambio de tractora y remolque disponibles; actualización y aviso a tráfico. Actualmente está siempre desplegado dentro de Jornada. |
| Datos | Datos personales, conjunto y firma base; alta/cambio de firma. |
| Vacaciones | Solicitud con fechas y firma, consulta de solicitudes y firma de aceptación de vacaciones aprobadas. |
| Taller | Motivo de avería, urgencia, descripción y capacidades/opciones de taller disponibles; envío, historial y seguimiento de solicitudes. |
| Historial | Viajes entregados, facturados o cancelados con sus detalles. |
| Avisos | Avisos de viaje, plan diario y rutas; abrir ruta y marcar leído. Actualmente se muestran como máximo tres avisos de esos tipos. |
| Más | Accesos a apartados, tema, permisos de notificación y salida. |
| Funciones transversales | Firma en pantalla, cámara/archivo, recorte y limpieza del albarán, evidencias de ubicación, cola sin conexión, reintentos y sugerencia de instalar PWA. |

El flujo operativo actual incluye: posicionarse en carga, iniciar carga, confirmar mercancía, adjuntar albarán, firma del remitente, finalizar carga, iniciar viaje, posicionarse en descarga, iniciar/finalizar descarga, adjuntar albarán y firmar entrega. Hay controles adicionales para cisternas y avisos de espera. Ninguno debe desaparecer por no estar dibujado en el mockup.

Los estados generales del pedido y los pasos del chófer son mecanismos distintos. Deben coordinarse para representar cada parada en el mapa, sin sustituirlos por un único estado visual.

Los conductores de colaboradores usan `SupplierApp`, no esta experiencia completa. Se mantendrá su acceso limitado y no se les habilitarán vacaciones, jornada interna o tacógrafo por aplicar el nuevo diseño.

## 4. Partes reutilizables

- Cabecera, barra inferior, iconos y tokens de `DriverUI.js` y `driver.css`.
- Servicios API y contratos actuales durante el refactor puramente visual.
- Firmas, escáner, evidencias, protocolo de cisterna, ADR y funciones DCD.
- Cálculo/resumen actual de jornada, preservando las limitaciones informadas al usuario.
- Cola de acciones y tratamiento de conectividad, tras revisar su aislamiento por sesión.
- Mapa compartido y su entrada `vehiclePosition`, adaptando datos reales de paradas y estado.
- Pruebas existentes como base de regresión, ampliándolas con los casos indicados abajo.

## 5. Componentes y responsabilidades que conviene extraer

`AppChofer` debería conservar la coordinación de la experiencia, no seguir acumulando pantallas.

| Propuesta | Contenido |
|---|---|
| `DriverLayout` | Cabecera, contenido, navegación inferior, avisos de conexión y áreas seguras. Reutiliza los componentes actuales. |
| `DriverTrips` / `DriverTripCard` | Viaje destacado y lista compacta; estado, ruta y CTA consistente. |
| `DriverTripDetail` | Información del pedido, paradas, documentación, próxima acción y mapa. |
| `DriverDcdPanel` | Ver DCD, QR, compartir y menú de opciones secundarias. |
| `DriverTripActions` | Presentación de la próxima acción y accesos a incidencias, fotos y mapas. Mantiene las comprobaciones actuales. |
| `DriverNewTripWizard` | Tres pasos conservando el mismo borrador: datos básicos; carga/horarios; revisión. |
| `DriverWorkday` / `DriverVehicleSet` | Jornada y resumen del conjunto con edición bajo demanda. |
| `DriverActivityLog` | Actividades y eventos sin repetir tarjetas completas. |
| Vistas de Datos, Vacaciones y Taller | Extraer las implementaciones existentes y uniformar sus formularios. |
| Hooks de datos, GPS y sincronización | Separar efectos de red y ciclo de sesión de la presentación. |

No se sustituirán por datos ficticios los tiempos, posiciones, distancias ni recomendaciones. Los kilómetros estimados de ruta son diferentes del cuentakilómetros y pueden seguir siendo información de solo lectura.

## 6. Hallazgos y riesgos

### Confirmados por lectura del código

1. **Kilometraje de cierre:** el backend solo rechaza un cierre inferior al inicio; permite la igualdad. Requisito aclarado por el usuario: cierre al menos 1 km superior. Debe validarse en frontend y backend.
2. **Mensaje incorrecto al cerrar jornada:** el manejador `run` captura el error y el llamador muestra después un aviso de éxito incondicional. Además, cambia a descanso antes de intentar cerrar; una validación fallida puede dejar una modificación parcial. Hay que hacer que el resultado y las operaciones sean coherentes.
3. **Conjunto y jornada son acciones independientes:** iniciar jornada permite guardar `vehiculo_id` nulo y no exige confirmar el conjunto. Se necesita confirmación explícita al abrir/cerrar; no necesariamente cambiar físicamente la asignación si es correcta.
4. **Cambio de tractora durante la jornada:** el cierre compara contra el inicio de la jornada y actualiza el vehículo actual del chófer. Si hubo cambio de vehículo, se corre el riesgo de comparar odómetros de camiones diferentes. Se necesita registrar el cambio por vehículo antes de imponer una comparación global.
5. **Bloqueo de viaje incompleto:** se comprueba jornada en algunas acciones del frontend, pero no en todas las acciones operativas revisadas ni en el endpoint de cambio de estado. La nueva regla necesita validación central de servidor. Propuesta: permitir consultar pedido y DCD con jornada cerrada; impedir iniciar o continuar acciones operativas hasta abrirla.
6. **Cliente basado en historial:** `/pedidos/chofer/clientes` obtiene los accesos iniciales agrupando pedidos anteriores y los ordena por número de cargas. El formulario muestra esas cantidades. Debe presentar el catálogo permitido de clientes y puntos de la empresa.
7. **Selector de puntos incompleto:** existe un endpoint específico de puntos de carga; destino es texto libre/ruta. Para ofrecer puntos de descarga guardados hace falta ampliar la consulta correspondiente. También se selecciona automáticamente el único punto de carga al elegir cliente: debe pasar a selección expresa.
8. **Kilómetros dentro del viaje:** el campo opcional alimenta pasos y el cálculo de kilómetros en vacío. Retirarlo de la interfaz sin revisar esa dependencia podría degradar los costes. Hay que conservar el histórico y obtener las lecturas futuras de la fuente acordada, sin inventar distancias por parada.
9. **GPS externo sin comprobar antigüedad:** la app deja de registrar ubicación cuando existe proveedor GPS e identificador configurados, aunque no comprueba si llega señal reciente. La prioridad debe depender de posición válida y reciente; si no, usar la app y mostrar origen/hora de la señal. Un tacógrafo por sí solo no implica disponer de coordenadas en la integración.
10. **Seguimiento móvil actual en primer plano:** `mobileRuntime` usa ubicación de primer plano y la app la pausa durante descanso/pausa. No hay evidencia aquí de seguimiento nativo fiable con pantalla apagada. Debe probarse por separado y no anunciarlo como ya disponible.
11. **Login con edición incorrecta:** `getEmpresaPlanLocal()` devuelve `enterprise` si no encuentra plan; `branding.js` lo presenta como Pro Intelligence. El login debe usar marca genérica antes de identificar de forma válida la empresa, sin otorgar permisos por el correo escrito.
12. **Restos de sesión:** `removeToken()` limpia usuario/token, pero no la suscripción local ni todos los cachés/estado de producto. La ruta Planner se conserva al cerrar sesión. Son puntos concretos a corregir y probar en el cambio demo → Asensi. No se ha demostrado con esta revisión un acceso real no autorizado a datos Planner.
13. **Cola sin conexión compartida:** usa una clave local global sin separación obligatoria por empresa/usuario. Es necesario impedir que acciones pendientes de una sesión se intenten enviar con otra; preservarlas para su propietario, no borrarlas silenciosamente.
14. **Prioridad SMTP ya existente:** el servicio intenta primero el SMTP activo de la empresa y usa plataforma si no está configurado. Por tanto, recibir desde noreply no prueba que la selección no exista. Falta verificar la configuración efectiva de esa empresa. Tener un email de contacto no equivale a tener un remitente SMTP autorizado.
15. **Correo sin identidad visual solicitada:** las plantillas revisadas tienen cabecera azul con texto TransGest TMS; el envío del viaje no aporta los dos logos. Deben unificarse invitación y carga con colores de TransGest, identidad de empresa y CTA claro.
16. **Invitación de colaboradores ya existe:** `supplierInvitations.js` crea invitaciones con token de 72 horas y cuentas de rol limitado. Hay que mejorar su presentación y acceso, no crear un sistema paralelo.
17. **Navegación y diseño:** conviven cabecera, título repetido, pestañas superiores y barra inferior; el detalle concentra muchos bloques y estilos inline. El DCD señalado por el usuario requiere prueba visual a anchuras móviles para fijar y verificar el desbordamiento.

### Riesgos a cubrir en implementación

- No ampliar permisos de conductores externos por reutilizar componentes internos.
- No confundir lectura de documentos con inicio operativo de viaje.
- No convertir una pérdida de red en un éxito confirmado: diferenciar guardado local, enviado y rechazado.
- No asociar la ubicación o el kilometraje al vehículo equivocado tras cambiar conjunto.
- No romper grupajes, varias cargas/descargas, ADR, firmas o documentación de un viaje histórico.
- No perder borradores del asistente al retroceder, cambiar de pestaña o recuperar la app.
- No esconder el estado de una API fallida como si no hubiese jornada, avisos o documentos.
- No trasladar controles internos al PDF/DCD; el documento y la interfaz son superficies diferentes.

Los avisos push nativos tampoco están acreditados: existe permiso/notificación de navegador, pero no aparece el plugin de push en las dependencias revisadas. No se incluirá una promesa de avisos con la app cerrada sin implementar y probar su transporte.

## 7. Plan por fases y criterios de aceptación

1. **Base y regresión.** Inventario de acciones, fixtures aislados de chófer interno/externo y pruebas de sesión, permisos y API. Registrar el comportamiento actual antes de extraer componentes.
2. **Sesión y producto.** Marca genérica sin usuario, limpieza/aislamiento de cachés, selección de espacio según productos reales, tratamiento de Atrás y restauración de pestaña. Verificar demo con Planner → salida → Asensi sin Planner, nueva pestaña y recarga.
3. **Reglas operativas.** Confirmación del conjunto y odómetro al abrir/cerrar, cierre superior por al menos 1 km, manejo del cambio de vehículo, bloqueo de operaciones con jornada cerrada y corrección del falso aviso de éxito. Validar también llamadas directas a la API.
4. **Estructura visual.** Extraer layout y vistas. Una navegación principal; cabecera con logo, avisos y avatar; actualización accesible en menú. Tipografía, superficies y controles comunes en claro/oscuro, botones táctiles de al menos 44 px. Centrar iconos/acciones y mantener legibilidad de textos largos.
5. **Viajes y DCD.** Destacar el viaje actual, compactar próximos viajes, detalle dedicado y panel documental con Ver/QR/Compartir. Mantener opciones secundarias accesibles. Retirar odómetro del detalle sin romper las dependencias identificadas.
6. **Nuevo viaje.** Asistente de tres pasos, clientes y puntos disponibles de la empresa, selección expresa, validación y conservación del borrador. Mantener propuestas de punto/ruta bajo opciones secundarias para revisión de tráfico.
7. **Jornada y demás vistas.** Resumen, tiempos reales disponibles, conjunto compacto, actividades, eventos, cierre; Datos, Vacaciones, Taller, Historial y Avisos con el mismo sistema visual.
8. **Mapa y ubicación.** Estado por parada y leyenda coherente; posición con fuente/hora, prioridad de telemática reciente y fallback de app. Probar denegación de permiso, señal antigua, pérdida de red y cambio de vehículo.
9. **Correos.** SMTP de empresa/remitente autorizado, fallback de plataforma claramente identificado, Reply-To de empresa cuando proceda, ambos logos, plantillas adaptables y enlace de invitación/aceptación existente. Verificar el envío real autorizado y su recepción sin modificar cargas reales de prueba por accidente.
10. **Android y entrega.** Compilación firmada, pruebas físicas, documentación de publicación, canal interno y validación final antes del despliegue aprobado.

Las fases 2, 3, 6, 8 y 9 incluyen cambios funcionales o de servidor solicitados por el usuario. Se implementarán separados del refactor visual para poder revisar y probar cada efecto.

Matriz mínima: 375×812, 390×844, 393×852, 430×932 y tablet de 768 px; claro/oscuro; nombres/rutas largos; teclado abierto; giro; navegación Atrás; viaje normal/grupaje/cisterna; DCD disponible/pendiente; firmas; fotos/PDF; vacaciones; taller; jornada sin abrir/abierta/cierre inválido/cierre válido; sin red/reintento/error de servidor; cambio de cuenta y usuario externo. Incluir pruebas backend y de navegador, además de dispositivo real para capacidades nativas. Las pruebas existentes simuladas se conservarán y adaptarán, sin presentarlas como auditoría real de proveedores.

## Android: base existente y procedimiento de publicación

El proyecto ya tiene Capacitor 8, carpeta Android, identificador `com.gaunasoftware.transgest`, SDK mínimo 24 y SDK objetivo 36. La configuración revisada sigue con versión 1.0/código 1; no se ha generado en esta revisión un APK/AAB firmado. La app utiliza contenido web empaquetado, por lo que actualizar la web no actualiza automáticamente ese paquete instalado.

Pasos previstos tras aprobar e implementar:

1. Usar una cuenta de desarrollador Google Play de la organización y comprobar si el identificador ya corresponde a una app publicada antes de cambiarlo.
2. Preparar Node 22 o superior y Android Studio compatible con Capacitor 8; instalar el SDK requerido. La guía de Capacitor 8 indica Android Studio Otter 2025.2.1 o posterior. [Requisitos oficiales de Capacitor 8](https://capacitorjs.com/docs/updating/8-0).
3. Fijar la URL HTTPS de la API de producción para la compilación móvil, comprobar CORS/origen nativo y que no se hereda el modo de servidor local de Planner. Revisar permisos mínimos, iconos, splash y áreas seguras.
4. Ejecutar pruebas y build, `npm run mobile:sync` y `npm run mobile:open:android`. El proyecto Android ya existe; no hay que volver a crearlo. [Flujo Android de Capacitor](https://capacitorjs.com/docs/android).
5. Probar con teléfono Android real: login, cuenta interna/externa, conjunto, jornada, estados, cámara, documentos, compartir, ubicación, sin conexión y recuperación. Probar el botón Atrás para volver dentro de la app correctamente.
6. Incrementar `versionCode` en cada entrega, definir `versionName` y generar en Android Studio un **Android App Bundle (.aab) de release firmado**. Guardar la clave de subida fuera del repositorio y configurar Play App Signing. [Firma oficial Android](https://developer.android.com/studio/publish/app-signing).
7. Crear/configurar la ficha en Play Console, aportar material gráfico, información de privacidad/datos y acceso de revisión con una cuenta de pruebas restringida. Subir primero al canal de pruebas internas y revisar el informe previo al lanzamiento. Las cuentas personales nuevas pueden tener requisitos adicionales de pruebas para acceder a producción. [Configuración de la aplicación](https://support.google.com/googleplay/android-developer/answer/9859152), [canales de pruebas](https://support.google.com/googleplay/android-developer/answer/9845334).
8. Tras las pruebas, enviar a revisión y desplegar progresivamente. Las actualizaciones posteriores del paquete se publican con la misma identidad/firma y un código de versión superior; las distribuye Google Play. [Subir el paquete](https://developer.android.com/studio/publish/upload-bundle).

No se dará por terminada la preparación Android solo por compilar la web o por disponer de la carpeta `android`: faltan validación en dispositivo, paquete firmado y comprobación del canal de distribución.
