# App de chofer - fase 1 beta interna

## Alcance aplicado

- Contenedor movil preparado con Capacitor para Android/iOS.
- Seguimiento GPS limitado a jornada abierta y app en primer plano.
- Cola offline reforzada para pasos de viaje, estados, firmas, albaranes, incidencias, GPS manual y solicitudes de taller.
- Reintentos con backoff y estado visible para acciones pendientes o bloqueadas.
- Firma base obligatoria para usuarios con rol `chofer` si su ficha no tiene firma registrada.

## Decisiones de fase 1

- No se pide ubicacion en segundo plano. Esto reduce friccion con App Store y Google Play y evita declarar background location antes de validar el uso real.
- Las fotos/albaranes se guardan offline solo si caben de forma razonable en almacenamiento local. Si el archivo pesa demasiado, el chofer debe subirlo cuando vuelva la cobertura.
- Las notificaciones push nativas quedan fuera de esta fase. Se mantienen avisos dentro de la app.

## Variables y servidor

Antes de generar una beta instalada, configurar:

- `REACT_APP_API_URL=https://api.tu-dominio.com`
- `CORS_ORIGINS=https://app.tu-dominio.com,capacitor://localhost,ionic://localhost,http://localhost`
- Backend publicado por HTTPS con `/health` accesible.
- Cuenta demo de chofer con pedidos ficticios, vehiculo asignado y jornada de prueba.

## Comandos

Desde `transgest-frontend`:

```bash
copy .env.mobile.example .env.production.local
# Edita .env.production.local y cambia REACT_APP_API_URL por la API real.
npm run build
npx cap add android
npx cap add ios
npm run mobile:sync
```

Con Create React App en Windows tambien puedes compilar asi:

```powershell
$env:REACT_APP_API_URL="https://api.tu-dominio.com"
$env:GENERATE_SOURCEMAP="false"
npm run build
npx cap sync
```

Android se puede preparar en Windows. iOS requiere macOS con Xcode 26 o posterior para compilar/subir a TestFlight.

## Permisos a declarar

Android:

- `ACCESS_COARSE_LOCATION`
- `ACCESS_FINE_LOCATION`
- Camara/fotos segun uso del plugin Camera.
- No declarar `ACCESS_BACKGROUND_LOCATION` en fase 1.

iOS:

- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription` si el plugin lo requiere tecnicamente, explicando el uso de jornada activa.
- `NSCameraUsageDescription`
- `NSPhotoLibraryUsageDescription`

## Checklist antes de beta

- Login de chofer funciona contra servidor real.
- Chofer sin firma base no puede seguir sin registrarla.
- Iniciar jornada activa GPS foreground y cerrar/pausar detiene envio.
- Modo avion: pasos, firma, albaran pequeno e incidencia quedan en cola.
- Recuperar conexion sincroniza cola y limpia pendientes.
- Foto grande offline muestra aviso claro.
- `/health` backend OK durante prueba.
- Politica de privacidad menciona datos de cuenta, ubicacion, fotos/documentos, firmas, actividad de jornada y soporte.
