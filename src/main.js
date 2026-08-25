const { app, BrowserWindow, ipcMain, shell, dialog, session, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');

// ---- Cifrado de cookies en disco ----
// Las cookies (login dentro de la app o archivos cookies.txt elegidos por el
// usuario) contienen credenciales de sesión, así que se guardan cifradas con
// safeStorage de Electron: en Windows usa DPAPI ligado al usuario de Windows,
// en macOS el Keychain, y en Linux el keyring del sistema (o cae a texto
// plano si el sistema no tiene ninguno disponible, ej. algunos entornos sin
// keyring configurado). El cifrado queda atado a la máquina/usuario: un
// archivo .enc copiado a otra PC no se puede descifrar ahí.
function encryptToFile(filePath, text) {
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(filePath, safeStorage.encryptString(text));
  } else {
    console.warn('[cookies] Cifrado no disponible en este sistema; se guarda sin cifrar:', filePath);
    fs.writeFileSync(filePath, text, 'utf-8');
  }
}

function decryptFromFile(filePath) {
  const buf = fs.readFileSync(filePath);
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buf);
    } catch (e) {
      // Puede ser un archivo de una versión anterior guardado sin cifrar:
      // lo devolvemos tal cual en vez de fallar.
      return buf.toString('utf-8');
    }
  }
  return buf.toString('utf-8');
}

