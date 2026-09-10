// ══════════════════════════════════════════════════════
// EMPAQUETADO PORTABLE DE ESCRITORIO (Windows)
// ══════════════════════════════════════════════════════
//
// Sortea el bloqueo de winCodeSign (symlinks de macOS que Windows no puede crear
// sin Modo desarrollador), que impide el icono/instalador nativos de
// electron-builder. Genera un ejecutable portable con el icono de TransGest y un
// zip distribuible:
//   1. electron-builder --win dir -> dist-desktop/win-unpacked sin winCodeSign.
//   2. rcedit  -> incrusta assets/icon.ico + datos de version en TransGest.exe.
//   3. Compress-Archive -> dist-desktop/TransGest-portable-win-x64.zip.
//
// Uso:  npm run desktop:build && node scripts/pack-desktop.js
// (o directamente:  npm run desktop:portable)
//
// Cuando se active el Modo desarrollador de Windows / se ejecute como Admin,
// electron-builder hara el icono e instalador NSIS por si mismo y este script deja
// de ser necesario (ver npm run desktop:dist).

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { rcedit } = require("rcedit");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "dist-desktop");
const UNPACKED = path.join(OUT, "win-unpacked");
const EXE = path.join(UNPACKED, "TransGest.exe");
const ICON = path.join(ROOT, "assets", "icon.ico");
const ZIP = path.join(OUT, "TransGest-portable-win-x64.zip");

async function main() {
  if (!fs.existsSync(ICON)) {
    console.error("Falta " + ICON + " (genera antes: node scripts/gen-desktop-icon.js)");
    process.exit(1);
  }

  console.log("1/3  electron-builder --win dir ...");
  // Un fallo debe parar el empaquetado para no distribuir un ejecutable antiguo.
  const packed = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), "--win", "dir", "--publish", "never", "-c.win.signAndEditExecutable=false"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  });
  if (packed.status !== 0 || !fs.existsSync(EXE)) {
    console.error("No se genero " + EXE);
    process.exit(1);
  }

  console.log("2/3  rcedit (icono + version) ...");
  await rcedit(EXE, {
    icon: ICON,
    "version-string": {
      ProductName: "TransGest",
      FileDescription: "TransGest - Gestion de transporte",
      CompanyName: "Gauna Software",
    },
    "file-version": "1.0.0",
    "product-version": "1.0.0",
  });

  console.log("3/3  zip ...");
  if (fs.existsSync(ZIP)) fs.unlinkSync(ZIP);
  if (process.platform === "win32") {
    const zipped = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${path.join(UNPACKED, "*")}' -DestinationPath '${ZIP}' -CompressionLevel Optimal`,
      ],
      { stdio: "inherit" }
    );
    if (zipped.status !== 0 || !fs.existsSync(ZIP)) throw new Error('No se pudo generar el ZIP de escritorio.');
    console.log("Listo -> " + ZIP);
  } else {
    console.log("win-unpacked listo en " + UNPACKED + " (comprime segun tu SO).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
