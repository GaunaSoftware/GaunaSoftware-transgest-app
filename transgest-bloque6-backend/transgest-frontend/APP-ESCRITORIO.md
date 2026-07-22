# TransGest — App de escritorio (.exe)

TransGest puede usarse **por navegador (SaaS en la nube)** o como **programa de
escritorio instalable** para el cliente que lo quiera en local. El ejecutable es
la **misma web** (`transgest-frontend`) envuelta con **Electron** — no es un
programa aparte y no duplica funciones.

## Modo de servidor (configurable)

El `.exe` no trae backend propio. Al arrancar apunta al **servidor en la nube por
defecto**. En la pantalla de login hay un enlace **"Servidor: nube (por defecto)"**
(solo visible en el ejecutable, o si ya hay un servidor personalizado) que abre un
cuadro para escribir la dirección de un **servidor local / on-premise**
(ej. `http://192.168.1.20:3000`). Se guarda en el equipo y la app recarga
apuntando a ese backend. Dejarlo vacío = volver a la nube.

La lógica vive en [`src/utils/serverConfig.js`](src/utils/serverConfig.js):
`localStorage("transgest_api_url")` → `REACT_APP_API_URL` (build) → nube. Todos los
módulos resuelven la URL con `resolveApiBase()`.

> Nota: para un **on-premise completo** (backend + base de datos en el equipo del
> cliente, sin internet) hay que desplegar aparte el `transgest-backend` y su
> PostgreSQL en la máquina/red del cliente y apuntar el `.exe` a esa URL. El
> ejecutable ya está preparado para ello; el empaquetado del backend+BD es un paso
> separado y todavía pendiente.

## Estructura

- `electron/main.js` — proceso principal (ventana, abre enlaces externos en el
  navegador del sistema, instancia única, sin menú nativo).
- `electron/preload.js` — expone `window.transgestDesktop` para que la web sepa que
  corre dentro del ejecutable.
- `package.json` → campo `main` = `electron/main.js` y bloque `build` de
  electron-builder (`extends: null` para no usar el preset react-cra).

## Compilar

Desde `transgest-frontend/`:

```bash
# 1. Compila la web con rutas relativas (necesario para file://)
npm run desktop:build

# 2a. Versión PORTABLE (carpeta ejecutable, sin instalador) -> lo que funciona hoy
npx electron-builder --win dir
#     Resultado: dist-desktop/win-unpacked/TransGest.exe  (carpeta autocontenida)

# 2b. Instalador NSIS (.exe de instalación) -> requiere permiso de symlinks
npm run desktop:dist
#     Resultado: dist-desktop/TransGest Setup 1.0.0.exe
```

`npm run desktop:run` lanza la app con Electron sobre el último `build/` (para probar
sin empaquetar).

## Distribuir hoy (portable)

Ya generado: **`dist-desktop/TransGest-portable-win-x64.zip`** (~111 MB). El cliente
lo descomprime y ejecuta **`TransGest.exe`** — no necesita instalar nada. Probado:
arranca y muestra la ventana "TransGest TMS".

## Instalador NSIS — limitación conocida (Windows)

`electron-builder` descarga `winCodeSign`, que contiene symlinks de macOS. En
Windows **sin privilegio de crear symlinks** falla con:
`Cannot create symbolic link ... El cliente no dispone de un privilegio requerido`.
Esto bloquea los targets `nsis` y `zip` (no la carpeta `dir`, que sí se genera).

**Solución (una vez):** activar el privilegio y volver a lanzar `npm run desktop:dist`:
- **Modo desarrollador de Windows**: Configuración → Privacidad y seguridad → Para
  programadores → *Modo de desarrollador* = ON. (O)
- Ejecutar la terminal **como Administrador** antes de `npm run desktop:dist`.

Con eso `electron-builder` extrae `winCodeSign` y produce el instalador NSIS
(`TransGest Setup 1.0.0.exe`) con accesos directos y opción de elegir carpeta.

## Icono

Sin icono propio usa el de Electron. Para icono de empresa: añadir
`assets/icon.ico` (256×256) — electron-builder lo toma automáticamente (carpeta
`buildResources: assets`).

## macOS / Linux

El bloque `build` ya define `dmg` (mac) y `AppImage` (linux). macOS **obliga a
compilar en un Mac**; Linux se compila en Linux (o WSL). En Windows solo se generan
los targets de Windows.