// Descifra un archivo de cookies gestionado por la app a un archivo temporal
// en texto plano, que es lo que yt-dlp necesita leer con --cookies. El
// archivo temporal se borra apenas termina ese proceso de yt-dlp (ver
// cleanupTempCookieFiles en cada punto donde se invoca yt-dlp).
function decryptToTempFile(encPath, site) {
  try {
    const text = decryptFromFile(encPath);
    const tempDir = app.getPath('temp');
    const tempPath = path.join(tempDir, `ytdlp-interface-cookies-${site}-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(tempPath, text, { mode: 0o600 });
    return tempPath;
  } catch (e) {
    console.error('[cookies] No se pudo descifrar el archivo de cookies:', e.message);
    return null;
  }
}

function cleanupTempCookieFiles(tempFiles) {
  for (const filePath of tempFiles || []) {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      // No es crítico si falla el borrado (ej. el archivo ya no existe).
    }
  }
}

// Al cancelar una descarga en curso se borran sus restos en disco: el/los
// archivo(s) parcial(es) que yt-dlp venía escribiendo (sufijo ".part"), el
// sidecar ".ytdl" que usa para poder retomar una descarga, y cualquier
// archivo secundario que ya se hubiera terminado de bajar (ej. la miniatura
// .webp para --embed-thumbnail). "destinations" es el set de rutas base
// detectadas en el stdout de yt-dlp para esa descarga (una por cada pista:
// video, audio, miniatura...).
//
// Se reintenta un par de veces con una pequeña espera: en Windows, justo
// después de matar el proceso (taskkill) el archivo puede seguir "en uso"
// una fracción de segundo más, y el primer intento de borrado fallaría
// aunque el proceso ya esté muerto.
function deletePartialDownloadFiles(destinations, attempt = 0) {
  const remaining = [];
  for (const basePath of destinations || []) {
    if (!basePath) continue;
    for (const candidate of [basePath, `${basePath}.part`, `${basePath}.ytdl`]) {
      try {
        if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
      } catch (e) {
        remaining.push(basePath);
      }
    }
  }
  if (remaining.length && attempt < 3) {
    setTimeout(() => deletePartialDownloadFiles(remaining, attempt + 1), 400);
  }
}

// Recorre un directorio (recursivo, con límite de profundidad) y devuelve el
// set de rutas de archivo que contiene en ese momento. Se usa para comparar
// un "antes" y un "después" de una descarga y así saber, sin depender de
// parsear texto para nada, exactamente qué archivos creó esa descarga.
function snapshotDirFiles(dir, depth = 0) {
  const result = new Set();
  if (!dir || depth > 4) return result;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return result; // la carpeta puede no existir todavía (yt-dlp la crea al escribir)
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const f of snapshotDirFiles(full, depth + 1)) result.add(f);
    } else {
      result.add(full);
    }
  }
  return result;
}

// La forma más confiable de saber qué borrar al cancelar: comparar el
// contenido de la carpeta de destino ANTES de arrancar la descarga contra el
// contenido DESPUÉS de matar el proceso. Cualquier archivo nuevo (video
// parcial, .part, .ytdl, miniatura, lo que sea) es necesariamente algo que
// esa descarga creó, así que se borra — sin importar su nombre exacto, su
// extensión, ni si el texto de yt-dlp se pudo parsear bien o no. Es el
// respaldo definitivo por si deletePartialDownloadFiles/cleanupOrphanedPartialFiles
// no dieron con el archivo por algún desfase de nombre/codificación.
function deleteNewFilesSince(dir, preExistingFiles, attempt = 0) {
  const postFiles = snapshotDirFiles(dir);
  const remaining = [];
  for (const full of postFiles) {
    if (preExistingFiles.has(full)) continue; // ya estaba antes de esta descarga, no tocar
    try {
      fs.unlinkSync(full);
    } catch (e) {
      remaining.push(full);
    }
  }
  if (remaining.length && attempt < 3) {
    setTimeout(() => deleteNewFilesSince(dir, preExistingFiles, attempt + 1), 400);
  }
}

// Respaldo de deletePartialDownloadFiles: en vez de confiar en las rutas
// parseadas del stdout de yt-dlp (que pueden llegar corruptas si el título
// tiene caracteres no-ASCII, ver PYTHONIOENCODING más abajo), recorre
// directamente la carpeta de destino y borra cualquier archivo con
// extensión ".part"/".ytdl" que se haya modificado durante esta descarga.
// Esas dos extensiones SOLO las usa yt-dlp para archivos en curso, nunca
// para un archivo final ya terminado, así que es seguro borrarlos sin
// depender de saber el nombre exacto.
function cleanupOrphanedPartialFiles(dir, sinceTime, depth = 0) {
  if (!dir || depth > 3) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  const PARTIAL_EXTENSIONS = new Set(['.part', '.ytdl']);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanupOrphanedPartialFiles(full, sinceTime, depth + 1);
      continue;
    }
    if (!PARTIAL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      const stat = fs.statSync(full);
      // Margen de 2s por si el reloj del archivo y el de Date.now() no coinciden exacto.
      if (stat.mtimeMs >= sinceTime - 2000) fs.unlinkSync(full);
    } catch (e) {
      // No es crítico: puede que ya no exista o siga ocupado un instante.
    }
  }
}

let mainWindow;

// Procesos de yt-dlp en ejecución, indexados por downloadId, para poder
// pausarlos o cancelarlos desde el panel de "Descargas en curso".
const activeProcs = new Map();

// Mata un proceso y TODO su árbol de descendientes. Es necesario porque en
// Windows el "yt-dlp.exe" que se descarga es un ejecutable de PyInstaller
// en modo --onefile: al arrancarlo, ese .exe es en realidad un lanzador que
// crea un proceso hijo aparte donde corre el yt-dlp real. proc.kill() de
// Node SOLO mata el proceso que se guardó (el lanzador) y no se entera del
// hijo, así que la descarga real seguía corriendo de fondo aunque el botón
// "pausar"/"cancelar" pareciera no hacer nada. taskkill con /T mata todo el
// árbol (lanzador + yt-dlp real + ffmpeg si estaba fusionando). En
// mac/Linux no aplica ese problema (yt-dlp corre en un solo proceso), así
// que ahí basta con proc.kill().
function killProcessTree(proc) {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  if (process.platform === 'win32' && proc.pid) {
    const { execFile } = require('child_process');
    try {
      execFile('taskkill', ['/pid', String(proc.pid), '/t', '/f'], (err) => {
        if (err) {
          // Si taskkill falla por lo que sea, al menos se intenta matar el
          // proceso directo como último recurso.
          proc.kill();
        }
      });
    } catch (e) {
      proc.kill();
    }
  } else {
    proc.kill();
  }
}

// ---- Presets predeterminados (mismo patrón que apps como media-downloader) ----
// Sin preajustes por defecto: solo quedan las dos opciones incorporadas
// ("Mejor video y audio disponible" / "Mejor audio disponible (MP3)"), que no
// vienen de aquí sino que se generan siempre en renderer.js.
const DEFAULT_PRESETS = [];

function getPresetsPath() {
  return path.join(app.getPath('userData'), 'presets.json');
}

function loadPresets() {
  const filePath = getPresetsPath();
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(DEFAULT_PRESETS, null, 2), 'utf-8');
      return DEFAULT_PRESETS;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return DEFAULT_PRESETS;
  }
}

function savePresetsToDisk(presets) {
  fs.writeFileSync(getPresetsPath(), JSON.stringify(presets, null, 2), 'utf-8');
  return presets;
}

// ---- Configuración de descarga (ruta, plantilla de salida, cookies, límite de velocidad) ----

// Sitios con configuración de cookies propia. "other" es el fallback para
// cualquier link que no matchee ninguno de los sitios con nombre (no soporta
// "Iniciar sesión con cuenta" porque no hay una ventana de login genérica).
const COOKIE_SITE_KEYS = ['youtube', 'tiktok', 'instagram', 'twitter', 'threads', 'bilibili', 'other'];

function getDefaultCookiesPerSite() {
  const obj = {};
  for (const key of COOKIE_SITE_KEYS) {
    obj[key] = { mode: 'none', browser: 'firefox', file: '' }; // mode: 'none' | 'browser' | 'file' | 'applogin'
  }
  return obj;
}

function getDefaultSettings() {
  return {
    downloadPath: path.join(os.homedir(), 'Downloads'),
    outputTemplate: '%(title).200B - %(uploader).30B.%(ext)s',
    // Cookies por sitio: cada sitio (youtube/tiktok/instagram/twitter/threads/bilibili/other)
    // tiene su propio modo, para que la app elija automáticamente según el link pegado
    // en vez de un único modo global para toda la app.
    cookiesPerSite: getDefaultCookiesPerSite(),
    rateLimit: '', // ej. "1M", "500K" — vacío = sin límite
    concurrentDownloads: 1, // cuántos videos de una lista se descargan a la vez
    ytdlpChannel: 'nightly', // 'stable' | 'nightly' — de qué repo de GitHub se baja/compara yt-dlp
    soundEnabled: true, // sonido al terminar una descarga o la instalación automática de dependencias
  };
}

// Valida/normaliza lo que llega desde el renderer para cookiesPerSite, para no
// terminar guardando en disco un modo inválido o una clave de sitio inexistente.
function sanitizeCookiesPerSite(input) {
  const result = getDefaultCookiesPerSite();
  if (input && typeof input === 'object') {
    for (const key of COOKIE_SITE_KEYS) {
      const entry = input[key];
      if (!entry || typeof entry !== 'object') continue;
      let mode = ['none', 'browser', 'file', 'applogin'].includes(entry.mode) ? entry.mode : 'none';
      // "Otros sitios" no tiene ventana de login propia (ver LOGIN_SITES), así que
      // "applogin" no aplica ahí; si llega así, lo tratamos como "none".
      if (key === 'other' && mode === 'applogin') mode = 'none';
      result[key] = {
        mode,
        browser: (entry.browser && String(entry.browser)) || 'firefox',
        file: (entry.file && String(entry.file)) || '',
      };
    }
  }
  return result;
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

// Migra la configuración vieja de cookies (un único modo global para toda la
// app) al nuevo esquema por sitio, para que quienes actualizan la app no
// pierdan lo que ya tenían configurado. Sólo corre una vez: si el archivo ya
// tiene "cookiesPerSite" no se toca nada.
function migrateLegacyCookieSettings(raw) {
  if (!raw || raw.cookiesPerSite || !raw.cookiesMode) return raw;

  const perSite = getDefaultCookiesPerSite();
  if (raw.cookiesMode === 'applogin' && raw.cookiesAppLoginSite && perSite[raw.cookiesAppLoginSite]) {
    // El login por cuenta ya era por sitio internamente (login-cookies/<sitio>.txt),
    // así que se traslada tal cual al sitio correspondiente.
    perSite[raw.cookiesAppLoginSite] = { mode: 'applogin', browser: 'firefox', file: '' };
  } else if (raw.cookiesMode === 'browser' || raw.cookiesMode === 'file') {
    // Antes esto se aplicaba a TODA la app por igual; como no sabemos si ese
    // navegador/archivo sirve para cada sitio en particular, lo dejamos sólo
    // en "Otros sitios" y que el usuario lo reconfigure explícitamente donde
    // lo necesite desde Configuración → Descarga.
    perSite.other = { mode: raw.cookiesMode, browser: raw.cookiesBrowser || 'firefox', file: raw.cookiesFile || '' };
  }

  const migrated = { ...raw, cookiesPerSite: perSite };
  delete migrated.cookiesMode;
  delete migrated.cookiesBrowser;
  delete migrated.cookiesFile;
  delete migrated.cookiesAppLoginSite;
  return migrated;
}

function loadSettings() {
  const filePath = getSettingsPath();
  const defaults = getDefaultSettings();
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaults, null, 2), 'utf-8');
      return defaults;
    }
    const raw = migrateLegacyCookieSettings(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    const merged = { ...defaults, ...raw };
    merged.cookiesPerSite = sanitizeCookiesPerSite(raw.cookiesPerSite);
    return merged;
  } catch (e) {
    return defaults;
  }
}

function saveSettingsToDisk(settings) {
  const merged = { ...getDefaultSettings(), ...settings };
  merged.cookiesPerSite = sanitizeCookiesPerSite(settings.cookiesPerSite);
  // Limitar a un rango razonable (1-5) para evitar saturar la red o el sistema
  const concurrent = parseInt(merged.concurrentDownloads, 10);
  merged.concurrentDownloads = Number.isFinite(concurrent) ? Math.min(5, Math.max(1, concurrent)) : 1;
  fs.writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

// Detecta a qué sitio (de los que tienen configuración de cookies propia)
// pertenece un link, para poder elegir automáticamente sus cookies sin que
// el usuario tenga que ir cambiando un modo global cada vez.
function detectCookieSite(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    if (hostname.endsWith('youtube.com') || hostname === 'youtu.be') return 'youtube';
    if (hostname.endsWith('tiktok.com')) return 'tiktok';
    if (hostname.endsWith('instagram.com')) return 'instagram';
    if (hostname.endsWith('twitter.com') || hostname.endsWith('x.com')) return 'twitter';
    if (hostname.endsWith('threads.net') || hostname.endsWith('threads.com')) return 'threads';
    if (hostname.endsWith('bilibili.com') || hostname.endsWith('b23.tv')) return 'bilibili';
  } catch (e) {
    // URL inválida o vacía: cae al fallback "other" de abajo
  }
  return 'other';
}

// Construye los argumentos de yt-dlp derivados de la configuración (cookies + límite de velocidad).
// El sitio se detecta automáticamente a partir del link, y usa la configuración
// de cookies de ESE sitio en particular (no un modo único para toda la app).
// Devuelve { args, tempFiles }: args son los argumentos para yt-dlp, y
// tempFiles son rutas de archivos temporales en texto plano (descifrados)
// que el llamador DEBE borrar con cleanupTempCookieFiles() apenas termine
// ese proceso de yt-dlp (éxito, error o cancelación).
function buildSettingsArgs(settings, url) {
  const args = [];
  const tempFiles = [];

  // Si el usuario instaló Deno desde el panel de Actualizaciones, se lo
  // indicamos explícitamente a yt-dlp: lo necesita para resolver los retos
  // JS de YouTube (incluyendo videos con restricción de edad y otros
  // formatos bloqueados) desde que YouTube dejó de poder resolverse solo
  // con el intérprete JS integrado de yt-dlp.
  const denoPath = getDenoPath();
  if (denoPath) {
    args.push('--js-runtimes', `deno:${denoPath}`);
  }

  const perSite = settings.cookiesPerSite || getDefaultCookiesPerSite();
  const site = detectCookieSite(url);
  const siteConfig = perSite[site] || perSite.other;

  if (siteConfig.mode === 'browser' && siteConfig.browser) {
    args.push('--cookies-from-browser', siteConfig.browser);
  } else if (siteConfig.mode === 'file' && siteConfig.file && fs.existsSync(siteConfig.file)) {
    if (siteConfig.file.startsWith(getFileCookiesDir())) {
      // Es nuestra copia gestionada (cifrada): descifrarla a un temporal.
      const tempPath = decryptToTempFile(siteConfig.file, site);
      if (tempPath) {
        args.push('--cookies', tempPath);
        tempFiles.push(tempPath);
      }
    } else {
      // Archivo externo elegido/escrito a mano por el usuario: se usa tal
      // cual, ya que no es un archivo que la app generó ni puede cifrar de
      // forma transparente sin romper el flujo del usuario.
      args.push('--cookies', siteConfig.file);
    }
  } else if (siteConfig.mode === 'applogin' && site !== 'other') {
    // Cookies capturadas al iniciar sesión dentro de la propia app (ver sección
    // "Iniciar sesión con cuenta" más abajo), guardadas cifradas en disco.
    const cookieFile = getLoginCookiesFile(site);
    if (fs.existsSync(cookieFile)) {
      const tempPath = decryptToTempFile(cookieFile, site);
      if (tempPath) {
        args.push('--cookies', tempPath);
        tempFiles.push(tempPath);
      }
    }
  }

  if (settings.rateLimit && settings.rateLimit.trim()) {
    args.push('--limit-rate', settings.rateLimit.trim());
  }

  return { args, tempFiles };
}

// ---- "Iniciar sesión con cuenta": abre una ventana de Electron con el sitio real
// para que el usuario inicie sesión normalmente, y al cerrarla capturamos las
// cookies de esa sesión (ya descifradas, porque las maneja la propia app) y las
// guardamos como cookies.txt para que yt-dlp las use. Esto evita por completo el
// problema de DPAPI de "cookies desde el navegador" en Windows.
const LOGIN_SITES = {
  youtube: { label: 'YouTube', url: 'https://www.youtube.com', partition: 'persist:applogin-youtube' },
  tiktok: { label: 'TikTok', url: 'https://www.tiktok.com/login', partition: 'persist:applogin-tiktok' },
  instagram: { label: 'Instagram', url: 'https://www.instagram.com/accounts/login/', partition: 'persist:applogin-instagram' },
  twitter: { label: 'X / Twitter', url: 'https://x.com/i/flow/login', partition: 'persist:applogin-twitter' },
  threads: { label: 'Threads', url: 'https://www.threads.net/login', partition: 'persist:applogin-threads' },
  bilibili: { label: 'Bilibili', url: 'https://passport.bilibili.com/login', partition: 'persist:applogin-bilibili' },
};

// User-Agent de un Chrome de escritorio normal: varios sitios (sobre todo Google)
// bloquean o limitan el login dentro de ventanas embebidas si detectan el user-agent
// por defecto de Electron. Esto no lo garantiza al 100% (Google puede seguir
// mostrando "este navegador podría no ser seguro" en algunos casos), pero ayuda.
const LOGIN_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function getLoginCookiesDir() {
  const dir = path.join(app.getPath('userData'), 'login-cookies');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getLoginCookiesFile(site) {
  return path.join(getLoginCookiesDir(), `${site}.enc`);
}

// Migración: versiones anteriores guardaban estas cookies como
// login-cookies/<sitio>.txt sin cifrar. Si existe ese archivo viejo y todavía
// no hay uno .enc, lo migramos cifrándolo y borramos el original.
function migrateLegacyLoginCookiesFile(site) {
  const legacyPath = path.join(getLoginCookiesDir(), `${site}.txt`);
  const newPath = getLoginCookiesFile(site);
  if (fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
    try {
      const text = fs.readFileSync(legacyPath, 'utf-8');
      encryptToFile(newPath, text);
      fs.unlinkSync(legacyPath);
    } catch (e) {
      console.error('[cookies] No se pudo migrar cookies de login antiguas:', e.message);
    }
  }
}

function getLoginStatusPath() {
  return path.join(app.getPath('userData'), 'login-status.json');
}

function loadLoginStatus() {
  try {
    const filePath = getLoginStatusPath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return {};
  }
}

function saveLoginStatus(status) {
  fs.writeFileSync(getLoginStatusPath(), JSON.stringify(status, null, 2), 'utf-8');
  return status;
}

// Convierte las cookies de una sesión de Electron al formato Netscape (cookies.txt)
// que yt-dlp espera con --cookies.
function cookiesToNetscapeFile(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Generado por YT-DLP Interface (inicio de sesión en la app)', ''];
  const farFuture = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 2; // 2 años, para cookies "de sesión"
  for (const c of cookies) {
    if (!c.domain || !c.name) continue;
    const includeSubdomains = c.domain.startsWith('.') || !c.hostOnly;
    const domain = includeSubdomains && !c.domain.startsWith('.') ? `.${c.domain}` : c.domain;
    const expiry = c.session || !c.expirationDate ? farFuture : Math.floor(c.expirationDate);
    lines.push(
      [
        domain,
        includeSubdomains ? 'TRUE' : 'FALSE',
        c.path || '/',
        c.secure ? 'TRUE' : 'FALSE',
        String(expiry),
        c.name,
        c.value,
      ].join('\t')
    );
  }
  return lines.join('\n') + '\n';
}

let activeLoginWindow = null;

ipcMain.handle('login:start', (_event, site) => {
  const siteConfig = LOGIN_SITES[site];
  if (!siteConfig) return Promise.reject(new Error('Sitio no soportado'));
  if (activeLoginWindow) {
    activeLoginWindow.focus();
    return Promise.reject(new Error('Ya hay una ventana de inicio de sesión abierta'));
  }

  return new Promise((resolve) => {
    const loginSession = session.fromPartition(siteConfig.partition);
    loginSession.setUserAgent(LOGIN_USER_AGENT);

    const win = new BrowserWindow({
      width: 480,
      height: 680,
      title: `Iniciar sesión — ${siteConfig.label}`,
      backgroundColor: '#0d0d0d',
      autoHideMenuBar: true,
      webPreferences: {
        session: loginSession,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    activeLoginWindow = win;

    win.loadURL(siteConfig.url);

    let resolved = false;
    const finish = async () => {
      if (resolved) return;
      resolved = true;
      activeLoginWindow = null;
      try {
        const cookies = await loginSession.cookies.get({});
        if (!cookies.length) {
          resolve({ success: false, error: 'No se detectaron cookies (¿cerraste la ventana sin iniciar sesión?)' });
          return;
        }
        encryptToFile(getLoginCookiesFile(site), cookiesToNetscapeFile(cookies));
        const status = loadLoginStatus();
        status[site] = { loggedInAt: Date.now(), cookieCount: cookies.length };
        saveLoginStatus(status);
        resolve({ success: true, cookieCount: cookies.length });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    };

    win.on('closed', finish);
  });
});

ipcMain.handle('login:status', () => loadLoginStatus());

ipcMain.handle('login:logout', async (_event, site) => {
  const siteConfig = LOGIN_SITES[site];
  if (!siteConfig) return { success: false, error: 'Sitio no soportado' };
  try {
    const loginSession = session.fromPartition(siteConfig.partition);
    await loginSession.clearStorageData();
    const cookieFile = getLoginCookiesFile(site);
    if (fs.existsSync(cookieFile)) fs.unlinkSync(cookieFile);
    const status = loadLoginStatus();
    delete status[site];
    saveLoginStatus(status);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});


function sanitizeFolderName(name) {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || 'playlist';
}

// ---- Historial de descargas ----
const MAX_HISTORY_ENTRIES = 300;

function getHistoryPath() {
  return path.join(app.getPath('userData'), 'history.json');
}

function loadHistory() {
  const filePath = getHistoryPath();
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveHistoryToDisk(history) {
  fs.writeFileSync(getHistoryPath(), JSON.stringify(history, null, 2), 'utf-8');
  return history;
}

// Agrega una entrada al principio del historial (más reciente primero) y recorta el tamaño máximo
function addHistoryEntry(entry) {
  const history = loadHistory();
  history.unshift({ id: Date.now() + Math.random().toString(36).slice(2), ...entry });
  if (history.length > MAX_HISTORY_ENTRIES) history.length = MAX_HISTORY_ENTRIES;
  saveHistoryToDisk(history);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 625,
    resizable: false,
    maximizable: false,
    backgroundColor: '#0d0d0d',
    frame: false, // quitamos el marco nativo para dibujar nuestra propia "barra de título" tipo terminal
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Los enlaces externos (target="_blank") se abren en el navegador del sistema,
  // no en una nueva ventana de Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Descomenta para depurar:
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  migrateLegacyCookieFiles();
  createWindow();

  // Descarga ffmpeg a la carpeta administrada en segundo plano si todavía no
  // está ahí (ej. primer arranque de la app), para que esté listo cuando el
  // usuario lance su primera descarga sin tener que ir a Actualizaciones.
  ensureManagedFfmpeg((progress) => {
    if (mainWindow) mainWindow.webContents.send('update:progress', { target: 'ffmpeg', ...progress });
  }).catch((e) => {
    console.error('[ffmpeg] No se pudo descargar ffmpeg automáticamente:', e.message);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- Leer portapapeles ----
ipcMain.handle('clipboard:read', async () => {
  try {
    const { clipboard } = require('electron');
    const text = await clipboard.readText();
    if (!text || !text.trim()) {
      throw new Error('El portapapeles está vacío');
    }
    return text;
  } catch (err) {
    throw new Error('No se pudo acceder al portapapeles: ' + err.message);
  }
});

// ---- Controles de la ventana (minimizar / maximizar / cerrar) ----
ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow.close());

// ---- Versión de la app (para el panel "Acerca de") ----
ipcMain.handle('app:get-version', () => app.getVersion());


// ---- Abrir carpeta de descargas ----
ipcMain.on('open-downloads', () => {
  const downloadsPath = path.join(os.homedir(), 'Downloads');
  shell.openPath(downloadsPath);
});

// ---- Presets: listar, guardar, agregar, eliminar, restablecer ----
ipcMain.handle('presets:list', () => loadPresets());

ipcMain.handle('presets:add', (_event, preset) => {
  const presets = loadPresets();
  presets.push(preset);
  return savePresetsToDisk(presets);
});

ipcMain.handle('presets:delete', (_event, index) => {
  const presets = loadPresets();
  presets.splice(index, 1);
  return savePresetsToDisk(presets);
});

ipcMain.handle('presets:update', (_event, index, preset) => {
  const presets = loadPresets();
  if (index >= 0 && index < presets.length) {
    presets[index] = preset;
  }
  return savePresetsToDisk(presets);
});

ipcMain.handle('presets:reset', () => savePresetsToDisk([...DEFAULT_PRESETS]));

// ---- Configuración de descarga: obtener, guardar, restablecer ----
ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('settings:save', (_event, settings) => saveSettingsToDisk(settings));

ipcMain.handle('settings:reset', () => saveSettingsToDisk(getDefaultSettings()));

// Sonido de notificación (descarga terminada / instalación automática de
// dependencias terminada). Se usa el sonido de sistema de Windows, igual que
// [System.Media.SystemSounds]::Asterisk.Play() en el conversor de PDF: shell.beep()
// termina invocando el mismo mecanismo nativo (MessageBeep) en vez de empaquetar
// un archivo de audio propio.
ipcMain.handle('app:play-notification-sound', () => {
  shell.beep();
});

// ---- Diálogos nativos para elegir carpeta de descargas / archivo de cookies ----
ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Carpeta dentro de la configuración de la app donde se guardan copias de los
// archivos cookies.txt seleccionados por el usuario (uno por sitio), para que
// las descargas no dependan de un archivo externo que se puede mover, borrar
// o quedar desactualizado. Es el mismo patrón que ya se usa para las cookies
// de "Iniciar sesión con cuenta" (login-cookies/<sitio>.txt).
function getFileCookiesDir() {
  const dir = path.join(app.getPath('userData'), 'file-cookies');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getFileCookiesPath(site) {
  return path.join(getFileCookiesDir(), `${site}.enc`);
}

// Migración: versiones anteriores guardaban la copia del cookies.txt elegido
// por el usuario como file-cookies/<sitio>.txt sin cifrar. Si existe ese
// archivo viejo y todavía no hay uno .enc, lo migramos cifrándolo.
function migrateLegacyFileCookiesFile(site) {
  const legacyPath = path.join(getFileCookiesDir(), `${site}.txt`);
  const newPath = getFileCookiesPath(site);
  if (fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
    try {
      const text = fs.readFileSync(legacyPath, 'utf-8');
      encryptToFile(newPath, text);
      fs.unlinkSync(legacyPath);
    } catch (e) {
      console.error('[cookies] No se pudo migrar cookies de archivo antiguas:', e.message);
    }
  }
}

// Cifra cualquier cookies.txt sin cifrar que haya quedado de una versión
// anterior de la app (login-cookies y file-cookies, por cada sitio).
function migrateLegacyCookieFiles() {
  for (const site of COOKIE_SITE_KEYS) {
    if (site !== 'other') migrateLegacyLoginCookiesFile(site);
    migrateLegacyFileCookiesFile(site);
  }
}

ipcMain.handle('dialog:select-cookies-file', async (_event, site) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Cookies', extensions: ['txt'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const sourcePath = result.filePaths[0];
  // Si el sitio no es válido (o no se pasó), devolvemos la ruta original tal
  // cual, como antes, en vez de copiarla a ningún lado.
  if (!site || !COOKIE_SITE_KEYS.includes(site)) return sourcePath;

  // Copiamos (cifrado) el archivo elegido a la carpeta de configuración de la app
  // (C:\Users\...\AppData\Roaming\yt-dlp-interface\file-cookies\<sitio>.enc)
  // y devolvemos esa ruta, para que quede guardada ahí cifrada en vez de
  // apuntar al archivo original en texto plano.
  try {
    const destPath = getFileCookiesPath(site);
    const text = fs.readFileSync(sourcePath, 'utf-8');
    encryptToFile(destPath, text);
    return destPath;
  } catch (e) {
    // Si por algún motivo falla la copia (permisos, disco, etc.), no bloqueamos
    // al usuario: usamos la ruta original como hacía la app antes de este cambio.
    return sourcePath;
  }
});

// ---- Actualización de yt-dlp y FFmpeg ----
ipcMain.handle('update:get-versions', async () => {
  const settings = loadSettings();
  const ytdlpPath = getYtDlpPath();
  const ffmpegPath = getFfmpegPath() || 'ffmpeg';

  const [ytdlpVersion, ffmpegVersionRaw] = await Promise.all([
    getBinaryVersion(ytdlpPath, ['--version']),
    getBinaryVersion(ffmpegPath, ['-version']),
  ]);

  return {
    ytdlpVersion: ytdlpVersion || 'No instalado',
    ffmpegVersion: ffmpegVersionRaw || 'No instalado',
    ytdlpManaged: fs.existsSync(getManagedYtDlpPath(settings.ytdlpChannel)),
    ffmpegManaged: fs.existsSync(getManagedFfmpegPath()),
    denoVersion: (await getBinaryVersion(getDenoPath() || 'deno', ['--version'])) || 'No instalado',
    denoManaged: fs.existsSync(getManagedDenoPath()),
  };
});

ipcMain.handle('update:ytdlp', async () => {
  try {
    ensureManagedBinDir();
    const settings = loadSettings();
    const dest = getManagedYtDlpPath(settings.ytdlpChannel);
    const url = getYtDlpDownloadUrl(settings.ytdlpChannel);

    await downloadFileFollowRedirects(url, dest, (progress) => {
      if (mainWindow) mainWindow.webContents.send('update:progress', { target: 'ytdlp', ...progress });
    });

    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);

    const version = await getBinaryVersion(dest, ['--version']);
    return { success: true, version: version || 'No disponible' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update:ffmpeg', async () => {
  try {
    ensureManagedBinDir();
    const onProgress = (progress) => {
      if (mainWindow) mainWindow.webContents.send('update:progress', { target: 'ffmpeg', ...progress });
    };

    await downloadManagedFfmpeg(onProgress);

    const version = await getBinaryVersion(getManagedFfmpegPath(), ['-version']);
    return { success: true, version: version || 'No disponible' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update:deno', async () => {
  try {
    ensureManagedBinDir();
    await updateDeno((progress) => {
      if (mainWindow) mainWindow.webContents.send('update:progress', { target: 'deno', ...progress });
    });

    const version = await getBinaryVersion(getManagedDenoPath(), ['--version']);
    return { success: true, version: version || 'No disponible' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- Historial: listar, eliminar una entrada, vaciar, abrir archivo/carpeta ----
ipcMain.handle('history:list', () => loadHistory());

ipcMain.handle('history:delete', (_event, id) => {
  const history = loadHistory().filter((entry) => entry.id !== id);
  return saveHistoryToDisk(history);
});

ipcMain.handle('history:clear', () => saveHistoryToDisk([]));

ipcMain.on('history:open-file', (_event, filePath) => {
  if (!filePath) return;
  // Si el archivo ya no existe (se movió/borró), al menos abrimos la carpeta de descargas
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  } else {
    shell.openPath(path.join(os.homedir(), 'Downloads'));
  }
});

// ---- Lógica de descarga con yt-dlp ----
ipcMain.handle('app:fetch-formats', async (_event, url) => {
  const { spawn } = require('child_process');
  const ytdlpPath = getYtDlpPath();
  const settings = loadSettings();
  // Solo cookies aplican aquí (el límite de velocidad no afecta la consulta de metadatos)
  const { args: cookieArgs, tempFiles } = buildSettingsArgs({ ...settings, rateLimit: '' }, url);
  const cookieContext = getCookieContextForUrl(settings, url);

  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath, ['-J', '--no-playlist', ...cookieArgs, url], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let data = '';
    let err = '';
    proc.stdout.on('data', (chunk) => (data += chunk));
    proc.stderr.on('data', (chunk) => (err += chunk));
    proc.on('close', (code) => {
      cleanupTempCookieFiles(tempFiles);
      if (code !== 0) {
        // El error crudo de yt-dlp queda en la consola (aunque a la app le
        // mostremos un mensaje traducido/simplificado) para poder diagnosticar
        // casos que no matcheen ninguno de los patrones conocidos de abajo.
        console.error('[yt-dlp stderr - fetch-formats]', err);
        return reject(new Error(extractErrorMessage(err, cookieContext)));
      }
      try {
        const info = JSON.parse(data);
        resolve(info);
      } catch (e) {
        reject(e);
      }
    });
    proc.on('error', (spawnErr) => {
      cleanupTempCookieFiles(tempFiles);
      reject(spawnErr.code === 'ENOENT'
        ? new Error('No se encontró yt-dlp. Ve a Configuración → Actualizaciones para descargarlo.')
        : spawnErr);
    });
  });
});

// ---- Obtener la lista de videos de una playlist (sin traer formatos de cada uno, para que sea rápido) ----
ipcMain.handle('app:fetch-playlist', async (_event, url) => {
  const { spawn } = require('child_process');
  const ytdlpPath = getYtDlpPath();
  const settings = loadSettings();
  const { args: cookieArgs, tempFiles } = buildSettingsArgs({ ...settings, rateLimit: '' }, url);
  const cookieContext = getCookieContextForUrl(settings, url);

  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath, ['-J', '--flat-playlist', '--no-warnings', ...cookieArgs, url], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let data = '';
    let err = '';
    proc.stdout.on('data', (chunk) => (data += chunk));
    proc.stderr.on('data', (chunk) => (err += chunk));
    proc.on('close', (code) => {
      cleanupTempCookieFiles(tempFiles);
      if (code !== 0) {
        console.error('[yt-dlp stderr - fetch-playlist]', err);
        return reject(new Error(extractErrorMessage(err, cookieContext)));
      }
      try {
        const info = JSON.parse(data);
        const entries = (info.entries || [])
          .filter((e) => e && (e.id || e.url))
          .map((e) => ({
            id: e.id,
            title: e.title || e.id,
            url: e.url && e.url.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${e.id}`,
            duration: e.duration || null,
            thumbnail:
              e.thumbnails && e.thumbnails.length ? e.thumbnails[e.thumbnails.length - 1].url : (e.id ? `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg` : null),
          }));
        resolve({ title: info.title || 'Playlist', entries });
      } catch (e) {
        reject(e);
      }
    });
    proc.on('error', (spawnErr) => {
      cleanupTempCookieFiles(tempFiles);
      reject(spawnErr.code === 'ENOENT'
        ? new Error('No se encontró yt-dlp. Ve a Configuración → Actualizaciones para descargarlo.')
        : spawnErr);
    });
  });
});

