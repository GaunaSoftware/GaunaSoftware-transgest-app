// ══════════════════════════════════════════════════════
// TRANSGEST DESKTOP — proceso principal de Electron
// ══════════════════════════════════════════════════════
//
// Envuelve la misma web (carpeta build/) en un ejecutable de escritorio.
// El .exe NO trae backend propio: apunta al servidor en la nube por defecto,
// y el usuario puede cambiarlo a un servidor local desde la pantalla de login
// (Servidor -> direccion on-premise). Ver src/utils/serverConfig.js.

const { app, BrowserWindow, shell, Menu, protocol, net } = require("electron");
const path = require("path");
const { pathToFileURL } = require('url');
protocol.registerSchemesAsPrivileged([{ scheme:'transgest', privileges:{ standard:true, secure:true, supportFetchAPI:true, corsEnabled:true } }]);

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
    minWidth: 480,
    minHeight: 480,
    backgroundColor: "#0d1017",
    show: false,
    autoHideMenuBar: true,
    title: "TransGest",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => { if (process.env.TRANSGEST_DESKTOP_TEST !== '1') mainWindow.show(); });

  // Los enlaces externos (mapas, documentos, portal cliente) se abren en el
  // navegador del sistema, no dentro de la app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    // Solo ventanas locales para impresion; nunca ejecutar paginas remotas.
    if (url === 'about:blank' || url.startsWith('blob:transgest://app/')) return { action:'allow', overrideBrowserWindowOptions:{ webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true} } };
    return { action: "deny" };
  });

  mainWindow.webContents.on('will-navigate', (event,url) => {
    if (!url.startsWith('transgest://app/')) { event.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  mainWindow.loadURL('transgest://app/index.html');
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  protocol.handle('transgest', request => {
    const url = new URL(request.url);
    const root = path.resolve(__dirname,'..','build');
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
    if (url.hostname !== 'app' || !file.startsWith(root + path.sep)) return new Response('Forbidden',{status:403});
    return net.fetch(pathToFileURL(file).toString());
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', event => event.preventDefault());
  });
  Menu.setApplicationMenu(null); // sin barra de menu nativa
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
