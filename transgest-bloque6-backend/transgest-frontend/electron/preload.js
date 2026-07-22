// Preload de TransGest Desktop.
// Expone una marca minima para que la web sepa que corre dentro del ejecutable
// (isDesktopApp() en src/utils/serverConfig.js la detecta) y muestre el
// configurador de servidor.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("transgestDesktop", {
  isDesktop: true,
  platform: process.platform,
});