ipcMain.handle('app:download', async (event, { url, formatId, audioOnly, audioFormat, audioBitrateKbps, mergeFormat, presetOptions, title, site, label, videoInfo, thumbnail, outputDir, subfolder, downloadId }) => {
  // Miniatura a guardar en el historial: la que venga explícita en el payload
  // (ej. entradas de playlist) o, si no, la que traiga videoInfo.
  const historyThumbnail = thumbnail || (videoInfo && videoInfo.thumbnail) || null;
  const { spawn } = require('child_process');
  const ytdlpPath = getYtDlpPath();
  // Si ffmpeg todavía no está en la carpeta administrada (ej. primer uso justo
  // después de instalar, antes de que termine la descarga automática de
  // fondo), se espera acá a que esté listo en vez de arrancar sin él.
  let ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) {
    try {
      ffmpegPath = await ensureManagedFfmpeg((progress) => {
        mainWindow.webContents.send('update:progress', { target: 'ffmpeg', ...progress });
      });
    } catch (e) {
      throw new Error('No se pudo descargar ffmpeg (necesario para combinar video y audio). Revisa tu conexión e inténtalo de nuevo, o descárgalo manualmente desde Configuración → Actualizaciones.');
    }
  }
  const settings = loadSettings();
  let downloadsPath = outputDir && outputDir.trim()
    ? outputDir.trim()
    : (settings.downloadPath && settings.downloadPath.trim()
        ? settings.downloadPath
        : path.join(os.homedir(), 'Downloads'));
  // Subcarpeta opcional (ej. nombre de la playlist) dentro de la ruta de descarga.
  // yt-dlp crea automáticamente las carpetas que falten al escribir el archivo.
  if (subfolder && subfolder.trim()) {
    downloadsPath = path.join(downloadsPath, sanitizeFolderName(subfolder.trim()));
  }
  const template = settings.outputTemplate && settings.outputTemplate.trim()
    ? settings.outputTemplate.trim()
    : '%(title)s.%(ext)s';
  const outputTemplate = path.join(downloadsPath, template);

  const ffmpegArgs = ffmpegPath ? ['--ffmpeg-location', ffmpegPath] : [];
  // --force-overwrites evita el error de Windows "no se puede crear un archivo
  // que ya existe" cuando se reintenta una descarga que ya se hizo antes.
  const overwriteArgs = ['--force-overwrites'];
  // Cookies (navegador/archivo/login) y límite de velocidad, según Configuración de Descarga.
  // Las cookies se eligen automáticamente según el sitio detectado en el link.
  const { args: settingsArgs, tempFiles } = buildSettingsArgs(settings, url);
  const cookieContext = getCookieContextForUrl(settings, url);
  // Contenedor de salida elegido en la IU (columna "Formato"). Whitelist para
  // no pasarle a yt-dlp/ffmpeg un valor arbitrario; si no viene o no es válido, mp4 por defecto.
  const ALLOWED_CONTAINERS = ['mp4', 'mkv', 'webm', 'mov'];
  const outputContainer = ALLOWED_CONTAINERS.includes(mergeFormat) ? mergeFormat : 'mp4';
  // webm no soporta carátula incrustada (attached-pic) de forma confiable con ffmpeg;
  // en ese contenedor se omite --embed-thumbnail para no romper la descarga.
  const supportsEmbeddedThumbnail = outputContainer !== 'webm';

  let args;
  if (presetOptions) {
    // Preset: la cadena de "Opciones" ya trae los argumentos completos de yt-dlp
    // (ej: "-f bestvideo[...]+bestaudio" o "-f bestaudio --extract-audio ...")
    const presetArgs = presetOptions.trim().split(/\s+/);
    args = [...presetArgs, ...ffmpegArgs, ...overwriteArgs, ...settingsArgs, '-o', outputTemplate, url];
  } else if (audioOnly) {
    // Solo audio: fuerza la mejor pista de audio disponible y extrae al formato elegido
    // (mp3 por defecto, o el que haya elegido el usuario en la lista de formatos: m4a, opus, flac, wav...)
    const finalAudioFormat = audioFormat || 'mp3';
    // WAV es sin pérdida y no soporta portada incrustada de forma fiable; el resto sí.
    const supportsThumbnail = finalAudioFormat !== 'wav';
    // Nivel de calidad elegido en la IU (Alta/Media/Baja -> bitrate objetivo en kbps).
    // Si no viene ninguno (ej. preajuste "Mejor audio disponible"), se usa la
    // mejor calidad posible ("0" = VBR más alta que soporte ffmpeg).
    const audioQualityArg = Number.isFinite(audioBitrateKbps) && audioBitrateKbps > 0
      ? `${audioBitrateKbps}K`
      : '0';
    args = [
      '-f',
      'bestaudio',
      '--extract-audio',
      '--audio-quality',
      audioQualityArg,
      '--add-metadata',
      '--audio-format',
      finalAudioFormat,
      ...(supportsThumbnail ? ['--embed-thumbnail'] : []),
      ...ffmpegArgs,
      ...overwriteArgs,
      ...settingsArgs,
      '-o',
      outputTemplate,
      url,
    ];
  } else if (formatId && formatId.includes('+')) {
    // formatId es una cadena completa como "bestvideo+bestaudio/best"
    // Para la opción "Mejor video y audio disponible" no basta con bestvideo+bestaudio:
    // algunos extractores (ej. BiliBili) no etiquetan bien el bitrate de cada formato,
    // así que yt-dlp puede elegir una variante de la misma resolución pero menor calidad.
    // "bv*+ba/b" + --format-sort fuerza a comparar por resolución, fps y bitrate real
    // para quedarnos siempre con la variante de mayor calidad de verdad.
    const isBestOption = formatId === 'bestvideo+bestaudio/best';
    args = [
      '-f',
      isBestOption ? 'bv*+ba/b' : formatId,
      ...(isBestOption ? ['--format-sort', 'res,fps,hdr:12,vcodec:vp9.2,acodec,tbr,vbr,abr,size'] : []),
      '--merge-output-format',
      outputContainer,
      ...(supportsEmbeddedThumbnail ? ['--embed-thumbnail'] : []),
      '--add-metadata',
      ...ffmpegArgs,
      ...overwriteArgs,
      ...settingsArgs,
      '-o',
      outputTemplate,
      url,
    ];
  } else {
    // Video específico con audio
    args = [
      '-f',
      `${formatId}+bestaudio/best`,
      '--merge-output-format',
      outputContainer,
      ...(supportsEmbeddedThumbnail ? ['--embed-thumbnail'] : []),
      '--add-metadata',
      ...ffmpegArgs,
      ...overwriteArgs,
      ...settingsArgs,
      '-o',
      outputTemplate,
      url,
    ];
  }

  // yt-dlp escribe sus mensajes de "Destination:" usando la codificación de
  // texto que tenga Python en ese momento. En Windows, si el título trae
  // caracteres no-ASCII (chino, emojis, etc.), Python por defecto usa el
  // codepage del sistema (ej. cp936) en vez de UTF-8, mientras que Node
  // decodifica el stdout del proceso como UTF-8. Ese descalce corrompe la
  // ruta capturada por processStdoutLine más abajo, que entonces ya no
  // coincide con el archivo real en disco y el borrado al cancelar
  // (deletePartialDownloadFiles) falla en silencio porque fs.existsSync no
  // encuentra ese nombre corrupto. Forzar UTF-8 acá alinea ambos lados.
  const utf8Env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

  const downloadStartedAt = Date.now();
  // Foto de la carpeta de destino ANTES de arrancar yt-dlp (ver deleteNewFilesSince).
  const preExistingFiles = snapshotDirFiles(downloadsPath);

  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath, args, { env: utf8Env });
    // Guarda TODAS las rutas de destino que yt-dlp va reportando durante la
    // descarga (no solo la última): cuando se descargan video y audio por
    // separado antes de fusionarlos hay una línea "Destination:" por cada
    // pista, más otra para la miniatura si se pidió --embed-thumbnail. Se
    // necesitan todas para poder borrar los archivos parciales si se cancela.
    const seenDestinations = new Set();
    // La miniatura se rastrea aparte: al cancelar se quiere conservarla (el
    // usuario puede quererla igual aunque no haya terminado el video), así
    // que no se mete en seenDestinations ni se toca en deletePartialDownloadFiles.
    let thumbnailPath = null;
    let destinationPath = null;
    // Marcadas desde los handlers de pausa/cancelación (ver más abajo) para que,
    // al morir el proceso, "close" sepa que no fue un error real de yt-dlp.
    let wasPaused = false;
    let wasCanceled = false;
    proc.__markPaused = () => { wasPaused = true; };
    proc.__markCanceled = () => { wasCanceled = true; };

    if (downloadId !== undefined && downloadId !== null) {
      activeProcs.set(downloadId, proc);
    }

    // Node entrega el stdout de yt-dlp en bloques que no respetan los saltos
    // de línea: un mismo "chunk" puede traer varias líneas juntas (ej. la
    // "Destination:" del audio y la del video seguidas), o cortar una línea
    // a la mitad entre un chunk y el siguiente. Se arma un buffer y se
    // procesa línea por línea para no perderse ninguna coincidencia (antes
    // se usaba text.match() sobre el chunk completo, que solo devuelve la
    // PRIMERA coincidencia y podía ignorar la línea del archivo grande si
    // llegaba junto con otra en el mismo bloque).
    let stdoutBuffer = '';
    function processStdoutLine(line) {
      const destMatch =
        line.match(/\[(?:Merger|ExtractAudio|download)\] Destination:\s*(.+)/) ||
        line.match(/Merging formats into "(.+)"/) ||
        line.match(/\[download\] (.+) has already been downloaded/);
      if (destMatch) {
        destinationPath = destMatch[1].trim().replace(/^"|"$/g, '');
        seenDestinations.add(destinationPath);
      }
      const thumbMatch = line.match(/Writing[^\n]*thumbnail[^\n]* to:\s*(.+)/i);
      if (thumbMatch) {
        thumbnailPath = thumbMatch[1].trim().replace(/^"|"$/g, '');
        seenDestinations.add(thumbnailPath);
      }
    }

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const match = text.match(/(\d{1,3}\.\d)%/);
      if (match) {
        mainWindow.webContents.send('app:progress', { id: downloadId, percent: parseFloat(match[1]) });
      }
      // yt-dlp usa \r para refrescar la línea de progreso en la misma
      // posición; se normaliza a \n para poder partir por línea sin perder
      // esas actualizaciones como si fueran una sola línea gigante.
      stdoutBuffer += text.replace(/\r/g, '\n');
      const lines = stdoutBuffer.split('\n');
      // La última "línea" puede estar incompleta (cortada a mitad por el
      // límite del chunk); se deja en el buffer para completarla con el
      // próximo evento en vez de procesarla ya.
      stdoutBuffer = lines.pop();
      for (const line of lines) processStdoutLine(line);
    });

    let err = '';
    proc.stderr.on('data', (chunk) => (err += chunk));

    proc.on('close', (code) => {
      if (downloadId !== undefined && downloadId !== null) activeProcs.delete(downloadId);
      cleanupTempCookieFiles(tempFiles);
      // Procesar cualquier resto que haya quedado en el buffer sin línea
      // final (\n) al momento de cerrarse el proceso.
      if (stdoutBuffer) processStdoutLine(stdoutBuffer);

      // Pausado desde la UI: no es un error de yt-dlp, no se registra en el
      // historial. yt-dlp deja el archivo .part parcial, así que al reanudar
      // (volver a invocar la descarga con la misma URL) continúa donde quedó.
      if (wasPaused) return resolve({ paused: true });
      if (wasCanceled) {
        // A diferencia de pausar, cancelar significa que el usuario ya no
        // quiere ese archivo: se borran los restos parciales (.part, .ytdl)
        // y cualquier archivo secundario ya completado (ej. la miniatura).
        deletePartialDownloadFiles(seenDestinations);
        addHistoryEntry({
          date: new Date().toISOString(),
          status: 'cancelled',
          title: title || url,
          url,
          site: site || '',
          label: label || '',
          thumbnail: historyThumbnail,
        });
        // Respaldo 1: recorre la carpeta de destino por si algún ".part"/".ytdl"
        // no se detectó vía stdout (ej. por el problema de codificación de arriba).
        // Respaldo 2 (el más confiable): compara la carpeta antes/después de la
        // descarga y borra cualquier archivo nuevo, sea cual sea su nombre o
        // extensión — así no depende en absoluto de haber parseado bien el texto.
        // Ambos se reintentan un par de veces por si el archivo sigue "en uso"
        // una fracción de segundo tras matar el proceso.
        const retryScan = (attempt = 0) => {
          cleanupOrphanedPartialFiles(downloadsPath, downloadStartedAt);
          deleteNewFilesSince(downloadsPath, preExistingFiles);
          if (attempt < 3) setTimeout(() => retryScan(attempt + 1), 400);
        };
        retryScan();
        return resolve({ canceled: true });
      }

      if (code !== 0) {
        console.error('[yt-dlp stderr - download]', err);
        const errorMessage = extractErrorMessage(err, cookieContext);
        addHistoryEntry({
          date: new Date().toISOString(),
          status: 'error',
          title: title || url,
          url,
          site: site || '',
          label: label || '',
          error: errorMessage,
          thumbnail: historyThumbnail,
        });
        return reject(new Error(errorMessage));
      }

      const finalPath = destinationPath || downloadsPath;
      addHistoryEntry({
        date: new Date().toISOString(),
        status: 'success',
        title: title || url,
        url,
        site: site || '',
        label: label || '',
        path: finalPath,
        thumbnail: historyThumbnail,
      });
      resolve({ path: finalPath });
    });

    proc.on('error', (spawnErr) => {
      if (downloadId !== undefined && downloadId !== null) activeProcs.delete(downloadId);
      cleanupTempCookieFiles(tempFiles);
      reject(spawnErr.code === 'ENOENT'
        ? new Error('No se encontró yt-dlp. Ve a Configuración → Actualizaciones para descargarlo.')
        : spawnErr);
    });
  });
});

