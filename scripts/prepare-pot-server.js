#!/usr/bin/env node
// Prepara el proveedor oficial de PO Token (bgutil-ytdlp-pot-provider).
//
// Uso:
//   npm run prepare:pot
//       Genera assets/bin/pot-server.tar.gz (UN solo archivo con el servidor y
//       sus dependencias ya instaladas) y assets/bin/yt-dlp-plugins/<plugin>.zip.
//       "npm run dist" los mete en el instalador; en el primer arranque la app
//       extrae el .tar.gz en %APPDATA%\YT-DLP Minimalist\bin SIN usar internet.
//
//   npm run prepare:pot -- --managed
//       Instala la carpeta pot-server directamente en la carpeta de datos de la
//       app (para probar con "npm start" sin compilar).
//
//   npm run prepare:pot -- --version X.Y.Z     (otra versión del proveedor)
//
// Por qué un solo archivo: electron-builder y el instalador NSIS pueden perder
// o romper carpetas con miles de archivos y carpetas ocultas. Un .tar.gz viaja
// intacto. Las dependencias se instalan con npm (node_modules plano, sin
// enlaces simbólicos), y el servidor se ejecuta con Deno igual que antes.
//
// Requisitos: internet, Node/npm (ya los tienes para compilar) y "tar"
// (viene con Windows 10/11).

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const REPO = 'Brainicism/bgutil-ytdlp-pot-provider';
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const VERSION = getArg('--version') || '2.0.2';
const useManaged = args.includes('--managed');
const isWin = process.platform === 'win32';

function managedBinDir() {
  const name = 'YT-DLP Minimalist';
  if (isWin) return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), name, 'bin');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', name, 'bin');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), name, 'bin');
}

const projectRoot = path.join(__dirname, '..');
const outBin = useManaged ? managedBinDir() : path.join(projectRoot, 'assets', 'bin');
const pluginsDir = path.join(outBin, 'yt-dlp-plugins');

function log(msg) { console.log(`[pot] ${msg}`); }
function fail(msg) { console.error(`\n[pot] ERROR: ${msg}`); process.exit(1); }

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('Demasiadas redirecciones'));
    https.get(url, { headers: { 'User-Agent': 'yt-dlp-minimalist-setup' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return download(new URL(res.headers.location, url).toString(), dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} al descargar ${url}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
  if (r.error) fail(`No se pudo ejecutar "${cmd}": ${r.error.message}`);
  if (r.status !== 0) fail(`"${cmd} ${cmdArgs.join(' ')}" terminó con código ${r.status}`);
}

(async () => {
  log(`Destino: ${outBin}${useManaged ? '' : ' (modo empaquetado)'}`);
  log(`Versión del proveedor: ${VERSION}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pot-setup-'));
  try {
    // 1) Código fuente del servidor (tarball del tag en GitHub)
    const tgz = path.join(tmp, 'src.tar.gz');
    log('Descargando el código del servidor...');
    await download(`https://codeload.github.com/${REPO}/tar.gz/refs/tags/${VERSION}`, tgz);
    run('tar', ['-xzf', tgz, '-C', tmp]);
    const extracted = fs.readdirSync(tmp).find((n) => n.startsWith('bgutil-ytdlp-pot-provider-'));
    if (!extracted) fail('No se encontró la carpeta extraída del código fuente.');
    const srcServer = path.join(tmp, extracted, 'server');
    if (!fs.existsSync(path.join(srcServer, 'src', 'main.ts'))) fail('El código descargado no tiene server/src/main.ts.');

    // 2) Armar pot-server en una carpeta temporal e instalar dependencias de
    //    producción con npm (node_modules plano, sin enlaces simbólicos).
    const staging = path.join(tmp, 'pot-server');
    fs.mkdirSync(staging, { recursive: true });
    for (const f of ['package.json', 'package-lock.json']) {
      fs.copyFileSync(path.join(srcServer, f), path.join(staging, f));
    }
    fs.cpSync(path.join(srcServer, 'src'), path.join(staging, 'src'), { recursive: true });

    log('Instalando dependencias con npm (descarga el módulo nativo "canvas")...');
    run(isWin ? 'npm.cmd' : 'npm', ['ci', '--omit=dev'], { cwd: staging, shell: isWin });

    // .bin solo trae atajos para herramientas de línea de comandos que el
    // servidor no usa; en Linux/macOS son enlaces simbólicos.
    fs.rmSync(path.join(staging, 'node_modules', '.bin'), { recursive: true, force: true });
    // Se escribe al final: la app lo usa para saber que la instalación terminó.
    fs.writeFileSync(path.join(staging, 'VERSION'), VERSION + '\n');

    fs.mkdirSync(outBin, { recursive: true });
    if (useManaged) {
      // Carpeta lista para usar en la carpeta de datos de la app.
      const dest = path.join(outBin, 'pot-server');
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(staging, dest, { recursive: true });
      log(`Servidor instalado en: ${dest}`);
    } else {
      // Un solo archivo para el instalador. Si había una carpeta pot-server
      // de una versión anterior de este script, se quita para que
      // electron-builder no la empaquete también.
      const legacy = path.join(outBin, 'pot-server');
      if (fs.existsSync(legacy)) {
        fs.rmSync(legacy, { recursive: true, force: true });
        log(`Eliminada la carpeta antigua: ${legacy}`);
      }
      const archive = path.join(outBin, 'pot-server.tar.gz');
      fs.rmSync(archive, { force: true });
      run('tar', ['-czf', archive, '-C', tmp, 'pot-server']);
      const mb = (fs.statSync(archive).size / 1048576).toFixed(1);
      log(`Archivo generado: ${archive} (${mb} MB)`);
    }

    // 3) Plugin de yt-dlp de la MISMA versión
    fs.mkdirSync(pluginsDir, { recursive: true });
    const pluginZip = path.join(pluginsDir, 'bgutil-ytdlp-pot-provider.zip');
    log('Descargando el plugin de yt-dlp...');
    await download(`https://github.com/${REPO}/releases/download/${VERSION}/bgutil-ytdlp-pot-provider.zip`, pluginZip);

    // 4) Quitar restos de la versión anterior (Rust), que chocaría con este plugin
    for (const old of [
      path.join(pluginsDir, 'bgutil-ytdlp-pot-provider-rs.zip'),
      path.join(outBin, 'bgutil-pot.exe'),
    ]) {
      if (fs.existsSync(old)) {
        fs.renameSync(old, old + '.bak');
        log(`Renombrado a .bak: ${old}`);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  log('Listo.');
})().catch((e) => fail(e.message));
