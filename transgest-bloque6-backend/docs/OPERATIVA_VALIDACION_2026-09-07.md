# Validacion de operativa: 7 septiembre 2026

## Cambios de esta entrega

- Mapa real con MapLibre GL JS. Usa MapTiler si existe REACT_APP_MAPTILER_KEY y OpenFreeMap en caso contrario. Conserva atribuciones; OpenStreetMap es el origen cartografico, no Leaflet. Paradas numeradas, informacion al pulsar, zoom y centrado responsive. No dibuja geometria inventada cuando falta ruta.
- Identidad de puntos por empresa, cliente/general, direccion, poblacion, provincia y pais. Comparacion normalizada por acentos, espacios y puntuacion. No mezcla calles iguales de poblaciones distintas. La migracion desactiva duplicados exactos del mismo ambito, sin borrar sus referencias historicas.
- Portal: puntos propios primero y generales despues; no admite seleccionar otro cliente mediante parametros. Avisos filtrados por audiencia ademas de usuario y empresa.
- Guardado de ruta y tarifa en transaccion, con bloqueo por identidad. Una tarifa fallida no deja una ruta creada a medias. Coincidencia exacta de poblacion tiene prioridad sobre provincia; Benissa admite Alicante como alternativa.
- Geocodificacion con direccion, poblacion, provincia y pais; diccionario ampliado y rechazo de candidatos incompatibles. Las coordenadas aproximadas de un municipio no se presentan como direccion precisa.
- Edicion de paradas sin eliminar el campo al vaciarlo, sin perder foco, y sin aplicar respuestas geograficas antiguas sobre cambios recientes. Seleccionar un punto aplica los datos y cierra el selector.
- Cierre de un pedido existente sin cambios no pide guardar. Los cambios reales siguen protegidos por confirmacion.
- Palets: limites de altura y desplazamiento de lotes en el formulario de movimiento, incluido movil con muchas obras.
- Dashboard conectado al resumen BI del servidor: realizado sin facturar, cobrado, pendiente, margen, EUR/km, documentos pendientes y ranking por cliente, segun datos disponibles.
- Sincronizacion de tractora y remolque del chofer desde el pedido, liberando el conjunto anterior.
- Automatismos de entrega en cola PostgreSQL persistente con reintento. Una nueva version encolada durante el procesamiento no queda marcada como completada por el trabajo anterior.

## Pruebas locales

La copia local estaba atrasada respecto a `origin/main` (`ddd06e6`). Se integra ese estado antes de publicar, conservando sus grupajes, catalogo completo de municipios, fechas reales de entrega, peticiones completas para KPIs y el recalculo geográfico sin cache. Las asociaciones explicitas de puntos a varios clientes se conservan al normalizar duplicados.

- Backend: `npm run check` (sintaxis, aislamiento por empresa, portal, geocodificacion, IA y regresiones operativas).
- PostgreSQL embebido PGlite: indice unico contextual, migracion repetible, transaccion de ruta/precio y reintentos de cola. No conecta a datos de produccion.
- Frontend: `npm run check` y `npm run build`. La version integrada conserva advertencias de hooks en QuickAssignModal, GestionTrafico, MiCuenta y SuperAdmin.
- `scripts/operativa_browser_check.cjs`: Edge headless, API simulada, pedido desktop y movil de 390px, seleccion de punto, cierre sin cambios, borrado continuo, mapa y paradas pulsables, 30 lotes de palets con desplazamiento acotado. Requiere Playwright instalado o PLAYWRIGHT_MODULE indicando su ruta.

## Despliegue