// Pausar una descarga en curso: mata el proceso de yt-dlp (no hay pausa real
// multiplataforma), pero como no se usa --no-continue, al reanudar retoma el
// archivo .part desde donde quedó en vez de empezar de cero.
ipcMain.on('app:pause', (_event, downloadId) => {
  const proc = activeProcs.get(downloadId);
  if (!proc) return;
  if (proc.__markPaused) proc.__markPaused();
  killProcessTree(proc);
});

// Cancelar una descarga en curso: mata el proceso; el archivo .part parcial
// puede quedar en el disco (yt-dlp no lo borra al recibir la señal).
ipcMain.on('app:cancel', (_event, downloadId) => {
  const proc = activeProcs.get(downloadId);
  if (!proc) return;
  if (proc.__markCanceled) proc.__markCanceled();
  killProcessTree(proc);
});

// ---- Descargar y guardar metadatos + miniatura del video ----
function downloadThumbnail(thumbnailUrl, outputPath) {
  return new Promise((resolve) => {
    if (!thumbnailUrl) {
      resolve(null);
      return;
    }

    const https = require('https');
    const http = require('http');
    const client = thumbnailUrl.startsWith('https') ? https : http;

    const fileStream = fs.createWriteStream(outputPath);
    client
      .get(thumbnailUrl, (response) => {
        response.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve(outputPath);
        });
      })
      .on('error', () => {
        fs.unlink(outputPath, () => {}); // elimina el archivo en caso de error
        resolve(null);
      });
  });
}

