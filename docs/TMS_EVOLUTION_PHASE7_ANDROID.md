# Fase 7 — Android, seguimiento y documentos privados

26/09/2026. Rama `codex/tms-evolution-phase0`. Sin publicación, credenciales de firma ni llamadas a empresas reales. La implementación local no equivale a aprobación de Google Play.

## Funciones y límites

| Requisito | Implementación / evidencia | Límite de validación |
| --- | --- | --- |
| Seguimiento nativo | Servicio foreground de ubicación, inicio visible, notificación persistente y Detener. Permisos de ubicación y notificaciones antes del arranque. | Sin teléfono conectado; consumo de batería y restricciones de fabricantes pendientes. |
| Fin de seguimiento | Contexto autorizado renovado cada 30 s, permiso temporal de hasta 120 s. Cierre/pausa de jornada, cambio de vehículo, fin de los viajes observados, sesión o retirada de la tarea lo detienen. No reinicio automático ni permiso de ubicación permanente. | Un cierre remoto puede tardar hasta 120 s en detener el servicio sin red. El servidor vuelve a validar jornada y vehículo dentro de la escritura GPS. |
| GPS externo | Solo una captura reciente con hora del dispositivo verificada sustituye al móvil. | Una recepción sin hora de captura no demuestra actualidad. |
| Push | FCM HTTP v1, token cifrado y asociado a empresa/usuario, cola sobre notificaciones internas existentes. Activación expresa y baja al salir. Mensaje de pantalla bloqueada genérico sin datos operativos. | Requiere proyecto Firebase, configuración Android y credencial servidor. Desactivado sin configuración; no se ha probado entrega real. |
| Reintentos | Reutiliza cola offline por propietario e identificadores de operación. FCM reclama cada entrega una vez; 429 permite reintento limitado, timeout/5xx queda incierto sin reenvío ciego. | Sin promesa de entrega exactamente una vez en el proveedor. |
| Documentos descargados | Originales PDF autenticados, hash, almacenamiento interno por empresa/usuario y sección Documentos descargados. Hasta 25 MB/documento y 200 MB/propietario. Abrir y retirar copia local. Sin backup Android ni token en archivos. | Copia consultable sin red no demuestra que siga siendo la versión vigente. Otros formatos conservan su flujo anterior. Retirar copia no borra el original. |
| Deep links | `transgest://chofer/pedidos/{uuid}`, sin parámetros de acciones ni secretos. Consulta autenticada del pedido antes de abrirlo. | No se anuncian Android App Links HTTPS verificados sin asociación del dominio/certificado. |
| Diagnóstico | El usuario puede compartir motivos y fechas de cierre Android, sin GPS ni credenciales. | No se añade telemetría automática; Android anterior a API 30 no ofrece ese histórico. |
| Identidad y UX | Se reutilizan navegación inferior, temas, cámara, mapa y acción por parada. Icono y splash nativos pasan de la plantilla Capacitor al símbolo vectorial TransGest existente. | Rotación, cámara, lector PDF, permisos y accesibilidad física requieren dispositivo. |
| Release | Workflow manual con versión, pruebas, lint, AAB y verificación de firma. Secretos en entorno CI; artefacto privado con retención de 7 días. Sin subida a Play. | Falta clave autorizada y ejecución real de CI; no se genera una identidad de firma inventada. |

## Pruebas locales

- Backend `npm run check`: salida 0. `node scripts/audit_workflows_regression_check.cjs`: salida 0, sin errores de esquema. Nuevas pruebas HTTP de contexto GPS propio, jornada incompatible y push desactivado.
- `driver_tracking_context_check.cjs`: empresa/conductor/vehículo, jornada cerrada y pausa, viajes activos y señal externa con hora verificada.
- `mobile_push_check.cjs`: migración repetida, cifrado, empresas/usuarios, reclamación concurrente, resultado incierto, 429, cambio de cuenta y baja. Proveedor simulado; cero mensajes reales.
- Frontend `CI=true npm test -- --watchAll=false --runInBand`: **49 suites, 123 pruebas, salida 0**. Incluye sesión antigua, enlace manipulado, configuración push ausente, permisos GPS y propietario de documentos.
- `npm run mobile:android:prepare`: salida 0 (build web y sincronización de 8 plugins); advertencias ESLint existentes. No se sirvió este build con API de producción al banco sintético.
- Gradle/JDK 21 y SDK 36 portátiles localizados y utilizados. Primer intento offline completo falló por dependencias de pruebas de Capacitor no almacenadas. La tarea se acotó a `:app:testDebugUnitTest :app:lintDebug :app:bundleRelease`; resultado 0, 3 pruebas JVM de `TrackingLease` aprobadas (más el test de ejemplo previo). Lint: 0 errores y advertencias de dependencias/recursos heredados y consulta opcional de recurso Firebase. `bundleRelease` genera AAB real; `jarsigner -verify` confirma **jar is unsigned**. No es una entrega firmada ni publicable. Se eliminaron permisos generales de lectura de galería: los adjuntos usan selección explícita, no acceso a toda la biblioteca.
- `adb devices -l`: **ningún dispositivo**. No confundir pruebas JVM con pruebas instrumentadas. El test de identidad de aplicación que aún esperaba `com.getcapacitor.app` se corrige a `com.gaunasoftware.transgest`.