1. Frontend Vercel: raiz `transgest-bloque6-backend/transgest-frontend`, compilacion CRA y salida `build`.
2. Backend: desplegar tambien `transgest-bloque6-backend/transgest-backend`; no basta con publicar Vercel. Ejecutar `npm run migrate` con copia de seguridad vigente y reiniciar el servicio.
3. La migracion de puntos adquiere bloqueo de escritura mientras normaliza duplicados e instala el indice. Programarla teniendo en cuenta el volumen y actividad de la base.
4. Verificar respuesta publica con cabecera `X-TransGest-Frontend-Build: 2026-09-07-puntos-geocoding`, assets nuevos y CSP que permita MapTiler/OpenFreeMap y workers blob. No se eliminan atribuciones del proveedor.
5. Verificar salud de API, estado de migraciones, mapa con direcciones reales y acceso con perfiles reales.

## Pendiente de confirmar, no declarado resuelto

- Los errores de incidencias reportados por sus codigos de seguimiento necesitan logs de la API desplegada. El selector ya existe; no se ha demostrado la causa de esos errores de produccion.
- Prueba integral con usuarios reales de cliente, chofer, colaborador, trafico y gerente, incluyendo adjuntos, anulaciones y notificaciones. Las regresiones locales no sustituyen esta comprobacion.
- No se ha hecho una limpieza global de duplicados de clientes, choferes, vehiculos ni tarifas historicas, ni se han borrado registros operativos en produccion.
- La cola cubre automatismos de entrega de pedidos, no todos los procesos lentos del sistema. El cambio de estado y su encolado no forman una unica transaccion: un fallo de base entre ambos requiere recuperacion operativa.
- Guardar ubicacion estructurada evita nuevas ambiguedades; los puntos historicos con coordenadas incorrectas requieren revision de sus datos.
- Un push correcto no demuestra que Vercel y el backend hayan terminado de desplegar el mismo commit.

## Referencias del mapa

- https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/
- https://openfreemap.org/quick_start/

## Correccion de ubicaciones y formulario

- Consulta de solo lectura del pedido comunicado: tenia coordenadas de Madrid en una carga con ciudad Cojobar y provincia Burgos. No se modifico el pedido en produccion.
- Inferencia local por nombres completos y localidad estructurada antes del nombre comercial. Aspe no coincide con Raspeig; Santa no coincide con Minera Santa Marta. No se aplica un punto guardado al salir del campo sin seleccionarlo.
- Los enlaces cortos no extraen coordenadas del cuerpo HTML de Google, que puede contener un mapa por defecto segun la IP. El pin `!3d/!4d` tiene prioridad sobre el encuadre `@`. Sin pin verificable se usa geocodificacion estructurada.
- Validacion geografica compartida para guardar puntos y resolver rutas: coordenadas vacias no son cero, se rechazan contradicciones graves con Espana/localidad/provincia, conservando Canarias y destinos extranjeros con pais explicito. Es una comprobacion de coherencia, no una certificacion de la entrada exacta de la instalacion.
- El visor no dibuja puntos guardados sin resolverlos antes. Tambien resuelve una unica parada. Cache geografica v11 y recalculo sin cache.
- Nombre del punto vinculado en el extremo del formulario; su calle, ciudad y provincia siguen separadas para calcular la ruta. Editar la parada conserva el nombre comercial.
- Pais editable sin rellenarlo de nuevo en cada pulsacion. Minimo facturable y cantidad conservan la coma durante la edicion. Cambiar una direccion invalida sus coordenadas anteriores.
- Tipo/cantidad de palets, apilabilidad y dimensiones detalladas solo en grupaje. Peso, bultos, volumen y ML permanecen como antes; temperatura visible tambien en carga completa, incluido cero.
- Pruebas: `npm run geo:regression` incluye el caso simulado Cojobar/Madrid, Aspe, coordenadas vacias, enlaces cortos sin pin y limpieza de coordenadas contradictorias al guardar. Jest prueba coincidencias completas. La prueba de navegador incluye pais, coma decimal, grupaje y Aspe tras perder foco, ademas de las comprobaciones anteriores.
- La prueba real con un geocodificador externo quedo bloqueada por revision de permisos: requiere autorizacion para enviar la direccion empresarial. No se declara validada la ubicacion real exacta ni reparado el registro historico.