function saveVideoMetadata(videoInfo, metadataPath) {
  try {
    const metadata = {
      title: videoInfo.title || '',
      uploader: videoInfo.uploader || '',
      duration: videoInfo.duration || 0,
      thumbnail: videoInfo.thumbnail || null,
      description: videoInfo.description || '',
      upload_date: videoInfo.upload_date || '',
      view_count: videoInfo.view_count || 0,
      like_count: videoInfo.like_count || 0,
      url: videoInfo.webpage_url || videoInfo.url || '',
      extractor: videoInfo.extractor_key || '',
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
}
const COOKIE_SITE_LABELS_MAIN = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  twitter: 'X / Twitter',
  threads: 'Threads',
  bilibili: 'Bilibili',
  other: 'este sitio',
};

// Determina si, para una URL dada, la configuración actual tiene cookies
// realmente activas (no solo en modo "Ninguna"), para poder dar un mensaje de
// error más preciso si el video igual pide iniciar sesión.
function getCookieContextForUrl(settings, url) {
  const perSite = settings.cookiesPerSite || getDefaultCookiesPerSite();
  const site = detectCookieSite(url);
  const siteConfig = perSite[site] || perSite.other;
  const siteLabel = COOKIE_SITE_LABELS_MAIN[site] || site;

  if (siteConfig.mode === 'browser' && siteConfig.browser) {
    return { active: true, mode: 'browser', siteLabel };
  }
  if (siteConfig.mode === 'file' && siteConfig.file) {
    // Si el archivo configurado ya no existe (se borró/movió), lo tratamos
    // como "sin cookies activas" para dar el mensaje correcto (activar cookies,
    // no "las cookies que ya tenés no sirven").
    if (!fs.existsSync(siteConfig.file)) return { active: false, mode: 'none', siteLabel };
    return { active: true, mode: 'file', siteLabel, filePath: siteConfig.file };
  }
  if (siteConfig.mode === 'applogin' && site !== 'other') {
    const cookieFile = getLoginCookiesFile(site);
    if (fs.existsSync(cookieFile)) {
      return { active: true, mode: 'applogin', siteLabel };
    }
  }
  return { active: false, mode: 'none', siteLabel };
}

// ninguna, cae de vuelta al texto completo. Evita mezclar WARNINGs
// (que no son la causa real del fallo) con el mensaje mostrado al usuario.
function extractErrorMessage(stderrText, cookieContext) {
  if (!stderrText) return 'La descarga falló';

  // Caso específico y bastante frecuente en YouTube actualmente: yt-dlp no logra
  // resolver el desafío de firma ("n challenge") ni conseguir un PO Token porque
  // falta un runtime de JavaScript instalado (ej. Deno). Sin eso se queda sin
  // ningún formato reproducible y, como consecuencia indirecta, termina
  // reportando "age-restricted" — aunque el problema NO sean las cookies ni la
  // cuenta. Esta pista viene en líneas WARNING: (no ERROR:), así que hay que
  // revisar el texto completo, no solo las líneas de error de más abajo.
  if (
    /n challenge solving failed|signature solving failed|GVS PO Token/i.test(stderrText) &&
    /age-restricted|sign in to confirm|confirm your age/i.test(stderrText)
  ) {
    return (
      'YouTube está pidiendo iniciar sesión, pero la causa real no son tus cookies (esas ya están bien configuradas). ' +
      'A yt-dlp le falta un runtime de JavaScript instalado para resolver el desafío de firma que YouTube exige ahora ("n challenge") y conseguir un PO Token; ' +
      'sin eso se queda sin ningún formato reproducible y termina mostrando el error de "age-restricted" como resultado indirecto. ' +
      'Solución: andá a Configuración → Actualizaciones y pulsá "Instalar" en la fila de Deno; yt-dlp lo detecta automáticamente, no requiere instalación aparte. ' +
      'Si después de instalarlo el problema sigue, actualizá yt-dlp a la versión más reciente desde ese mismo panel (YouTube cambia esto seguido).'
    );
  }

  const errorLines = stderrText
    .split('\n')
    .filter((line) => line.trim().startsWith('ERROR:'))
    .map((line) => line.trim());
  // yt-dlp a veces repite la misma línea de error más de una vez (ej. al
  // reintentar internamente); nos quedamos solo con las líneas únicas.
  const uniqueErrorLines = [...new Set(errorLines)];
  let message = uniqueErrorLines.length > 0 ? uniqueErrorLines.join('\n') : stderrText.trim();

  // Limpia prefijos técnicos repetitivos, ej. "ERROR: [youtube] C6VrF9uRzTo: "
  message = message
    .replace(/^ERROR:\s*/i, '')
    .replace(/^\[[^\]]+\]\s*[\w-]*:\s*/, '');

  // Caso frecuente: el video pide iniciar sesión (edad, privado, solo miembros).
  // yt-dlp ya sugiere usar cookies, pero con un mensaje técnico en inglés;
  // lo reemplazamos por uno claro que apunte a la configuración de la app.
  if (/sign in|confirm your age|age-restricted|age restricted|private video|members-only|inappropriate for some users/i.test(message)) {
    if (cookieContext && cookieContext.active) {
      // Ya había cookies configuradas para este sitio y AUN ASÍ pidió iniciar
      // sesión: el problema no es que falten cookies, sino que las que hay no
      // sirven (sesión vencida, cuenta sin verificar edad, archivo mal
      // exportado, etc.).
      const modeLabel =
        cookieContext.mode === 'file'
          ? 'el archivo de cookies'
          : cookieContext.mode === 'browser'
          ? 'las cookies del navegador'
          : 'la sesión iniciada en la app';
      return (
        `Este video requiere iniciar sesión (verificación de edad, video privado o solo para miembros), y aunque ${cookieContext.siteLabel} ` +
        `ya tiene ${modeLabel} configuradas, yt-dlp igual no pudo usarlas. Motivos frecuentes: ` +
        '1) la cuenta usada no tiene la edad verificada en Google/YouTube, ' +
        '2) el archivo cookies.txt se exportó sin haber iniciado sesión (o desde una pestaña de incógnito), ' +
        '3) la sesión venció y hay que volver a exportar el archivo o volver a "Iniciar sesión con cuenta". ' +
        'Probá reexportar el cookies.txt recién después de entrar a youtube.com con la cuenta, o usá "Iniciar sesión con cuenta" en vez de archivo (Configuración → Descarga).'
      );
    }
    return (
      `Este video requiere iniciar sesión (verificación de edad, video privado o solo para miembros). ` +
      `Ve a Configuración → Descarga y activá las cookies de ${cookieContext ? cookieContext.siteLabel : 'ese sitio'} ` +
      '("Desde archivo", "Desde navegador" o "Iniciar sesión con cuenta") con una cuenta que tenga acceso.'
    );
  }

  // Caso frecuente: el navegador está abierto y bloquea el archivo de cookies
  // (yt-dlp no puede copiarlo mientras el navegador lo tiene en uso).
  if (/could not copy .* cookie database/i.test(message)) {
    return (
      'No se pudieron leer las cookies del navegador: probablemente está abierto y bloquea su base de datos. ' +
      'Cierra por completo el navegador (todas sus ventanas) e inténtalo de nuevo, o usa "Cookies desde archivo" en Configuración → Descarga.'
    );
  }

  // Caso frecuente en Windows: Chrome (y derivados como Edge/Brave) desde cierta
  // versión cifran las cookies con "App-Bound Encryption", que yt-dlp no puede
  // descifrar vía DPAPI al ejecutarse como un proceso distinto. No tiene arreglo
  // desde la app: hay que cambiar de método para leer las cookies.
  if (/failed to decrypt with dpapi/i.test(message)) {
    return (
      'No se pudieron descifrar las cookies del navegador (Chrome/Edge/Brave cifran las cookies de forma que yt-dlp no puede leerlas en Windows). ' +
      'Prueba: 1) usar "Cookies desde el navegador" con Firefox en vez de Chrome, ' +
      'o 2) exportar las cookies a un archivo .txt (con una extensión como "Get cookies.txt") y usar "Cookies desde archivo" en Configuración → Descarga.'
    );
  }

  // Caso frecuente: TikTok cambia seguido su verificación anti-bot y yt-dlp
  // falla al resolverla (a veces como "Unable to extract webpage video data"
  // o un error al parsear el JSON de respuesta). El link en sí está bien
  // (el "?is_from_webapp=1&sender_device=pc" es el formato normal de TikTok
  // y no afecta la detección); esto no tiene arreglo desde la app, salvo
  // mantener yt-dlp actualizado y reintentar.
  if (/unexpected response from webpage request|_solve_challenge_and_set_cookies|unable to extract webpage video data|failed to parse json/i.test(message)) {
    return (
      'TikTok está bloqueando o cambió su verificación anti-bot y yt-dlp no pudo leer el video (no es un problema de tu link ni de tu configuración). ' +
      'Prueba: 1) Configuración → Actualizaciones → actualizar yt-dlp (TikTok cambia seguido y suele arreglarse con la versión más reciente), ' +
      '2) reintentar en unos segundos o minutos, o 3) si tienes sesión iniciada en TikTok, activar "Cookies desde el navegador" en Configuración → Descarga.'
    );
  }

  return message || 'yt-dlp falló';
}