## Configuración, migración y reversión

1. Aplicar `20260926_mobile_push.sql` con el migrador existente antes del servidor nuevo. Es aditiva, repetible; no modifica avisos históricos ni documentos. Probar en copia aislada y ejecutar las regresiones indicadas.
2. Push permanece desactivado por defecto. Para una prueba autorizada: `MOBILE_PUSH_ENABLED=true`, `MOBILE_PUSH_PROJECT_ID`, y credencial ADC por `GOOGLE_APPLICATION_CREDENTIALS` o `FCM_SERVICE_ACCOUNT_JSON`. Mantener la clave de cifrado del servidor estable. No incluir credenciales en variables React.
3. En el entorno GitHub `android-release`, configurar `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Solo si se activa push, `ANDROID_GOOGLE_SERVICES_BASE64`. Los archivos de firma y Firebase están ignorados por Git.
4. Invocar manualmente el workflow con un código superior al último de Play Console. El valor local 3 / 1.2.0 no afirma que sea el próximo código publicable. Revisar el AAB antes de la pista interna.
5. Reversión: desactivar push en servidor; publicar una actualización Android con un versionCode mayor y código compatible anterior (Play no permite bajar el código). Conservar tablas aditivas y originales. No borrar colas/documentos para revertir una interfaz.

## Privacidad y Data Safety: datos verificables para completar la ficha

Esta tabla describe el código, no sustituye una política de privacidad ni declara cumplimiento legal.

| Dato | Finalidad / destino | Control y retención |
| --- | --- | --- |
| Cuenta y empresa | Autenticación y permisos en API TransGest | Sesión revocable; no hay acceso anónimo a copias privadas. |
| Ubicación, hora, precisión, velocidad | Seguimiento de vehículo y eventos de la empresa; API TransGest por HTTPS | Inicio voluntario visible y Detener. Solo último punto pendiente en memoria nativa; histórico sujeto a política del servidor/empresa. |
| Token push y aviso genérico | Entrega de avisos mediante Google FCM | Activación expresa; cifrado servidor y baja por usuario. No enviar mercancía, identidad del cliente o coordenadas a FCM en el mensaje. |
| Documentos, fotos y firmas | Operativa/documentación existente de la empresa | Copias PDF internas por propietario; usuario puede retirar copias. Originales sometidos a conservación de empresa, sin borrado automático inventado. |
| Diagnóstico de cierre | Soporte, solo cuando el usuario lo comparte | Sin SDK externo de crash analytics ni envío automático. |

Antes de publicar deben aprobarse y alojarse una política real con responsable, contacto, finalidades, bases, plazos y mecanismos de derechos; completar Data Safety según servicios finalmente habilitados y contratos de tratamiento. No existe una URL de política validada en esta rama. También queda pendiente declarar y demostrar a Play el uso del foreground service de ubicación y las funciones con cámara. No solicitar permisos adicionales para cubrir un requisito de ficha.

## Recorrido de dispositivo pendiente

Probar Android 13–16 (y mínimo admitido), GPS aproximado/preciso/denegado, permiso de notificaciones, pantalla apagada, ahorro de batería, cierre remoto de jornada y viaje, cambio de conjunto, modo avión >120 s, regreso de red y cambio de cuenta. Verificar que no se envía después del cierre; no aparece GPS antiguo como actual; no hay doble evento al reintentar. Abrir originales y retirar copia con/sin red; comprobar que otra cuenta no los enumera. Probar cámara, giro, teclado y contraste claro/oscuro. Push real, notificación persistente, enlace frío/caliente y AAB firmado en pista interna siguen pendientes.

Fuentes técnicas: [restricciones de inicio de servicios Android](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [tipos de servicio foreground](https://developer.android.com/develop/background-work/services/fgs/service-types), [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api), [plugin push de Capacitor](https://capacitorjs.com/docs/apis/push-notifications).
