# App del chófer e inicio de sesión

El rediseño mantiene el logo y los servicios existentes. No requiere migraciones ni endpoints nuevos. Publicar el frontend desde `main`; en las distribuciones nativas se debe generar y sincronizar el paquete habitual de Capacitor.

## Pantallas

- Viajes activos e historial: tarjetas ampliables con teclado, documentación, fotos, incidencias y firma.
- Nuevo viaje: campos identificados, carga/descarga, cliente, rutas, mercancía y creación de DCD.
- Jornada: inicio y tiempo transcurrido real, conjunto, GPS, conducción/descanso, actividades y cierre. Los tiempos continúan utilizando el registro existente.
- Datos y firma, vacaciones y solicitudes de taller: mismos servicios, nuevos estilos y controles táctiles.
- Navegación inferior: inicio con datos reales, viajes, jornada, avisos disponibles y más opciones. Los apartados sujetos al plan conservan sus restricciones.
- Login: marca existente, formulario con autocompletado, mostrar/ocultar contraseña, recuperación de acceso, tema claro/oscuro y configuración de servidor cuando ya corresponde.

Las firmas adaptan las coordenadas al tamaño visible del lienzo y requieren un trazo para guardarse. Los fallos al cargar viajes o marcar avisos se muestran sin fingir que la operación ha terminado.

## Verificación

Ejecutar `npm run build` y `node scripts/driver_browser_check.cjs` desde el frontend. El script utiliza Playwright (`PLAYWRIGHT_MODULE` permite indicar su ubicación) y Edge sin ventana. Sirve la compilación local e intercepta todas las llamadas API con datos de prueba; no modifica producción.

Comprueba login/recuperación, todos los apartados a 360, 390 y 768 px en ambos temas, conjunto, jornada, firmas personales y de vacaciones, creación de viaje/DCD, solicitud de taller, error/reintento y cierre de sesión. Guarda capturas e informe en `build/qa/driver` (artefactos ignorados por Git).

La prueba de navegador verifica las solicitudes del frontend con respuestas simuladas. La cámara física, los permisos GPS del dispositivo y la entrega real de notificaciones dependen del dispositivo y del backend desplegado.