// FFmpeg ya no se incluye empaquetado con la app (se quitó la dependencia
// ffmpeg-static): la app depende exclusivamente del ffmpeg que vive en la
// carpeta administrada (userData/bin), la misma donde están yt-dlp y deno.
// Si no está ahí, se descarga automáticamente (ver ensureManagedFfmpeg más
// abajo) la primera vez que se necesita.
function getFfmpegPath() {
  const managed = getManagedFfmpegPath();
  if (fs.existsSync(managed)) return managed;
  return null;
}

// Evita descargas duplicadas si varias cosas piden ffmpeg al mismo tiempo
// (ej. el bootstrap automático al abrir la app y una descarga que el usuario
// lanza enseguida): todas esperan la misma descarga en curso.
let ffmpegDownloadPromise = null;

function downloadManagedFfmpeg(onProgress) {
  if (ffmpegDownloadPromise) return ffmpegDownloadPromise;

  ffmpegDownloadPromise = (async () => {
    ensureManagedBinDir();
    if (process.platform === 'win32') {
      await updateFfmpegWindows(onProgress);
    } else if (process.platform === 'darwin') {
      await updateFfmpegMac(onProgress);
    } else {
      await updateFfmpegLinux(onProgress);
    }

    // Guarda la firma del build recién instalado (sea por descarga automática
    // al abrir la app, o por el botón "Actualizar" del panel), para que la
    // próxima revisión de actualizaciones (update:check) ya tenga con qué
    // comparar y pueda mostrar "Estás en la última versión" de una, en vez
    // de necesitar una apertura previa de la app para tener una firma base.
    try {
      const headers = await fetchHeaders(getFfmpegCheckUrl());
      const signature = headers['last-modified'] || headers['content-length'] || null;
      if (signature) {
        const state = loadUpdateCheckState();
        state.ffmpegInstalledSignature = signature;
        saveUpdateCheckState(state);
      }
    } catch (e) {
      // no crítico: si falla, la próxima revisión automática simplemente no tendrá firma con qué comparar
    }

    return getManagedFfmpegPath();
  })();

  ffmpegDownloadPromise.finally(() => {
    ffmpegDownloadPromise = null;
  });

  return ffmpegDownloadPromise;
}

