# App móvil TransGest (Android + iOS)

La app móvil es la **misma web de TransGest empaquetada con Capacitor**. No es una
app solo de chófer: al iniciar sesión, **cada usuario ve lo suyo según su rol**:

- **Chófer** → app del chófer (viajes, pasos de carga/descarga, GPS, albaranes, ADR…).
- **Tráfico / Gerente / Administrativo / Contable / Taller** → el TMS completo adaptado a móvil.

Es decir, **una sola app para todos**; lo que cambia es lo que ve cada uno según su login.

- **Nombre**: TransGest · **ID de app**: `com.gaunasoftware.transgest`
- La app llama al backend de producción automáticamente (mismo `REACT_APP_API_URL`
  que la web; por defecto `https://transgest-backend.onrender.com`).

> IMPORTANTE (limitaciones de plataforma, no del proyecto):
> - **Android** se compila en **Windows** con Android Studio. ✅
> - **iOS** OBLIGA a un **Mac** con Xcode y una cuenta de **Apple Developer** (99 $/año).
>   No se puede compilar iOS en Windows.

---

## 0. Requisitos

- Node y npm (ya los usas para la web).
- **Android**: [Android Studio](https://developer.android.com/studio) (incluye el SDK y un emulador).
- **iOS** (solo en Mac): Xcode + CocoaPods (`sudo gem install cocoapods`) + cuenta Apple Developer.

Sitúate siempre en `transgest-bloque6-backend/transgest-frontend`.

---

## 1. Icono e imagen de la app (una vez)

La app necesita un **icono propio** (el logo de empresa que sale dentro de la app es
dinámico y no sirve como icono del sistema). Prepara **un PNG cuadrado de 1024×1024**
(fondo incluido) y colócalo en:

```
transgest-frontend/assets/icon-only.png      (icono, 1024x1024)
transgest-frontend/assets/splash.png         (opcional, 2732x2732, para la pantalla de carga)
```

Luego genera todos los tamaños automáticamente:

```
npm run mobile:icons
```

(Si no pones icono, la app se compila igual pero con el icono genérico de Capacitor.)

---

## 2. Android — compilar e instalar (Windows)

1. Genera el build web y sincroniza el proyecto nativo:
   ```
   npm run mobile:sync
   ```
2. Abre el proyecto en Android Studio:
   ```
   npm run mobile:open:android
   ```
3. En Android Studio:
   - Espera a que termine el "Gradle sync" la primera vez.
   - Conecta un móvil Android por USB (con **Depuración USB** activada) **o** usa un emulador.
   - Pulsa **Run ▶**. La app se instala y arranca en el dispositivo.

### Generar el APK para repartir (instalación manual)
- Menú **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
- El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`.
- Pásalo al móvil (WhatsApp, cable, Drive…) y ábrelo para instalar (hay que permitir
  "instalar apps de orígenes desconocidos" la primera vez).

### Para publicar en Google Play (opcional)
- Necesitas una **cuenta de Google Play Developer** (pago único de 25 $).
- En Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**,
  crea una clave de firma y guárdala (¡no la pierdas!). Sube el `.aab` a Play Console.

---

## 3. iOS — compilar e instalar (solo en Mac)

En un **Mac**, dentro de `transgest-frontend`:

1. Añade la plataforma iOS (solo la primera vez):
   ```
   npm run mobile:add:ios
   ```
2. Sincroniza:
   ```
   npm run mobile:sync
   ```
3. Abre en Xcode:
   ```
   npm run mobile:open:ios
   ```
4. En Xcode: selecciona el proyecto → pestaña **Signing & Capabilities** → elige tu
   **Team** (cuenta Apple Developer). Conecta un iPhone y pulsa **Run ▶**.
5. Para repartir por **TestFlight** o **App Store**: **Product → Archive** y sigue el
   asistente (requiere App Store Connect).

> Los permisos de cámara y ubicación de iOS ya piden explicación al usuario; si Xcode
> se queja, añade en `ios/App/App/Info.plist` las claves `NSLocationWhenInUseUsageDescription`
> y `NSCameraUsageDescription` con un texto (p. ej. "Para el seguimiento de rutas" y
> "Para adjuntar albaranes y documentos").

---

## 4. Actualizar la app cuando cambie la web

Cada vez que cambie el frontend y quieras llevarlo a la app:

```
npm run mobile:sync
```

Y vuelve a compilar/instalar (Run en Android Studio / Xcode). Como la web va
**empaquetada** dentro de la app (para que el chófer funcione sin cobertura),
cada cambio necesita recompilar e instalar de nuevo.

---

## 5. Permisos incluidos

- **Android** (`android/app/src/main/AndroidManifest.xml`): Internet, ubicación
  (fina y aproximada) y cámara/fotos. Ya configurados.
- **iOS**: se piden en tiempo de ejecución; añade los textos en `Info.plist` como se
  indica arriba.

---

## Resumen rápido

| Quiero… | Comando / acción |
|---|---|
| Preparar iconos | poner `assets/icon-only.png` (1024²) y `npm run mobile:icons` |
| Compilar Android | `npm run mobile:sync` → `npm run mobile:open:android` → Run |
| APK para repartir | Android Studio → Build → Build APK(s) |
| Compilar iOS (Mac) | `npm run mobile:add:ios` → `npm run mobile:sync` → `npm run mobile:open:ios` → Run |
| Actualizar tras cambios web | `npm run mobile:sync` + recompilar |
