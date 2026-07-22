// ══════════════════════════════════════════════════════
// TRANSGEST DESKTOP — proceso principal de Electron
// ══════════════════════════════════════════════════════
//
// Envuelve la misma web (carpeta build/) en un ejecutable de escritorio.
// El .exe NO trae backend propio: apunta al servidor en la nube por defecto,
// y el usuario puede cambiarlo a un servidor local desde la pantalla de login
// (Servidor -> direccion on-premise). Ver src/utils/serverConfig.js.

const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

// Instancia unica: si ya hay una ventana abierta, enfocarla.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0d1017",
    show: false,
    autoHideMenuBar: true,
    title: "TransGest",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // La app carga contenido local de confianza (build/) y habla con un
      // backend conocido (nube o local). Desactivar webSecurity evita bloqueos
      // CORS al apuntar a cualquier servidor, sin exponer contenido remoto.
      webSecurity: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Los enlaces externos (mapas, documentos, portal cliente) se abren en el
  // navegador del sistema, no dentro de la app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.loadFile(path.join(__dirname, "..", "build", "index.html"));
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // sin barra de menu nativa
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