// Se llama antes de cualquier descarga de video/audio: si ya hay un ffmpeg
// en la carpeta administrada lo usa tal cual; si no, lo descarga ahí mismo
// (mostrando progreso en el panel de Actualizaciones si está abierto) antes
// de continuar.
function ensureManagedFfmpeg(onProgress) {
  const managed = getManagedFfmpegPath();
  if (fs.existsSync(managed)) return Promise.resolve(managed);
  return downloadManagedFfmpeg(onProgress);
}

function getYtDlpPath() {
  const managed = getManagedYtDlpPath(loadSettings().ytdlpChannel);
  if (fs.existsSync(managed)) return managed;

  const bundled = path.join(process.resourcesPath || __dirname, 'bin', 'yt-dlp.exe');
  if (fs.existsSync(bundled)) return bundled;

  const userBin = path.join(os.homedir(), '.yt-dlp-interface', 'bin', 'yt-dlp.exe');
  if (fs.existsSync(userBin)) return userBin;

  return 'yt-dlp';
}

// ================= ACTUALIZACIÓN DE yt-dlp Y FFmpeg =================
//
// Ambos binarios se descargan a una carpeta administrada por la app
// (userData/bin). Una vez actualizado uno de ellos ahí, getYtDlpPath()/
// getFfmpegPath() lo usan con prioridad sobre cualquier otra ubicación.

function getManagedBinDir() {
  return path.join(app.getPath('userData'), 'bin');
}

function ensureManagedBinDir() {
  const dir = getManagedBinDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Cada canal (estable/nightly) guarda su propio binario cacheado, así al
// cambiar de canal no hay que volver a descargar si ya se había usado antes.
// "estable" reutiliza el nombre de archivo histórico (yt-dlp.exe) para no
// perder builds ya descargadas por instalaciones previas a que existiera
// esta separación por canal.
function getManagedYtDlpPath(channel) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const filename = channel === 'nightly' ? `yt-dlp-nightly${ext}` : `yt-dlp${ext}`;
  return path.join(getManagedBinDir(), filename);
}

function getManagedFfmpegPath() {
  const filename = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return path.join(getManagedBinDir(), filename);
}

function getManagedDenoPath() {
  const filename = process.platform === 'win32' ? 'deno.exe' : 'deno';
  return path.join(getManagedBinDir(), filename);
}

// Deno solo se usa si el usuario lo instaló desde el panel de Actualizaciones
// (no viene incluido con la app). Si no está, yt-dlp simplemente sigue
// funcionando como hasta ahora (algunos formatos/videos con restricciones
// pueden fallar en su extracción sin él).
function getDenoPath() {
  const managed = getManagedDenoPath();
  if (fs.existsSync(managed)) return managed;
  return null;
}

