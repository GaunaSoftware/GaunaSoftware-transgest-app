# Entrega de la app del chófer — 17/09/2026

## Cambios

- AppChofer queda como coordinador; viajes, jornada/conjunto, perfil/vacaciones, nuevo viaje y taller se separan en componentes. Se conservan firmas, ADR, protocolo de cisternas, documentos, incidencias, historial y acciones pendientes de sincronizar.
- Tarjetas de viaje compactas, navegación uniforme, detalle con DCD y siguiente acción, mapa desplegable y formulario de alta en tres pasos. Diseño claro/oscuro y controles adaptados a móvil.
- Jornada con confirmación del conjunto y cuentakilómetros. El cierre exige al menos 1 km más que la apertura. Registro y actualización del vehículo son atómicos. Cambiar de tractora requiere cerrar la jornada de la anterior.
- Las acciones operativas del chófer interno requieren jornada abierta; consultar documentos sigue permitido. La lectura del cuentakilómetros se concentra en la jornada y conserva los datos históricos del viaje.
- Nuevo viaje consulta clientes activos de la empresa y puntos guardados de carga/descarga. No usa pedidos anteriores como catálogo ni selecciona automáticamente el único punto.
- El mapa refleja pasos pendientes, en curso y completados; posición externa reciente con alternativa de ubicación de la app en primer plano.
- Login anónimo con marca TransGest sin plan; limpieza de producto/sesión al salir y revalidación al restaurar el navegador. Las acciones sin conexión quedan separadas por empresa y usuario, incluso si una petición termina después de cambiar de cuenta.
- Correos de invitación y de transporte con marca TransGest y logo corporativo PNG/JPEG, datos de carga, DCD y enlaces de mapas. SMTP de empresa preferente; plataforma si no está configurado, con Reply-To de empresa cuando existe.
- Android: plugins App, Browser y Share, botón Atrás, firma por variables de entorno y copia de seguridad de la aplicación desactivada para evitar restaurar sesiones.

## Verificación realizada

- `npm run check` del backend: sintaxis, aislamiento de empresas, portal, geocodificación, Intelligence, operaciones, facturación y Planner; nueva regresión SQL real con PGlite para jornada, kilómetros, reintentos y rollback.
- `npm run security:regression`: aislamiento SQL/HTTP, soporte, permisos, productos, eliminación de empresas, SMTP local y protección de conexiones salientes.
- `driver_email_check.cjs`: selección real del remitente por la lógica del servicio, fallback, Reply-To, ambos logos CID y MIME de invitación/carga. Transporte de prueba en memoria, sin envío exterior.
- Frontend: 25 suites y 58 pruebas superadas; incluye sesiones, caché pendiente y colores del mapa.
- Compilación de producción final completada. Persisten advertencias del compilador/de ESLint; no errores de compilación.
- Edge con API local simulada: login y recuperación, siete secciones, temas claro/oscuro, anchos 375/390/393/430/768, formularios, firmas vacías/válidas, vacaciones, viaje/DCD, taller, errores y reintento, restricciones por plan y cierre de sesión. Sin errores JavaScript ni desbordamiento horizontal en las vistas comprobadas.
- `cap sync android`: finalizado con siete plugins nativos detectados.

## Límites de estas pruebas

Las pruebas locales no modificaron pedidos, jornadas ni destinatarios reales. No se ha enviado un correo por el SMTP real de una empresa ni comprobado recepción/entrega. No se ha contrastado la ubicación contra un tacógrafo real. Los mapas conservan su integración existente; los tests validan datos/estados y no certifican cada ruta de un proveedor externo.

No se ha compilado ni firmado un APK/AAB: este equipo no tiene Android Studio/SDK ni clave de firma. Falta la prueba en dispositivo físico y la publicación en Google Play. Procedimiento en `APP_CHOFER_ANDROID_PUBLICACION.md`.

## Comprobación de aceptación recomendada

1. Entrar como chófer en una cuenta de pruebas y verificar catálogo de clientes/puntos, DCD, firma y albarán.
2. Abrir jornada, confirmar conjunto y lectura; comprobar rechazo del cierre igual y aceptación con al menos 1 km adicional.
3. Cerrar sesión en Planner y entrar con una empresa sin Planner. Comprobar menú, botón Atrás del navegador y ausencia de datos anteriores.
4. Configurar SMTP de empresa y enviar una carga a un destinatario de prueba autorizado; revisar remitente, Reply-To, ambos logos y aceptación del viaje.
5. Instalar una compilación Android firmada en pruebas internas y completar la lista de cámara, GPS, documentos, teclado, Atrás y conexión de la guía de publicación.