// Pide un JSON por HTTPS (ej. la API de GitHub), siguiendo redirecciones.
function fetchJson(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Demasiadas redirecciones'));

    const request = https.get(url, { headers: { 'User-Agent': 'yt-dlp-interface' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        fetchJson(response.headers.location, redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`HTTP ${response.statusCode}`));
      }
      let data = '';
      response.on('data', (chunk) => (data += chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(8000, () => request.destroy(new Error('Tiempo de espera agotado')));
  });
}

// Pide solo las cabeceras (HEAD) de una URL, siguiendo redirecciones. Se usa
// para detectar si un build remoto (ej. FFmpeg) cambió sin tener que
// descargarlo completo.
function fetchHeaders(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Demasiadas redirecciones'));

    const request = https.request(url, { method: 'HEAD', headers: { 'User-Agent': 'yt-dlp-interface' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        fetchHeaders(response.headers.location, redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      response.resume();
      resolve(response.headers);
    });

    request.on('error', reject);
    request.setTimeout(8000, () => request.destroy(new Error('Tiempo de espera agotado')));
    request.end();
  });
}

// ---- Estado persistido de la revisión de actualizaciones ----
// Solo guarda la "firma" (Last-Modified o tamaño) del build de FFmpeg que el
// usuario tiene instalado actualmente, para poder compararla contra la firma
// remota en cada apertura de la app (FFmpeg no tiene un número de versión
// uniforme y comparable entre plataformas como sí lo tiene yt-dlp).
function getUpdateCheckPath() {
  return path.join(app.getPath('userData'), 'update-check.json');
}

function loadUpdateCheckState() {
  try {
    return JSON.parse(fs.readFileSync(getUpdateCheckPath(), 'utf-8'));
  } catch (e) {
    return {};
  }
}

function saveUpdateCheckState(state) {
  try {
    fs.writeFileSync(getUpdateCheckPath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    // no crítico: si falla, simplemente se reintentará la próxima vez
  }
}

function getFfmpegCheckUrl() {
  if (process.platform === 'win32') return 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
  if (process.platform === 'darwin') return 'https://evermeet.cc/ffmpeg/getrelease/zip';
  return 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
}

// ---- Revisión automática de versiones nuevas de yt-dlp y FFmpeg ----
// Se llama al abrir la app (y desde el panel de Actualizaciones). No lanza
// errores hacia afuera: si falla por falta de conexión, simplemente no
// reporta actualizaciones disponibles.
ipcMain.handle('update:check', async () => {
  const result = {
    ytdlpUpdateAvailable: false,
    ytdlpLatestVersion: null,
    ytdlpChecked: false,
    ffmpegUpdateAvailable: false,
    ffmpegChecked: false,
    denoUpdateAvailable: false,
    denoLatestVersion: null,
    denoChecked: false,
  };

  // yt-dlp: compara el binario instalado contra el último release de GitHub
  // (repo estable o el de nightly, según el canal elegido en Configuración).
  try {
    const settings = loadSettings();
    const repo = getYtDlpRepo(settings.ytdlpChannel);
    const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
    const latestVersion = release && release.tag_name;
    if (latestVersion) {
      const installedVersion = await getBinaryVersion(getYtDlpPath(), ['--version']);
      if (installedVersion) {
        result.ytdlpChecked = true;
        if (installedVersion.trim() !== latestVersion.trim()) {
          result.ytdlpUpdateAvailable = true;
          result.ytdlpLatestVersion = latestVersion;
        }
      }
    }
  } catch (e) {
    // sin conexión o la API no respondió: se ignora, no bloquea el arranque
  }

  // FFmpeg: no todas las builds exponen un número de versión comparable, así
  // que se detecta un cambio en el build remoto (Last-Modified o tamaño)
  // frente a la firma guardada la última vez que se revisó/instaló. Si es la
  // primera vez que se revisa, solo se guarda la firma actual como base (sin
  // notificar), para poder comparar en la siguiente apertura de la app.
  try {
    const state = loadUpdateCheckState();
    const headers = await fetchHeaders(getFfmpegCheckUrl());
    const remoteSignature = headers['last-modified'] || headers['content-length'] || null;

    if (remoteSignature) {
      if (state.ffmpegInstalledSignature) {
        result.ffmpegChecked = true;
        if (remoteSignature !== state.ffmpegInstalledSignature) {
          result.ffmpegUpdateAvailable = true;
        }
      } else {
        state.ffmpegInstalledSignature = remoteSignature;
        saveUpdateCheckState(state);
      }
    }
  } catch (e) {
    // sin conexión o falló la consulta: se ignora
  }

  // Deno: solo se revisa si el usuario ya lo instaló desde el panel (no viene
  // por defecto). Se compara el número de versión instalado contra el tag
  // del último release de GitHub (ej. "deno 2.1.4" vs "v2.1.4"). Se extrae
  // solo el número de versión de la salida de "deno --version" (que trae
  // texto extra como "(stable, release, x86_64-pc-windows-msvc)"), para no
  // comparar ese texto y terminar marcando "actualización disponible" aunque
  // ya esté al día.
  const denoInstalledPath = getDenoPath();
  if (denoInstalledPath) {
    try {
      const release = await fetchJson('https://api.github.com/repos/denoland/deno/releases/latest');
      const latestVersion = release && release.tag_name && release.tag_name.replace(/^v/, '').trim();
      if (latestVersion) {
        const installedRaw = await getBinaryVersion(denoInstalledPath, ['--version']);
        const versionMatch = installedRaw && /(\d+\.\d+\.\d+)/.exec(installedRaw);
        const installedVersion = versionMatch && versionMatch[1];
        if (installedVersion) {
          result.denoChecked = true;
          if (installedVersion !== latestVersion) {
            result.denoUpdateAvailable = true;
            result.denoLatestVersion = latestVersion;
          }
        }
      }
    } catch (e) {
      // sin conexión o la API no respondió: se ignora
    }
  }

  return result;
});

// Descarga un archivo por HTTPS siguiendo redirecciones (los releases de
// GitHub y otros hosts redirigen a un CDN), reportando progreso opcional.
function downloadFileFollowRedirects(url, destPath, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Demasiadas redirecciones al descargar'));

    const request = https.get(url, { headers: { 'User-Agent': 'yt-dlp-interface' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        downloadFileFollowRedirects(response.headers.location, destPath, onProgress, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`La descarga falló con código HTTP ${response.statusCode}`));
        return;
      }

      const total = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;
      const fileStream = fs.createWriteStream(destPath);

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (onProgress && total) onProgress({ percent: (downloaded / total) * 100 });
      });

      response.pipe(fileStream);
      fileStream.on('finish', () => fileStream.close(() => resolve()));
      fileStream.on('error', reject);
    });

    request.on('error', reject);
  });
}

// Ejecuta un comando externo (powershell/unzip/tar) y resuelve cuando termina con éxito.
function runCommand(cmd, args) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let err = '';
    proc.stderr.on('data', (chunk) => (err += chunk));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `${cmd} terminó con código ${code}`));
    });
    proc.on('error', reject);
  });
}

// Busca un archivo por nombre (sin distinguir mayúsculas) en un árbol de carpetas.
function findFileRecursive(dir, filename) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, filename);
      if (found) return found;
    } else if (entry.name.toLowerCase() === filename.toLowerCase()) {
      return full;
    }
  }
  return null;
}

// Obtiene la salida de "<bin> --version" / "-version"; null si el binario no existe o falla.
function getBinaryVersion(bin, args) {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    try {
      const proc = spawn(bin, args, { windowsHide: true });
      let out = '';
      proc.stdout.on('data', (chunk) => (out += chunk));
      proc.stderr.on('data', (chunk) => (out += chunk));
      proc.on('close', () => {
        const firstLine = out.split('\n')[0].trim();
        resolve(firstLine || null);
      });
      proc.on('error', () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

function getYtDlpRepo(channel) {
  // El canal nightly vive en un repo aparte de GitHub (assets con los mismos
  // nombres que el repo estable); "latest" ahí sí resuelve al nightly más
  // reciente porque cada build se marca como "Latest release" en ese repo.
  return channel === 'nightly' ? 'yt-dlp/yt-dlp-nightly-builds' : 'yt-dlp/yt-dlp';
}

function getYtDlpDownloadUrl(channel) {
  const base = `https://github.com/${getYtDlpRepo(channel)}/releases/latest/download/`;
  if (process.platform === 'win32') return base + 'yt-dlp.exe';
  if (process.platform === 'darwin') return base + 'yt-dlp_macos';
  return base + 'yt-dlp_linux';
}

// Nombre del asset .zip de Deno según plataforma/arquitectura. Deno publica
// un binario único dentro de cada zip (deno.exe / deno), igual en las 3
// plataformas, así que se puede reutilizar la misma lógica de extracción.
function getDenoDownloadUrl() {
  const base = 'https://github.com/denoland/deno/releases/latest/download/';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (process.platform === 'win32') return base + 'deno-x86_64-pc-windows-msvc.zip';
  if (process.platform === 'darwin') return base + `deno-${arch}-apple-darwin.zip`;
  return base + 'deno-x86_64-unknown-linux-gnu.zip';
}

async function updateDeno(onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deno-update-'));
  try {
    const zipPath = path.join(tmpDir, 'deno.zip');
    await downloadFileFollowRedirects(getDenoDownloadUrl(), zipPath, onProgress);

    if (process.platform === 'win32') {
      await runCommand('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path "${zipPath}" -DestinationPath "${tmpDir}" -Force`,
      ]);
    } else {
      await runCommand('unzip', ['-o', zipPath, '-d', tmpDir]);
    }

    const binName = process.platform === 'win32' ? 'deno.exe' : 'deno';
    const extractedBin = findFileRecursive(tmpDir, binName);
    if (!extractedBin) throw new Error('No se encontró el binario de Deno dentro del paquete descargado');

    ensureManagedBinDir();
    fs.copyFileSync(extractedBin, getManagedDenoPath());
    if (process.platform !== 'win32') fs.chmodSync(getManagedDenoPath(), 0o755);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function updateFfmpegWindows(onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-update-'));
  try {
    const zipPath = path.join(tmpDir, 'ffmpeg.zip');
    await downloadFileFollowRedirects(
      'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
      zipPath,
      onProgress
    );
    await runCommand('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${tmpDir}" -Force`,
    ]);
    const extractedExe = findFileRecursive(tmpDir, 'ffmpeg.exe');
    if (!extractedExe) throw new Error('No se encontró ffmpeg.exe dentro del paquete descargado');
    fs.copyFileSync(extractedExe, getManagedFfmpegPath());
    const extractedProbe = findFileRecursive(tmpDir, 'ffprobe.exe');
    if (extractedProbe) fs.copyFileSync(extractedProbe, path.join(getManagedBinDir(), 'ffprobe.exe'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function updateFfmpegMac(onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-update-'));
  try {
    const zipPath = path.join(tmpDir, 'ffmpeg.zip');
    await downloadFileFollowRedirects('https://evermeet.cc/ffmpeg/getrelease/zip', zipPath, onProgress);
    await runCommand('unzip', ['-o', zipPath, '-d', tmpDir]);
    const extractedExe = findFileRecursive(tmpDir, 'ffmpeg');
    if (!extractedExe) throw new Error('No se encontró el binario ffmpeg dentro del paquete descargado');
    fs.copyFileSync(extractedExe, getManagedFfmpegPath());
    fs.chmodSync(getManagedFfmpegPath(), 0o755);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function updateFfmpegLinux(onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-update-'));
  try {
    const tarPath = path.join(tmpDir, 'ffmpeg.tar.xz');
    await downloadFileFollowRedirects(
      'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
      tarPath,
      onProgress
    );
    await runCommand('tar', ['-xJf', tarPath, '-C', tmpDir]);
    const extractedExe = findFileRecursive(tmpDir, 'ffmpeg');
    if (!extractedExe) throw new Error('No se encontró el binario ffmpeg dentro del paquete descargado');
    fs.copyFileSync(extractedExe, getManagedFfmpegPath());
    fs.chmodSync(getManagedFfmpegPath(), 0o755);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
