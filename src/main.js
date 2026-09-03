const { app, BrowserWindow, ipcMain, shell, dialog, session, safeStorage, Tray, Menu } = require('electron');
const path = require('path');

// Nombre visible de la app y, de paso, de la carpeta de datos de usuario que
// Electron arma solo (%APPDATA%\YT-DLP Minimalist en Windows, ~/Library/
// Application Support/YT-DLP Minimalist en macOS, ~/.config/YT-DLP Minimalist
// en Linux). Antes la app se llamaba "yt-dlp-interface" (nombre del paquete
// npm) y esa carpeta quedaba con ese nombre viejo. Tiene que llamarse ANTES
// de cualquier app.getPath('userData') (ver migrateUserDataFolder() más
// abajo, que mueve los datos ya guardados con el nombre viejo a la carpeta
// nueva la primera vez que se abre esta versión).
app.setName('YT-DLP Minimalist');

// APIs nativas como Tray (y en algunos casos el ícono de BrowserWindow) no
// pueden leer archivos que quedan empaquetados DENTRO del .asar — solo Node
// vía fs (patchado por Electron) puede. Por eso 'assets/icon.ico' se marca
// como 'asarUnpack' en package.json (queda en una carpeta real en disco,
// app.asar.unpacked/, al lado del .asar) y acá reescribimos la ruta para
// apuntar ahí cuando la app corre empaquetada. En desarrollo (sin asar) esto
// no hace nada, __dirname ya apunta a una carpeta real.
function resolveAssetPath(...segments) {
  const p = path.join(__dirname, '..', ...segments);
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p;
}
const os = require('os');
const fs = require('fs');
const https = require('https');
const { startExtensionServer, sanitizeQuality, sanitizeExtId } = require('./extension-server');

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

// Respaldo para cuando la descarga TERMINÓ BIEN pero destinationPath (lo
// parseado del stdout de yt-dlp) no coincide con el archivo real en disco
// — el mismo problema de codificación con títulos no-ASCII que ya se
// documentó arriba (ver PYTHONIOENCODING más abajo), pero que hasta ahora
// solo tenía respaldo para el caso de cancelar (deleteNewFilesSince). Si el
// archivo en destinationPath no existe, se compara la carpeta antes/después
// para encontrar el archivo nuevo real, ignorando restos parciales
// (.part/.ytdl) y la miniatura (que no es el archivo principal).
function findFallbackFinalFile(dir, preExistingFiles, excludePaths) {
  const postFiles = snapshotDirFiles(dir);
  const exclude = new Set((excludePaths || []).filter(Boolean));
  const PARTIAL_EXTENSIONS = new Set(['.part', '.ytdl']);
  let best = null;
  let bestMtime = -Infinity;
  for (const full of postFiles) {
    if (preExistingFiles.has(full)) continue; // ya estaba antes de esta descarga
    if (exclude.has(full)) continue; // ej. la miniatura, ya rastreada aparte
    if (PARTIAL_EXTENSIONS.has(path.extname(full).toLowerCase())) continue;
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs > bestMtime) {
        bestMtime = stat.mtimeMs;
        best = full;
      }
    } catch (e) {
      // el archivo pudo desaparecer entre el readdir y el stat; se ignora
    }
  }
  return best;
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

// Envía un mensaje IPC a la ventana principal solo si todavía existe y no fue
// destruida. Varias descargas/actualizaciones siguen corriendo en segundo
// plano (procesos hijos de yt-dlp/ffmpeg/etc.) incluso después de que la
// ventana se cierra (ej. closeBehavior:'close' con una descarga activa); sin
// esta guarda, el próximo evento de progreso llama a mainWindow.webContents
// .send() sobre un webContents ya destruido y Electron tira "TypeError:
// Object has been destroyed", que además queda repitiéndose por cada chunk
// de stdout que siga llegando hasta que el proceso termine. Usar esta función
// en TODOS los .send() evita ese crash sin tener que tocar cada call site
// para acordarse de chequear mainWindow.isDestroyed() a mano.
function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

let tray = null;
let trayShowWindow = null;
// Se pone en true justo antes de un cierre real (desde el menú de la bandeja,
// "Cerrar el programa" en el diálogo de pregunta, o app.quit()), para que el
// handler de 'close' de la ventana sepa que esta vez sí debe dejarla cerrarse
// en vez de interceptarla para preguntar/minimizar a la bandeja.
let isQuitting = false;

// Procesos de yt-dlp en ejecución, indexados por downloadId, para poder
// pausarlos o cancelarlos desde el panel de "Descargas en curso".
const activeProcs = new Map();

// ---- Progreso de descargas iniciadas desde la extensión del navegador ----
// El popup de la extensión no tiene forma de "escuchar" al proceso de
// yt-dlp directamente (corre en otro programa, la app de escritorio). En
// vez de eso, cada descarga que llega vía /add-url recibe acá un id propio
// (ver handleUrlFromExtension) y este Map guarda su estado más reciente
// (porcentaje, velocidad, ruta final, etc). El servidor local
// (extension-server.js) expone ese estado por HTTP para que el popup lo
// vaya consultando mientras está abierto.
const extensionDownloads = new Map();
// Guarda las opciones completas ({url, formatId, outputDir, ...}) con las que
// arrancó cada descarga pedida desde la extensión, indexadas por extId. Se
// usan para poder reanudarla (resumeDownloadById) sin depender del renderer:
// el popup de la extensión solo conoce el extId, nunca el estado interno de
// activeDownloads del renderer.
const extensionDownloadOpts = new Map();
// Timers de limpieza para no dejar crecer extensionDownloads sin límite si
// el usuario nunca vuelve a abrir el popup a revisar el resultado.
const extensionDownloadCleanupTimers = new Map();
const EXTENSION_DOWNLOAD_TTL_MS = 30 * 60 * 1000; // 30 minutos

function setExtensionDownload(id, patch) {
  if (!id) return;
  const current = extensionDownloads.get(id) || {};
  extensionDownloads.set(id, { ...current, ...patch, updatedAt: Date.now() });

  // Reprograma la limpieza cada vez que el estado cambia, así una descarga
  // larga no se borra a mitad de camino.
  const prevTimer = extensionDownloadCleanupTimers.get(id);
  if (prevTimer) clearTimeout(prevTimer);
  const timer = setTimeout(() => {
    extensionDownloads.delete(id);
    extensionDownloadCleanupTimers.delete(id);
  }, EXTENSION_DOWNLOAD_TTL_MS);
  extensionDownloadCleanupTimers.set(id, timer);
}

function getExtensionDownload(id) {
  if (!id) return null;
  return extensionDownloads.get(id) || null;
}

// Abre un archivo por su ruta absoluta directamente (sin pasar por el Map
// extensionDownloads en memoria). Se usa desde la pestaña Historial de la
// extensión: esas entradas guardan la ruta final tal cual la vio el popup
// en su momento, y siguen ahí aunque la app se haya reiniciado desde
// entonces (a diferencia de extensionDownloads, que es efímero y se limpia
// solo a los 30 minutos — ver EXTENSION_DOWNLOAD_TTL_MS).
function openFileByPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return { ok: false, error: 'missing_path' };
  if (!fs.existsSync(filePath)) return { ok: false, error: 'missing' };
  shell.openPath(filePath);
  return { ok: true };
}

// Igual que openFileByPath, pero para abrir (y seleccionar, cuando se puede)
// la carpeta contenedora. Si la ruta del archivo ya no existe, cae a la
// carpeta sola (por si el archivo se movió/renombró pero la carpeta sigue).
function openFolderByPath(filePath, folderPath) {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return { ok: true };
  }
  const folder = folderPath || (filePath ? path.dirname(filePath) : null);
  if (folder && fs.existsSync(folder)) {
    shell.openPath(folder);
    return { ok: true };
  }
  return { ok: false, error: 'missing' };
}

// Abre el archivo final de una descarga iniciada desde la extensión (doble
// clic virtual: lo lanza con la app que el sistema tenga asociada a esa
// extensión, ej. el reproductor de video por defecto).
function openExtensionDownloadFile(id) {
  const entry = getExtensionDownload(id);
  if (!entry || !entry.path) return { ok: false, error: 'not_found' };
  if (!fs.existsSync(entry.path)) return { ok: false, error: 'missing' };
  shell.openPath(entry.path);
  return { ok: true };
}

// Abre (y selecciona, cuando es posible) la carpeta donde quedó el archivo.
function openExtensionDownloadFolder(id) {
  const entry = getExtensionDownload(id);
  if (!entry) return { ok: false, error: 'not_found' };
  if (entry.path && fs.existsSync(entry.path)) {
    shell.showItemInFolder(entry.path);
    return { ok: true };
  }
  const folder = entry.folder || (entry.path ? path.dirname(entry.path) : null);
  if (folder && fs.existsSync(folder)) {
    shell.openPath(folder);
    return { ok: true };
  }
  return { ok: false, error: 'missing' };
}

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
// Dos entradas "builtin" ("Mejor video y audio disponible" / "Mejor audio
// disponible") aparecen también, a pedido del usuario, en el panel de
// administración de Preajustes (⚙ → Preajustes): ahí se pueden EDITAR
// (sitio/opciones) pero no ELIMINAR (ver el guard en "presets:delete" y la
// preservación del flag "builtin" en "presets:update" más abajo). Estas dos
// opciones además siguen existiendo aparte como filas ★ fijas en el listado
// de descarga (generadas en renderer.js) y en el selector de calidad; el
// flag "builtin" se usa también en computePresetItemsForCurrentSite (ver
// renderer.js) para excluirlas de esas listas y no duplicarlas ahí.
const DEFAULT_PRESETS = [
  {
    builtin: 'best_video_audio',
    site: 'Todos',
    name: 'Mejor video y audio disponible',
    options: '-f bv*+ba/b --merge-output-format mp4 --embed-thumbnail --add-metadata',
  },
  {
    builtin: 'best_audio',
    site: 'Todos',
    name: 'Mejor audio disponible',
    options: '-f bestaudio --extract-audio --audio-quality 0 --embed-thumbnail --add-metadata --audio-format mp3',
  },
];

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
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PRESETS;

    // Migración de instalaciones existentes: una versión anterior guardaba
    // las dos entradas "builtin" y luego las quitó por completo del archivo.
    // Si a este presets.json le faltan (porque nunca existieron o porque una
    // versión vieja las borró), se reinsertan al principio -en el mismo
    // orden que DEFAULT_PRESETS- una sola vez y se regrabra el archivo. Si
    // el usuario ya las tenía (con o sin ediciones), no se tocan.
    const missingBuiltins = DEFAULT_PRESETS.filter(
      (def) => !parsed.some((p) => p && p.builtin === def.builtin)
    );
    if (missingBuiltins.length) {
      const merged = [...missingBuiltins, ...parsed];
      savePresetsToDisk(merged);
      return merged;
    }
    return parsed;
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
    organizeBySite: false, // si está prendido, cada descarga se guarda dentro de una subcarpeta con el nombre del sitio (ej. Youtube, TikTok) dentro de downloadPath
    // Cookies por sitio: cada sitio (youtube/tiktok/instagram/twitter/threads/bilibili/other)
    // tiene su propio modo, para que la app elija automáticamente según el link pegado
    // en vez de un único modo global para toda la app.
    cookiesPerSite: getDefaultCookiesPerSite(),
    customCookieSites: [], // sitios agregados por el usuario: [{ id, name, hostname, url }]
    rateLimit: '', // ej. "1M", "500K" — vacío = sin límite
    rateLimitMode: 'perFile', // 'perFile' = el límite se aplica a cada descarga | 'total' = se reparte entre las descargas simultáneas
    concurrentDownloads: 1, // cuántos videos de una lista se descargan a la vez
    concurrentFragments: 1, // conexiones/fragmentos simultáneos POR descarga (-N / --concurrent-fragments); valores más altos aceleran descargas fragmentadas (HLS/DASH) pero pueden causar bloqueos temporales
    subtitlesEnabled: false, // descargar subtítulos (--write-subs) en descargas de video
    subtitleLangs: '', // códigos de idioma separados por coma para --sub-langs; vacío = todos ("all")
    subtitleMode: 'embed', // 'embed' = incrustados en el video | 'file' = archivo .srt aparte | 'both' = ambos
    thumbnailsEnabled: true, // incrustar la miniatura como carátula (--embed-thumbnail) — comportamiento histórico de la app
    chaptersEnabled: false, // incrustar los capítulos del video (--embed-chapters)
    ytdlpChannel: 'stable', // 'stable' | 'nightly' — de qué repo de GitHub se baja/compara yt-dlp
    soundEnabled: true, // sonido al terminar una descarga o la instalación automática de dependencias
    soundStyle: 'chime', // 'chime' (campanita, dos notas) | 'windows' (pitido del sistema, shell.beep)
    closeBehavior: 'ask', // 'ask' | 'minimize' | 'close' — qué hacer al presionar el botón ✕ de la ventana
    language: detectSystemLanguage(), // 'es' | 'en' — idioma de la interfaz
    extensionKeepInBackground: true, // si está activo, una descarga mandada desde la extensión con calidad ya elegida NO trae la ventana al frente (sigue minimizada/en la bandeja si ya lo estaba)
  };
}

// Detecta el idioma del sistema operativo (vía Electron) para usarlo como
// idioma por defecto SOLO la primera vez que se abre la app (todavía no
// existe settings.json). Solo soportamos español e inglés, así que
// cualquier locale que no empiece con "es" cae a inglés; si por lo que sea
// no se puede leer el locale del sistema, español queda como último fallback.
function detectSystemLanguage() {
  try {
    const locale = (app.getLocale() || '').toLowerCase();
    return locale.startsWith('es') ? 'es' : 'en';
  } catch (e) {
    return 'es';
  }
}

// Traducciones mínimas para textos generados en el proceso principal (menú
// de la bandeja del sistema), que no pasan por el HTML/i18n.js del renderer.
const TRAY_STRINGS = {
  es: { show: 'Mostrar', quit: 'Salir' },
  en: { show: 'Show', quit: 'Quit' },
};
let currentTrayLanguage = 'es';

// Extrae el hostname de lo que haya escrito el usuario en "URL del sitio",
// aceptando tanto una URL completa (https://misitio.com/x) como solo el
// dominio (misitio.com). Devuelve '' si no se puede interpretar como URL.
function extractHostname(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
    return new URL(withProtocol).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (e) {
    return '';
  }
}

// Genera un id interno único para un sitio agregado por el usuario, a partir
// de su nombre. Siempre con el prefijo "custom-" (para no chocar nunca con
// las claves fijas como "youtube" u "other") y solo [a-z0-9-], porque este id
// se usa también como nombre de archivo al guardar cookies en disco.
function slugifyCustomSiteId(name, existingIds) {
  let base = 'custom-' + String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base === 'custom' || base === 'custom-') base = 'custom-sitio';
  let id = base;
  let n = 2;
  while (existingIds.includes(id)) {
    id = `${base}-${n}`;
    n++;
  }
  return id;
}

// Valida/normaliza la lista de sitios agregados por el usuario (Configuración
// → Cookies → "Agregar sitio"). Cada uno necesita nombre y una URL de la que
// se pueda sacar un hostname para la detección automática del sitio.
function sanitizeCustomCookieSites(input) {
  if (!Array.isArray(input)) return [];
  const result = [];
  const usedIds = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name || '').trim().slice(0, 60);
    const hostname = extractHostname(raw.url || raw.hostname);
    if (!name || !hostname) continue;
    const id = typeof raw.id === 'string' && /^custom-[a-z0-9-]+$/.test(raw.id) && !usedIds.includes(raw.id)
      ? raw.id
      : slugifyCustomSiteId(name, usedIds);
    usedIds.push(id);
    result.push({ id, name, hostname, url: raw.url ? String(raw.url).trim().slice(0, 300) : '' });
    if (result.length >= 20) break; // límite razonable para no saturar el panel
  }
  return result;
}

// Valida/normaliza lo que llega desde el renderer para cookiesPerSite, para no
// terminar guardando en disco un modo inválido o una clave de sitio inexistente.
// extraKeys son los ids de los sitios personalizados agregados por el usuario,
// que se validan igual que los sitios fijos pero sin permitir "applogin"
// (no tienen ventana de login propia como YouTube/TikTok/etc.).
function sanitizeCookiesPerSite(input, extraKeys = []) {
  const result = getDefaultCookiesPerSite();
  const allKeys = [...COOKIE_SITE_KEYS, ...extraKeys];
  if (input && typeof input === 'object') {
    for (const key of allKeys) {
      const entry = input[key];
      if (!entry || typeof entry !== 'object') continue;
      let mode = ['none', 'browser', 'file', 'applogin'].includes(entry.mode) ? entry.mode : 'none';
      // "Otros sitios" y los sitios personalizados no tienen ventana de login
      // propia (ver LOGIN_SITES), así que "applogin" no aplica ahí; si llega
      // así, lo tratamos como "none".
      if ((key === 'other' || extraKeys.includes(key)) && mode === 'applogin') mode = 'none';
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
    merged.customCookieSites = sanitizeCustomCookieSites(raw.customCookieSites);
    merged.cookiesPerSite = sanitizeCookiesPerSite(raw.cookiesPerSite, merged.customCookieSites.map((s) => s.id));
    merged.closeBehavior = ['ask', 'minimize', 'close'].includes(merged.closeBehavior) ? merged.closeBehavior : 'ask';
    merged.language = merged.language === 'en' ? 'en' : 'es';
    merged.rateLimitMode = merged.rateLimitMode === 'total' ? 'total' : 'perFile';
    merged.subtitleMode = ['file', 'both'].includes(merged.subtitleMode) ? merged.subtitleMode : 'embed';
    merged.soundStyle = merged.soundStyle === 'windows' ? 'windows' : 'chime';
    merged.extensionKeepInBackground = merged.extensionKeepInBackground === true;
    const fragments = parseInt(merged.concurrentFragments, 10);
    merged.concurrentFragments = Number.isFinite(fragments) ? Math.min(16, Math.max(1, fragments)) : 1;
    return merged;
  } catch (e) {
    return defaults;
  }
}

function saveSettingsToDisk(settings) {
  const merged = { ...getDefaultSettings(), ...settings };
  merged.customCookieSites = sanitizeCustomCookieSites(settings.customCookieSites);
  merged.cookiesPerSite = sanitizeCookiesPerSite(settings.cookiesPerSite, merged.customCookieSites.map((s) => s.id));
  // Limitar a un rango razonable (1-5) para evitar saturar la red o el sistema
  const concurrent = parseInt(merged.concurrentDownloads, 10);
  merged.concurrentDownloads = Number.isFinite(concurrent) ? Math.min(5, Math.max(1, concurrent)) : 1;
  // Conexiones/fragmentos simultáneos por descarga (-N): rango razonable 1-16
  const fragments = parseInt(merged.concurrentFragments, 10);
  merged.concurrentFragments = Number.isFinite(fragments) ? Math.min(16, Math.max(1, fragments)) : 1;
  merged.closeBehavior = ['ask', 'minimize', 'close'].includes(merged.closeBehavior) ? merged.closeBehavior : 'ask';
  merged.language = merged.language === 'en' ? 'en' : 'es';
  merged.rateLimitMode = merged.rateLimitMode === 'total' ? 'total' : 'perFile';
  merged.subtitleMode = ['file', 'both'].includes(merged.subtitleMode) ? merged.subtitleMode : 'embed';
  merged.soundStyle = merged.soundStyle === 'windows' ? 'windows' : 'chime';
  fs.writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

// ---- Ajustes que la extensión del navegador puede leer/escribir directo,
// sin pasar por el panel General de la app (ver /settings en
// extension-server.js) ----

// Le da a la extensión SOLO los ajustes que le interesan (no todo
// settings.json) cuando abre su página de Opciones, para que el checkbox
// "Mantener la app en segundo plano" ahí arranque siempre con el valor real
// guardado por la app, sin importar desde dónde se haya tocado la última vez.
function getSettingsForExtension() {
  return { extensionKeepInBackground: loadSettings().extensionKeepInBackground === true };
}

// El usuario cambió el toggle desde las Opciones de la extensión: lo
// persistimos exactamente igual que si se hubiera guardado desde el panel
// General de la app (mismo settings.json, mismas validaciones de
// saveSettingsToDisk). Si la ventana principal está abierta le avisamos por
// IPC para que, si el panel General está visible en ese momento, el
// checkbox se actualice solo — sin pisar el resto de campos que el usuario
// pueda tener sin guardar todavía en ese mismo panel (ver el listener de
// 'settings:extension-updated' en renderer.js, que solo toca ese checkbox).
function updateSettingsFromExtension(patch) {
  const current = loadSettings();
  const merged = saveSettingsToDisk({ ...current, extensionKeepInBackground: !!patch.extensionKeepInBackground });
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendToWindow('settings:extension-updated', { extensionKeepInBackground: merged.extensionKeepInBackground });
  }
  return { extensionKeepInBackground: merged.extensionKeepInBackground };
}

// Detecta a qué sitio (de los que tienen configuración de cookies propia)
// pertenece un link, para poder elegir automáticamente sus cookies sin que
// el usuario tenga que ir cambiando un modo global cada vez. customSites son
// los sitios que el propio usuario agregó desde Configuración → Cookies.
function detectCookieSite(url, customSites = []) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    if (hostname.endsWith('youtube.com') || hostname === 'youtu.be') return 'youtube';
    if (hostname.endsWith('tiktok.com')) return 'tiktok';
    if (hostname.endsWith('instagram.com')) return 'instagram';
    if (hostname.endsWith('twitter.com') || hostname.endsWith('x.com')) return 'twitter';
    if (hostname.endsWith('threads.net') || hostname.endsWith('threads.com')) return 'threads';
    if (hostname.endsWith('bilibili.com') || hostname.endsWith('b23.tv')) return 'bilibili';
    for (const site of customSites) {
      if (site && site.hostname && hostname.endsWith(site.hostname)) return site.id;
    }
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
function buildSettingsArgs(settings, url, opts = {}) {
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
  const site = detectCookieSite(url, settings.customCookieSites || []);
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
    args.push('--limit-rate', computeEffectiveRateLimit(settings, opts.liveConcurrency));
  }

  // Conexiones/fragmentos simultáneos POR descarga (-N / --concurrent-fragments).
  // Solo se agrega si es mayor a 1: con 1 (el default de yt-dlp) no hace falta
  // pasar la bandera.
  const fragments = parseInt(settings.concurrentFragments, 10);
  if (Number.isFinite(fragments) && fragments > 1) {
    args.push('-N', String(Math.min(16, Math.max(1, fragments))));
  }

  return { args, tempFiles };
}

// Arma los argumentos de yt-dlp para subtítulos/miniatura/capítulos según lo
// activado en Configuración → Descargas. "container" es el contenedor final
// (mp4/mkv/webm/mov para video, o el --audio-format para audio-only); se usa
// para no pedir algo que ese contenedor no soporta:
// - Miniatura incrustada: no soportada en webm, ni en audio wav.
// - Subtítulos incrustados: yt-dlp solo los soporta en mp4/webm/mkv (no mov).
// - Capítulos: se dejan pedir siempre que estén activados; yt-dlp los omite
//   sin error si el video no tiene capítulos. EXCEPTO si se está recortando
//   el video ("Cortar video"/trimSection): --embed-chapters incrusta la
//   lista de capítulos ORIGINAL del video completo, con sus timestamps
//   absolutos de siempre, aunque el archivo final solo tenga el tramo
//   pedido. El resultado es un capítulo tipo "01:52 - Outro" que no
//   corresponde a nada del archivo recortado (que puede durar 10
//   segundos), así que se omite --embed-chapters cuando isTrimmed es true.
function buildMediaExtrasArgs(settings, { audioOnly, container, isTrimmed }) {
  const args = [];

  const thumbnailsEnabled = settings.thumbnailsEnabled !== false;
  const chaptersEnabled = settings.chaptersEnabled === true;
  const subtitlesEnabled = settings.subtitlesEnabled === true;

  const supportsEmbeddedThumbnail = audioOnly ? container !== 'wav' : container !== 'webm';
  if (thumbnailsEnabled && supportsEmbeddedThumbnail) {
    args.push('--embed-thumbnail');
  }

  if (chaptersEnabled && !isTrimmed) {
    args.push('--embed-chapters');
  }

  // Subtítulos solo para descargas de video: incrustarlos en un archivo de
  // solo audio no tiene sentido y --embed-subs no lo soporta.
  if (subtitlesEnabled && !audioOnly) {
    const rawLangs = (settings.subtitleLangs || '').trim();
    // "-live_chat" excluye el chat en vivo (no son subtítulos reales, y en
    // videos largos de YouTube puede ser un archivo enorme). Si el usuario
    // dejó el campo de idiomas vacío, se piden todos los demás disponibles.
    const subLangs = rawLangs ? `${rawLangs},-live_chat` : 'all,-live_chat';
    const mode = ['file', 'both'].includes(settings.subtitleMode) ? settings.subtitleMode : 'embed';
    const wantsEmbed = mode === 'embed' || mode === 'both';
    // --embed-subs solo lo soporta yt-dlp en mp4/webm/mkv (no mov); si el
    // contenedor no lo soporta, se cae a dejarlos como archivo aparte para no
    // perder silenciosamente los subtítulos pedidos.
    const canEmbed = ['mp4', 'webm', 'mkv'].includes(container);
    args.push('--write-subs', '--write-auto-subs', '--sub-langs', subLangs);
    if (wantsEmbed && canEmbed) {
      args.push('--embed-subs');
    }
  }

  return args;
}

// Arma los argumentos de yt-dlp para descargar solo un tramo del video (ver
// "Cortar video" en el picker). "trimSection" viene del renderer como
// { start, end } en formato "hh:mm:ss" (ya validado ahí), pero igual se
// re-valida acá con una whitelist estricta antes de pasarlo como argumento
// de yt-dlp, por si acaso.
// --force-keyframes-at-cuts hace que ffmpeg re-codifique un poco alrededor
// del corte para que arranque justo en el punto pedido (sin esto, yt-dlp
// recorta al keyframe más cercano, que puede quedar varios segundos antes).
// Esa re-codificación es inherentemente lenta (yt-dlp la re-codifica en
// tiempo real con ffmpeg) y además no emite las líneas "[download] XX.X%"
// que el resto de la app usa para el progreso, así que durante ese tramo
// no hay % real que mostrar (ver isTrimmedDownload más abajo, que activa
// el estado "indeterminado" de la barra en vez de dejarla clavada en 0%).
// Si trimSection.exact === false, se omite --force-keyframes-at-cuts:
// el corte queda al keyframe más cercano (menos preciso) pero la descarga
// es mucho más rápida porque no hace falta re-codificar.
function buildTrimArgs(trimSection) {
  if (!trimSection || !trimSection.start || !trimSection.end) return [];
  const TIME_RE = /^\d{1,3}:\d{2}:\d{2}$/;
  if (!TIME_RE.test(trimSection.start) || !TIME_RE.test(trimSection.end)) return [];
  const args = ['--download-sections', `*${trimSection.start}-${trimSection.end}`];
  if (trimSection.exact !== false) args.push('--force-keyframes-at-cuts');
  return args;
}

// Calcula el valor que se le pasa a --limit-rate según el modo elegido en
// Configuración → Descarga:
// - "perFile": el valor tal cual, se aplica completo a cada descarga.
// - "total": se reparte entre las descargas que estén corriendo AL MISMO
//   TIEMPO en este momento (liveConcurrency, ver performDownload más abajo:
//   se calcula a partir de activeProcs, así que cuenta por igual una
//   descarga de playlist que una descarga suelta en paralelo — antes acá
//   solo se miraba la config "Descargas simultáneas", que es específica de
//   playlists, así que dos descargas sueltas en simultáneo (ej. dos videos
//   distintos encolados a mano) no se repartían nada y cada una usaba el
//   límite completo). Si no se pasa liveConcurrency (llamadas que no vienen
//   de una descarga real en curso), se cae al valor de esa config como
//   antes, de aproximación.
//   Ojo: esto fija el reparto al VALOR que había al arrancar cada descarga.
//   yt-dlp no permite cambiar --limit-rate de un proceso ya corriendo, así
//   que si una descarga nueva arranca mientras otra ya viene corriendo, la
//   que ya estaba no se reajusta hacia abajo — sí lo hace, correctamente,
//   la que arranca después.
function computeEffectiveRateLimit(settings, liveConcurrency) {
  const raw = settings.rateLimit.trim();
  if (settings.rateLimitMode !== 'total') return raw;

  const concurrency = Number.isFinite(liveConcurrency) && liveConcurrency > 0
    ? Math.floor(liveConcurrency)
    : Math.max(1, Math.min(5, parseInt(settings.concurrentDownloads, 10) || 1));
  if (concurrency <= 1) return raw;

  const match = raw.match(/^([\d.]+)\s*([a-zA-Z]*)$/);
  if (!match) return raw; // formato no reconocido: se deja tal cual

  const [, numStr, unit] = match;
  const num = parseFloat(numStr);
  if (!Number.isFinite(num) || num <= 0) return raw;

  const divided = num / concurrency;
  // yt-dlp acepta decimales (ej. "333.33K"); se limita a 2 decimales para
  // que quede prolijo y se recorta el ".00" sobrante si el resultado es entero.
  const roundedStr = divided.toFixed(2).replace(/\.?0+$/, '');
  return `${roundedStr}${unit}`;
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
  const lines = ['# Netscape HTTP Cookie File', '# Generado por YT-DLP Minimalist (inicio de sesión en la app)', ''];
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


// Nombre de subcarpeta por sitio (usado cuando settings.organizeBySite está
// prendido). Prioriza el "site"/extractor_key que ya trae la descarga (ej.
// "Youtube", "TikTok"); si no hay ninguno (ej. algún flujo viejo sin
// videoInfo), intenta sacarlo del hostname de la URL como último recurso.
// Siempre devuelve un nombre de carpeta válido (nunca vacío).
function getSiteFolderName(site, videoInfo, url) {
  let raw = (site || (videoInfo && videoInfo.extractor_key) || '').trim();
  if (!raw && url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      const label = host.split('.')[0];
      raw = label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
    } catch (e) {
      raw = '';
    }
  }
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || 'Otros';
}

function sanitizeFolderName(name) {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || 'playlist';
}

// ---- Migración de la carpeta de datos de usuario (nombre viejo -> nuevo) ----
// La app se llamaba "yt-dlp-interface" (nombre del paquete npm, sin espacios
// ni mayúsculas) y esa era la carpeta que Electron usaba dentro de AppData/
// Application Support/.config para guardar presets.json, history.json,
// settings.json, cookies, etc. Ahora se llama "YT-DLP Minimalist" (ver
// app.setName() arriba), así que sin esta migración quien actualice desde
// una versión vieja vería la app "vacía" (historial, presets y configuración
// perdidos de vista, aunque los archivos viejos sigan en disco). Se corre
// una sola vez al arrancar, antes de que cualquier otra parte del código
// llegue a leer/escribir en la carpeta nueva.
const OLD_APP_NAME = 'yt-dlp-interface';

function migrateUserDataFolder() {
  try {
    const oldPath = path.join(app.getPath('appData'), OLD_APP_NAME);
    const newPath = app.getPath('userData');
    if (oldPath === newPath) return; // nada que migrar (mismo nombre, no debería pasar)
    if (fs.existsSync(newPath)) return; // la carpeta nueva ya existe: instalación nueva o ya migrada antes
    if (!fs.existsSync(oldPath)) return; // no hay carpeta vieja: primera instalación de la app
    fs.renameSync(oldPath, newPath);
    console.log('[main] Carpeta de datos de usuario migrada de', oldPath, 'a', newPath);
  } catch (e) {
    // Si falla (ej. permisos, u otro proceso con el archivo abierto), la app
    // sigue arrancando igual con la carpeta nueva vacía en vez de trabarse.
    console.error('[main] No se pudo migrar la carpeta de datos de usuario:', e);
  }
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

// ---- Encabezados especiales para la vista previa en streaming ----
// Algunos sitios (Bilibili es el caso típico) firman el link del video/audio,
// pero además el CDN exige un Referer/User-Agent puntual en el pedido HTTP o
// devuelve 403 — sin importar que la URL en sí sea válida y aunque haya
// cookies cargadas (las cookies solo sirven para que yt-dlp pueda CONSULTAR
// los formatos disponibles; no viajan solas con el pedido que hace el
// <video>/<audio> del renderer). yt-dlp ya sabe qué headers hacen falta para
// cada formato (vienen en "http_headers" dentro del JSON de "-J"), pero un
// <video>/<audio> nativo no tiene forma de mandar headers custom en su
// propio pedido. La vuelta: el renderer nos avisa qué URL exacta va a pedir
// y con qué headers (ver 'preview:set-headers' / registerPreviewHeaders en
// renderer.js), y acá los inyectamos justo antes de que salga la petición.
const previewHeaderOverrides = new Map(); // url completa -> { header: valor, ... }
const PREVIEW_HEADER_CACHE_LIMIT = 30; // tope simple para no crecer sin límite entre sesiones de preview

function mergeHeadersCaseInsensitive(base, overrides) {
  const result = { ...base };
  const lowerToKey = {};
  Object.keys(result).forEach((k) => (lowerToKey[k.toLowerCase()] = k));
  Object.entries(overrides).forEach(([key, value]) => {
    const existingKey = lowerToKey[key.toLowerCase()];
    if (existingKey && existingKey !== key) delete result[existingKey];
    result[key] = value;
  });
  return result;
}

function registerPreviewHeaderInterceptor() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const extra = previewHeaderOverrides.get(details.url);
    if (extra) {
      callback({ requestHeaders: mergeHeadersCaseInsensitive(details.requestHeaders, extra) });
      return;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

ipcMain.handle('preview:set-headers', (_event, entries) => {
  if (!Array.isArray(entries)) return;
  entries.forEach((entry) => {
    if (!entry || !entry.url || !entry.headers || !Object.keys(entry.headers).length) return;
    previewHeaderOverrides.set(entry.url, entry.headers);
  });
  // Las URLs firmadas de estos sitios son de un solo uso/expiran rápido, así
  // que no hace falta limpiar activamente al cerrar la preview: alcanza con
  // no dejar crecer el mapa sin límite, tirando las entradas más viejas.
  while (previewHeaderOverrides.size > PREVIEW_HEADER_CACHE_LIMIT) {
    const oldestKey = previewHeaderOverrides.keys().next().value;
    previewHeaderOverrides.delete(oldestKey);
  }
});

// startHidden: true cuando la app se abre en frío por una descarga de la
// extensión con calidad ya elegida y "Mantener en segundo plano" activo (ver
// app.whenReady() más abajo, donde se calcula). En ese caso la ventana se
// crea sin mostrarse (show:false) y se queda así — nadie llama a .show()
// para ella (handleUrlFromExtension tampoco lo hace, con esa misma
// combinación de calidad+setting), igual que si el usuario la hubiera
// minimizado a la bandeja a mano. El ícono de la bandeja (ver createTray)
// sigue permitiendo restaurarla en cualquier momento.
function createWindow(startHidden) {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 625,
    resizable: false,
    maximizable: false,
    backgroundColor: '#0d0d0d',
    frame: false, // quitamos el marco nativo para dibujar nuestra propia "barra de título" tipo terminal
    titleBarStyle: 'hidden',
    show: !startHidden,
    icon: resolveAssetPath('assets', 'icon.ico'), // 'icon.png' no existe en assets/, solo 'icon.ico'
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

  // Botón ✕ de la ventana: según lo configurado en Ajustes, minimizamos a la
  // bandeja del sistema, cerramos el programa directamente, o preguntamos.
  mainWindow.on('close', (event) => {
    if (isQuitting) return; // cierre real ya decidido (menú de la bandeja, "Cerrar", etc.)

    const settings = loadSettings();
    if (settings.closeBehavior === 'minimize') {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    if (settings.closeBehavior === 'close') {
      return; // se deja cerrar normalmente
    }

    // 'ask' (o cualquier valor inválido): preguntamos con un diálogo nativo.
    event.preventDefault();
    askCloseBehavior();
  });
}

// Se pone en true mientras el diálogo "¿Qué querés hacer?" está visible en el
// renderer, para no disparar otro si el usuario presiona ✕ de nuevo mientras
// tanto (ej. doble clic, o Alt+F4 repetido).
let closeAskPending = false;

// Le pide al renderer que muestre el diálogo propio (mismo estilo que el
// resto de la app) preguntando si minimizar a la bandeja o cerrar. La
// respuesta llega por el canal 'close:behavior-response' (ver más abajo).
function askCloseBehavior() {
  if (!mainWindow || closeAskPending) return;
  closeAskPending = true;
  sendToWindow('close:ask-behavior');
}

ipcMain.on('close:behavior-response', (_event, payload) => {
  closeAskPending = false;
  if (!mainWindow) return;
  const { action, remember } = payload || {};
  if (action === 'minimize') {
    mainWindow.hide();
    if (remember) saveSettingsToDisk({ ...loadSettings(), closeBehavior: 'minimize' });
  } else if (action === 'close') {
    if (remember) saveSettingsToDisk({ ...loadSettings(), closeBehavior: 'close' });
    isQuitting = true;
    mainWindow.close();
  }
  // action === 'cancel' (o nada): no se hace nada, la ventana sigue abierta.
});

// Ícono en la bandeja del sistema (junto al reloj/volumen). Aparece siempre
// que la app está corriendo, para poder restaurar la ventana después de
// minimizarla ahí y para poder salir del programa desde ese menú.
function buildTrayMenu(showWindow) {
  const s = TRAY_STRINGS[currentTrayLanguage] || TRAY_STRINGS.es;
  return Menu.buildFromTemplate([
    { label: s.show, click: showWindow },
    { type: 'separator' },
    {
      label: s.quit,
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  if (tray) return;
  tray = new Tray(resolveAssetPath('assets', 'icon.ico'));
  tray.setToolTip('YT-DLP Minimalist');

  const showWindow = () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };
  trayShowWindow = showWindow;

  tray.setContextMenu(buildTrayMenu(showWindow));
  tray.on('click', showWindow); // clic simple también restaura (comportamiento habitual en Windows)
  tray.on('double-click', showWindow);
}

// Reconstruye el menú de la bandeja con el idioma actual (llamado cuando el
// usuario cambia el idioma desde Configuración → General).
function refreshTrayLanguage(lang) {
  currentTrayLanguage = lang === 'en' ? 'en' : 'es';
  if (tray && trayShowWindow) {
    tray.setContextMenu(buildTrayMenu(trayShowWindow));
  }
}

// Recibe una URL enviada desde la extensión del navegador, trae la ventana
// al frente y se la pasa al renderer. Si la extensión ya mandó una calidad
// elegida (el usuario la seleccionó en el popup o en el botón flotante),
// dispara el mismo flujo que el picker interno de la app pero sin mostrarlo
// — descarga directo, como el selector de IDM. Si no vino calidad (o es una
// versión vieja de la extensión), se comporta como siempre: solo pega el
// link y deja que el usuario elija en el picker (ver 'extension:url' /
// 'extension:download' en preload.js y renderer.js).
function handleUrlFromExtension(url, title, quality, extId) {
  if (!mainWindow) return;
  // Con calidad ya elegida (viene del popup de la extensión, no del botón
  // flotante sin calidad) y el toggle "Mantener en segundo plano" activo,
  // no traemos la ventana al frente: la descarga arranca igual, pero la app
  // se queda minimizada/en la bandeja como estaba. Sin calidad (hay que
  // elegir en el picker) siempre mostramos la ventana, porque si no el
  // usuario no tiene forma de elegir.
  const keepInBackground = quality && loadSettings().extensionKeepInBackground;
  if (!keepInBackground) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  if (quality) {
    // extId: id que generó extension-server.js para este pedido (solo en
    // pedidos que vienen del servidor HTTP, no del link de protocolo en
    // frío). Con él, el popup de la extensión puede consultar el progreso
    // de ESTA descarga puntual vía GET /progress?id=... — ver setExtensionDownload
    // más abajo y processStdoutLine en 'app:download'.
    if (extId) {
      setExtensionDownload(extId, { status: 'starting', title: title || url, url, percent: 0 });
    }
    sendToWindow('extension:download', { url, title: title || '', quality, extId: extId || null });
  } else {
    sendToWindow('extension:url', url);
  }
}

// Entrega "a prueba de balas" del link con el que la app se lanzó en frío
// (ytdlpminimalist://...). Antes se confiaba en un solo intento anclado a
// 'did-finish-load', asumiendo que el renderer ya iba a estar escuchando
// para ese momento — pero en la práctica seguía perdiéndose a veces (build
// empaquetada, primer arranque con SmartScreen de por medio, máquina lenta,
// etc.), y la app abría vacía. Ahora en cambio reintentamos mandar el
// mismo link cada 400ms hasta que el renderer confirma por IPC que lo
// aplicó ('extension:url-ack'), o hasta agotar los reintentos.
// "quality" es opcional (ver extractQualityFromProtocolLink más abajo, donde
// se llama esta función): con ella, cada reintento manda 'extension:download'
// en vez de 'extension:url', así el renderer arranca la descarga directo en
// cuanto atrapa alguno de los reintentos, en vez de solo pegar el link y
// esperar a que el usuario elija calidad de nuevo.
function startPendingUrlDelivery(url, quality, extId) {
  pendingExtensionUrl = url;
  pendingExtensionQuality = quality || null;
  pendingExtensionExtId = extId || null;
  if (pendingUrlRetryTimer) clearInterval(pendingUrlRetryTimer);

  let attempts = 0;
  const MAX_ATTEMPTS = 15; // ~6 segundos de margen en total

  const tryDeliver = () => {
    attempts += 1;
    if (!pendingExtensionUrl || !mainWindow) {
      clearInterval(pendingUrlRetryTimer);
      pendingUrlRetryTimer = null;
      return;
    }
    handleUrlFromExtension(pendingExtensionUrl, '', pendingExtensionQuality, pendingExtensionExtId);
    if (attempts >= MAX_ATTEMPTS) {
      clearInterval(pendingUrlRetryTimer);
      pendingUrlRetryTimer = null;
    }
  };

  tryDeliver(); // primer intento inmediato
  pendingUrlRetryTimer = setInterval(tryDeliver, 400);
}

// ---- Protocolo personalizado (ytdlpminimalist://) ----
// Respaldo para cuando la extensión del navegador no puede llegar al
// servidor HTTP local (por ejemplo porque la app todavía no está abierta):
// en ese caso la extensión navega a "ytdlpminimalist://add-url?url=...", el
// sistema operativo lanza esta app (o la trae al frente si ya está
// corriendo, ver 'second-instance' más abajo), y acá extraemos la URL real
// de ese link para pasarla al mismo flujo de siempre.
const PROTOCOL_SCHEME = 'ytdlpminimalist';

// Guarda el link con el que la app se lanzó en frío (proceso recién
// arrancado a partir de ytdlpminimalist://...) hasta que el renderer lo
// pida (ver 'extension:get-pending-url'). Antes se intentaba empujarlo con
// un solo 'did-finish-load', pero esa carrera contra el arranque del
// renderer a veces perdía el link (la app abría, pero no se agregaba nada,
// y había que reenviarlo desde la extensión con la app ya corriendo).
let pendingExtensionUrl = null;
// Calidad (si la había) del mismo link pendiente — ver
// extractQualityFromProtocolLink y startPendingUrlDelivery más abajo. Viaja
// junto a pendingExtensionUrl y se limpia en los mismos puntos que esa.
let pendingExtensionQuality = null;
// Id (si lo había) del mismo link pendiente — ver
// extractExtIdFromProtocolLink más arriba. Igual que pendingExtensionQuality,
// viaja junto a pendingExtensionUrl y se limpia en los mismos puntos.
let pendingExtensionExtId = null;
// Timer de reintentos del link pendiente (ver más abajo, junto a
// 'extension:url-ack'). Se limpia apenas el renderer confirma que ya lo
// aplicó, o después de agotar los reintentos.
let pendingUrlRetryTimer = null;

if (!app.isDefaultProtocolClient(PROTOCOL_SCHEME)) {
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

function extractUrlFromProtocolLink(link) {
  if (!link || !link.startsWith(`${PROTOCOL_SCHEME}://`)) return null;
  try {
    // "ytdlpminimalist://add-url?url=<encoded>" — nos interesa el param "url".
    const parsed = new URL(link);
    const encoded = parsed.searchParams.get('url');
    if (!encoded) return null;
    const decoded = decodeURIComponent(encoded);
    const check = new URL(decoded); // valida que sea una URL http(s) real
    if (check.protocol !== 'http:' && check.protocol !== 'https:') return null;
    return decoded;
  } catch (e) {
    return null;
  }
}

// Cuando el link de protocolo viene de un pedido con calidad ya elegida
// (popup o botón flotante de la extensión, cayendo a este link porque la
// app no estaba abierta — ver buildProtocolUrl en url-utils.js de la
// extensión), trae además "&quality=<json codificado>". sanitizeQuality
// (compartida con extension-server.js, misma validación que usa POST
// /add-url) descarta cualquier valor con forma inesperada devolviendo null,
// que es exactamente "sin calidad elegida" — así una extensión vieja (que
// no manda este param) o con un valor corrompido nunca rompe el flujo, solo
// hace que la app muestre su propio selector como antes.
function extractQualityFromProtocolLink(link) {
  if (!link || !link.startsWith(`${PROTOCOL_SCHEME}://`)) return null;
  try {
    const parsed = new URL(link);
    const encoded = parsed.searchParams.get('quality');
    if (!encoded) return null;
    return sanitizeQuality(JSON.parse(decodeURIComponent(encoded)));
  } catch (e) {
    return null;
  }
}

// El id (generado del lado del navegador — ver generateClientDownloadId en
// background.js de la extensión) con el que el popup ya empezó a sondear
// GET /progress apenas lo generó, antes incluso de intentar el POST por
// HTTP. Viaja también acá para que, al abrirse en frío, la app registre
// esta descarga con ESE MISMO id (ver setExtensionDownload en
// handleUrlFromExtension) — así el sondeo que ya estaba corriendo del lado
// del popup encuentra la descarga apenas la app abre, sin depender de
// ninguna respuesta HTTP que en este camino nunca llegó. sanitizeExtId
// (misma validación que usa POST /add-url) descarta cualquier valor con
// forma inesperada devolviendo null, que main.js ya trata como "sin id" en
// todos lados.
function extractExtIdFromProtocolLink(link) {
  if (!link || !link.startsWith(`${PROTOCOL_SCHEME}://`)) return null;
  try {
    const parsed = new URL(link);
    const raw = parsed.searchParams.get('extId');
    if (!raw) return null;
    return sanitizeExtId(raw);
  } catch (e) {
    return null;
  }
}

// Busca un link "ytdlpminimalist://..." entre los argumentos con los que se
// lanzó el proceso (Windows se los pasa como argv al abrir el protocolo).
function findProtocolLinkInArgv(argv) {
  for (const arg of argv || []) {
    if (typeof arg === 'string' && arg.startsWith(`${PROTOCOL_SCHEME}://`)) {
      return arg;
    }
  }
  return null;
}

function handleProtocolLink(link) {
  const url = extractUrlFromProtocolLink(link);
  if (url) {
    handleUrlFromExtension(url, '', extractQualityFromProtocolLink(link), extractExtIdFromProtocolLink(link));
    return;
  }
  // Link sin URL real (ej. "ytdlpminimalist://open", que dispara el botón
  // "Abrir programa" de la extensión): no hay nada que descargar, solo
  // traemos la ventana al frente si la app ya estaba corriendo.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

// Solo una instancia de la app a la vez: si el usuario dispara el protocolo
// mientras la app ya está abierta, Windows abre un segundo proceso nomás
// para pasarle el argumento y este se cierra enseguida, reenviándole el
// link a la instancia original vía 'second-instance'.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = findProtocolLinkInArgv(argv);
    if (link) {
      handleProtocolLink(link);
    } else if (mainWindow) {
      // Alguien intentó abrir la app de nuevo sin un link (ej. doble clic
      // en el acceso directo): solo la traemos al frente.
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// macOS entrega los links de protocolo por este evento en vez de argv.
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolLink(url);
});

app.whenReady().then(() => {
  // Primero que nada: si venís de una versión vieja, mover los datos de la
  // carpeta con el nombre anterior a la nueva antes de que se cree la
  // ventana y el renderer empiece a pedir presets/historial/configuración.
  migrateUserDataFolder();

  // Resolvemos el link de arranque en frío ANTES de crear la ventana (y no
  // después, como antes) porque necesitamos saber ya en este punto si hay
  // que arrancar oculta: BrowserWindow se muestra solo apenas se crea (por
  // default show:true), así que decidir esto más tarde —dentro de
  // handleUrlFromExtension, como con la app ya abierta— llegaba demasiado
  // tarde: la ventana ya se había mostrado un instante antes de que el
  // renderer llegara a procesar la descarga. Con calidad ya elegida (ver
  // extractQualityFromProtocolLink) Y el toggle "Mantener en segundo plano"
  // activo, la creamos directamente oculta (ver 'show' en createWindow).
  const launchLink = findProtocolLinkInArgv(process.argv);
  const launchUrl = launchLink ? extractUrlFromProtocolLink(launchLink) : null;
  const launchQuality = launchUrl ? extractQualityFromProtocolLink(launchLink) : null;
  const launchExtId = launchUrl ? extractExtIdFromProtocolLink(launchLink) : null;
  let startHidden = false;
  if (launchQuality) {
    try {
      startHidden = !!loadSettings().extensionKeepInBackground;
    } catch (e) {
      startHidden = false;
    }
  }

  // El link con el que se abrió la app (si lo hay) se resuelve apenas se
  // crea la ventana, ANTES de tray/servidor/ffmpeg, a propósito: así un
  // fallo en cualquiera de esas otras cosas (ver try/catch abajo) nunca
  // puede volver a bloquear la entrega del link pendiente a la ventana.
  createWindow(startHidden);

  registerPreviewHeaderInterceptor();

  if (launchUrl) startPendingUrlDelivery(launchUrl, launchQuality, launchExtId);

  try {
    migrateLegacyCookieFiles();
  } catch (e) {
    console.error('[main] Error en migrateLegacyCookieFiles:', e);
  }

  try {
    currentTrayLanguage = (loadSettings().language === 'en') ? 'en' : 'es';
  } catch (e) {
    console.error('[main] Error en loadSettings:', e);
  }

  try {
    createTray();
  } catch (e) {
    console.error('[main] Error en createTray:', e);
  }

  try {
    startExtensionServer(handleUrlFromExtension, {
      getStatus: getExtensionDownload,
      openFile: openExtensionDownloadFile,
      openFolder: openExtensionDownloadFolder,
      pause: pauseDownloadById,
      resume: resumeDownloadById,
      cancel: cancelDownloadById,
      openFileByPath,
      openFolderByPath,
      getSettings: getSettingsForExtension,
      updateSettings: updateSettingsFromExtension,
    });
  } catch (e) {
    console.error('[main] Error en startExtensionServer:', e);
  }

  // Descarga ffmpeg a la carpeta administrada en segundo plano si todavía no
  // está ahí (ej. primer arranque de la app), para que esté listo cuando el
  // usuario lance su primera descarga sin tener que ir a Actualizaciones.
  ensureManagedFfmpeg((progress) => {
    sendToWindow('update:progress', { target: 'ffmpeg', ...progress });
  }).catch((e) => {
    console.error('[ffmpeg] No se pudo descargar ffmpeg automáticamente:', e.message);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((e) => {
  // Red de seguridad: si algo revienta en cualquier punto de este bloque
  // que no quedó cubierto por un try/catch de arriba, que quede logueado
  // en vez de perderse como unhandled rejection silenciosa.
  console.error('[main] Error fatal en app.whenReady():', e);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (terminalProc) {
    killProcessTree(terminalProc);
    terminalProc = null;
  }
});

// ---- Leer portapapeles ----
// Link pendiente de un arranque en frío por protocolo (ver más arriba). El
// renderer lo pide una sola vez al terminar de cargar; se devuelve y se
// limpia en el mismo llamado para no volver a aplicarlo dos veces (ej. si
// el usuario recarga la ventana con Ctrl+R).
ipcMain.handle('extension:get-pending-url', () => {
  const payload = pendingExtensionUrl
    ? { url: pendingExtensionUrl, quality: pendingExtensionQuality, extId: pendingExtensionExtId }
    : null;
  pendingExtensionUrl = null;
  pendingExtensionQuality = null;
  pendingExtensionExtId = null;
  if (pendingUrlRetryTimer) {
    clearInterval(pendingUrlRetryTimer);
    pendingUrlRetryTimer = null;
  }
  return payload;
});

// El renderer confirma que ya aplicó el link (lo pegó en el input y
// disparó la búsqueda de formatos, o —si traía calidad— ya arrancó la
// descarga): dejamos de reenviarlo por 'extension:url'/'extension:download'.
ipcMain.on('extension:url-ack', () => {
  pendingExtensionUrl = null;
  pendingExtensionQuality = null;
  pendingExtensionExtId = null;
  if (pendingUrlRetryTimer) {
    clearInterval(pendingUrlRetryTimer);
    pendingUrlRetryTimer = null;
  }
});

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
// ---- Modo Terminal (ejecutar un comando de yt-dlp "en crudo") ----
// Le permite al usuario escribir los argumentos que le pasaría a yt-dlp
// directamente en la terminal (ej. "-f bestaudio --extract-audio <url>") y
// ver la salida en vivo, para casos que las opciones de la interfaz no
// cubren. Solo se permite un comando corriendo a la vez.
let terminalProc = null;

// Separa una línea de comando en argumentos, respetando texto entre
// comillas simples o dobles (para poder pasar, por ejemplo, un -o con
// espacios en la plantilla). Tokenizer simple, no soporta comillas
// escapadas dentro de comillas del mismo tipo (\" dentro de "…"), que no
// hace falta para el uso típico de argumentos de yt-dlp.
function tokenizeCommand(str) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    tokens.push(match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3]);
  }
  return tokens;
}

ipcMain.handle('terminal:run', (_event, commandStr) => {
  // Si ya había un comando corriendo (el usuario le dio "Ejecutar" de nuevo
  // sin esperar), lo cortamos antes de arrancar el nuevo.
  if (terminalProc) {
    killProcessTree(terminalProc);
    terminalProc = null;
  }

  let tokens = tokenizeCommand((commandStr || '').trim());
  // Si el usuario pegó el comando completo tal como lo copió de la
  // documentación (empezando con "yt-dlp" o "yt-dlp.exe"), se lo sacamos:
  // el binario ya lo ponemos nosotros.
  if (tokens[0] && /^yt-dlp(\.exe)?$/i.test(tokens[0])) {
    tokens = tokens.slice(1);
  }
  if (!tokens.length) {
    return { started: false, error: 'no_command' };
  }

  // Si el usuario no especificó dónde guardar el archivo (-o/--output o
  // -P/--paths), usamos la misma carpeta y plantilla de nombre configuradas
  // en Configuración → Descargas, igual que hace una descarga normal desde
  // la interfaz. Así el modo Terminal no termina guardando en una carpeta
  // distinta (la carpeta de trabajo de la app) sin que el usuario lo note.
  const hasOutputArg = tokens.some((t) =>
    ['-o', '--output', '-P', '--paths'].includes(t) || /^--output=/.test(t) || /^--paths=/.test(t)
  );
  if (!hasOutputArg) {
    const settings = loadSettings();
    const downloadsPath = settings.downloadPath && settings.downloadPath.trim()
      ? settings.downloadPath.trim()
      : path.join(os.homedir(), 'Downloads');
    const template = settings.outputTemplate && settings.outputTemplate.trim()
      ? settings.outputTemplate.trim()
      : '%(title)s.%(ext)s';
    tokens = ['-o', path.join(downloadsPath, template), ...tokens];
  }

  const ytdlpPath = getYtDlpPath();
  const utf8Env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  const { spawn } = require('child_process');
  const proc = spawn(ytdlpPath, tokens, { env: utf8Env });
  terminalProc = proc;

  const send = (stream, text) => {
    sendToWindow('terminal:output', { stream, text });
  };

  proc.stdout.on('data', (chunk) => send('stdout', chunk.toString()));
  proc.stderr.on('data', (chunk) => send('stderr', chunk.toString()));

  proc.on('error', (err) => {
    send('stderr', `\n[error] ${err.message}\n`);
  });

  proc.on('close', (code) => {
    if (terminalProc === proc) terminalProc = null;
    sendToWindow('terminal:done', { code });
  });

  return { started: true };
});

// Corta el comando en curso (mismo mecanismo que pausar/cancelar una
// descarga normal: mata todo el árbol de procesos, no solo el lanzador).
ipcMain.on('terminal:stop', () => {
  if (terminalProc) {
    killProcessTree(terminalProc);
    terminalProc = null;
  }
});

ipcMain.handle('presets:list', () => loadPresets());

ipcMain.handle('presets:add', (_event, preset) => {
  const presets = loadPresets();
  presets.push(preset);
  return savePresetsToDisk(presets);
});

ipcMain.handle('presets:delete', (_event, index) => {
  const presets = loadPresets();
  // Las entradas "builtin" (Mejor video y audio / Mejor audio disponible) no
  // se pueden eliminar, solo editar. El renderer ya no muestra el botón de
  // borrar para esas filas, pero se valida también acá por si acaso.
  if (presets[index] && presets[index].builtin) {
    return presets;
  }
  presets.splice(index, 1);
  return savePresetsToDisk(presets);
});

ipcMain.handle('presets:update', (_event, index, preset) => {
  const presets = loadPresets();
  if (index >= 0 && index < presets.length) {
    const existing = presets[index];
    // Si la entrada editada es una de las dos "builtin", se conserva el
    // marcador aunque el usuario cambie sitio/nombre/opciones, para que
    // siga protegida contra borrado después de guardar los cambios.
    presets[index] = existing && existing.builtin ? { ...preset, builtin: existing.builtin } : preset;
  }
  return savePresetsToDisk(presets);
});

ipcMain.handle('presets:reset', () => savePresetsToDisk([...DEFAULT_PRESETS]));

// ---- Configuración de descarga: obtener, guardar, restablecer ----
ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('settings:save', (_event, settings) => {
  const saved = saveSettingsToDisk(settings);
  refreshTrayLanguage(saved.language);
  return saved;
});

ipcMain.handle('settings:reset', () => saveSettingsToDisk(getDefaultSettings()));

// El renderer avisa explícitamente cuando el usuario cambia el idioma (además
// de guardarlo dentro de settings:save) para que el menú de la bandeja se
// actualice al instante, sin esperar a que se abra/cierre el panel General.
ipcMain.on('language:set', (_event, lang) => refreshTrayLanguage(lang));

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
      { name: currentTrayLanguage === 'en' ? 'All files' : 'Todos los archivos', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const sourcePath = result.filePaths[0];
  // Si el sitio no es válido (o no se pasó), devolvemos la ruta original tal
  // cual, como antes, en vez de copiarla a ningún lado. Los sitios personalizados
  // agregados por el usuario tienen ids con el formato "custom-<slug>".
  if (!site || !(COOKIE_SITE_KEYS.includes(site) || /^custom-[a-z0-9-]{1,80}$/.test(site))) return sourcePath;

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

// Agrega un sitio personalizado (Configuración → Cookies → "Agregar sitio").
// Se persiste de inmediato (no solo en el borrador del panel), para no perder
// el sitio si el usuario cierra el panel antes de tocar "Guardar".
ipcMain.handle('cookies:add-custom-site', (_event, { name, url } = {}) => {
  const cleanName = String(name || '').trim().slice(0, 60);
  const hostname = extractHostname(url);
  if (!cleanName || !hostname) {
    const msg = currentTrayLanguage === 'en'
      ? 'Enter a valid site name and URL.'
      : 'Ingresá un nombre y una URL válidos para el sitio.';
    throw new Error(msg);
  }
  const settings = loadSettings();
  const existingIds = settings.customCookieSites.map((s) => s.id);
  const id = slugifyCustomSiteId(cleanName, existingIds);
  const newSite = { id, name: cleanName, hostname, url: String(url).trim().slice(0, 300) };
  settings.customCookieSites.push(newSite);
  saveSettingsToDisk(settings);
  return newSite;
});

// Edita el nombre/URL de un sitio personalizado ya existente. Mantiene el
// mismo id (para no perder la configuración de cookies ya guardada de ese sitio).
ipcMain.handle('cookies:update-custom-site', (_event, { id, name, url } = {}) => {
  const cleanName = String(name || '').trim().slice(0, 60);
  const hostname = extractHostname(url);
  if (!id || !cleanName || !hostname) {
    const msg = currentTrayLanguage === 'en'
      ? 'Enter a valid site name and URL.'
      : 'Ingresá un nombre y una URL válidos para el sitio.';
    throw new Error(msg);
  }
  const settings = loadSettings();
  const idx = settings.customCookieSites.findIndex((s) => s.id === id);
  if (idx === -1) {
    const msg = currentTrayLanguage === 'en' ? 'Site not found.' : 'No se encontró el sitio.';
    throw new Error(msg);
  }
  const updated = { id, name: cleanName, hostname, url: String(url).trim().slice(0, 300) };
  settings.customCookieSites[idx] = updated;
  saveSettingsToDisk(settings);
  return updated;
});

// Quita un sitio personalizado y su configuración de cookies asociada.
ipcMain.handle('cookies:remove-custom-site', (_event, id) => {
  const settings = loadSettings();
  settings.customCookieSites = settings.customCookieSites.filter((s) => s.id !== id);
  if (settings.cookiesPerSite) delete settings.cookiesPerSite[id];
  const saved = saveSettingsToDisk(settings);
  // Borramos también el archivo de cookies (cifrado) que hubiera quedado
  // guardado para ese sitio, si lo había.
  try {
    const filePath = getFileCookiesPath(id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    // no crítico: si falla el borrado del archivo viejo, no bloqueamos al usuario
  }
  return saved.customCookieSites;
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
    // denoAvailable: true si yt-dlp va a poder usar un Deno real al llamarlo
    // (administrado O empaquetado dentro del .exe). Distinto de denoManaged
    // (que solo mira la carpeta administrada): sirve para que el auto-install
    // del primer arranque no vuelva a descargar Deno cuando ya viene
    // empaquetado. No se puede usar denoVersion para esto porque, si no hay
    // ni administrado ni empaquetado, esa versión cae al "deno" del PATH del
    // sistema (solo para mostrarlo en pantalla) y ese Deno no es el que
    // getDenoPath()/yt-dlp terminan usando.
    denoAvailable: !!getDenoPath(),
  };
});

ipcMain.handle('update:ytdlp', async () => {
  try {
    ensureManagedBinDir();
    const settings = loadSettings();
    const dest = getManagedYtDlpPath(settings.ytdlpChannel);
    const url = getYtDlpDownloadUrl(settings.ytdlpChannel);

    await downloadFileFollowRedirects(url, dest, (progress) => {
      sendToWindow('update:progress', { target: 'ytdlp', ...progress });
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
      sendToWindow('update:progress', { target: 'ffmpeg', ...progress });
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
      sendToWindow('update:progress', { target: 'deno', ...progress });
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

// Última carpeta de descarga configurada por el usuario en Ajustes (no la de
// Windows por defecto, que puede no tener nada que ver si el usuario la
// cambió). Se usa como último recurso cuando ni el archivo ni su carpeta
// contenedora existen más.
function getHistoryFallbackDir() {
  const settings = loadSettings();
  return settings.downloadPath && settings.downloadPath.trim()
    ? settings.downloadPath.trim()
    : path.join(os.homedir(), 'Downloads');
}

// Abre el archivo en sí con la app que el sistema tenga asociada (reproductor
// de video, etc). Si el archivo exacto no está (se movió/borró, o el nombre
// no se pudo leer bien de la salida de yt-dlp por temas de codificación con
// caracteres especiales), caemos como mejor esfuerzo a mostrar la carpeta
// contenedora en vez de fallar en silencio.
ipcMain.on('history:open-file', (_event, filePath) => {
  if (!filePath) return;

  if (fs.existsSync(filePath)) {
    shell.openPath(filePath);
    return;
  }

  const parentDir = path.dirname(filePath);
  if (parentDir && fs.existsSync(parentDir)) {
    shell.openPath(parentDir);
    return;
  }

  shell.openPath(getHistoryFallbackDir());
});

// Abre el explorador de archivos en la carpeta contenedora, con el archivo
// seleccionado cuando es posible.
ipcMain.on('history:open-folder', (_event, filePath) => {
  if (!filePath) return;

  // Camino normal: el archivo sigue ahí, se lo mostramos seleccionado en el
  // explorador.
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return;
  }

  // El archivo exacto no está (se movió/borró, o el nombre no se pudo leer
  // bien de la salida de yt-dlp por temas de codificación con caracteres
  // especiales). Antes de rendirnos, probamos con la carpeta que lo
  // contenía: casi siempre sigue existiendo aunque el nombre del archivo en
  // sí no haya calzado exacto.
  const parentDir = path.dirname(filePath);
  if (parentDir && fs.existsSync(parentDir)) {
    shell.openPath(parentDir);
    return;
  }

  shell.openPath(getHistoryFallbackDir());
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

// Hace la descarga real con yt-dlp. Extraída a función aparte (en vez de vivir
// solo adentro del handler IPC) para que resumeDownloadById pueda invocarla de
// nuevo con las mismas opciones cuando la extensión pide reanudar una
// descarga pausada, sin pasar por el renderer.
async function performDownload({ url, formatId, audioOnly, audioFormat, audioBitrateKbps, mergeFormat, presetOptions, title, site, label, videoInfo, thumbnail, outputDir, subfolder, downloadId, trimSection, extId }) {
  // Reporta progreso/estado de esta descarga a extensionDownloads (si vino
  // de la extensión, es decir si trae extId) además de a la ventana
  // principal como siempre. No hace nada si extId es null/undefined.
  const reportExt = (patch) => { if (extId) setExtensionDownload(extId, patch); };
  // Miniatura a guardar en el historial: la que venga explícita en el payload
  // (ej. entradas de playlist) o, si no, la que traiga videoInfo.
  const historyThumbnail = thumbnail || (videoInfo && videoInfo.thumbnail) || null;
  // Identificador "real" del video (id + extractor) para poder reconocer que
  // ya se descargó antes aunque el usuario pegue una URL distinta que apunta
  // al mismo contenido (ej. youtu.be/xxx vs youtube.com/watch?v=xxx). Si no
  // viene videoInfo (algunos flujos, ej. reintentos), queda en null y el
  // renderer cae de vuelta a comparar la URL tal cual.
  const historyVideoId = (videoInfo && videoInfo.id) || null;
  const historyExtractorKey = (videoInfo && videoInfo.extractor_key) || site || null;
  const { spawn } = require('child_process');
  const ytdlpPath = getYtDlpPath();
  // Si ffmpeg todavía no está en la carpeta administrada (ej. primer uso justo
  // después de instalar, antes de que termine la descarga automática de
  // fondo), se espera acá a que esté listo en vez de arrancar sin él.
  let ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) {
    try {
      ffmpegPath = await ensureManagedFfmpeg((progress) => {
        sendToWindow('update:progress', { target: 'ffmpeg', ...progress });
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
  // Subcarpeta por sitio (opcional, Configuración → Descargas → "Organizar en
  // subcarpetas por sitio"): va primero, así que si también hay subcarpeta de
  // playlist esta queda dentro de la del sitio (ej. Downloads/Youtube/Mi playlist/).
  if (settings.organizeBySite === true) {
    downloadsPath = path.join(downloadsPath, getSiteFolderName(site, videoInfo, url));
  }
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
  // liveConcurrency: cuántas descargas (de cualquier tipo: playlist o suelta)
  // están corriendo ahora mismo, +1 por esta misma que está por arrancar —
  // ver computeEffectiveRateLimit. Se usa un Set de los procesos (no
  // activeProcs.size directo) porque un mismo proceso puede estar indexado
  // dos veces ahí (por downloadId y por extId cuando la descarga vino de la
  // extensión del navegador), y size contaría esa descarga dos veces.
  const liveConcurrency = new Set(activeProcs.values()).size + 1;
  const { args: settingsArgs, tempFiles } = buildSettingsArgs(settings, url, { liveConcurrency });
  const cookieContext = getCookieContextForUrl(settings, url);
  // Contenedor de salida elegido en la IU (columna "Formato"). Whitelist para
  // no pasarle a yt-dlp/ffmpeg un valor arbitrario; si no viene o no es válido, mp4 por defecto.
  const ALLOWED_CONTAINERS = ['mp4', 'mkv', 'webm', 'mov'];
  const outputContainer = ALLOWED_CONTAINERS.includes(mergeFormat) ? mergeFormat : 'mp4';
  // Subtítulos/miniatura/capítulos según Configuración → Descargas (webm no soporta
  // carátula incrustada de forma confiable, así que buildMediaExtrasArgs la omite ahí).
  // "Cortar video" (ver picker de un solo video): descarga solo el tramo pedido en vez del video completo.
  const trimArgs = buildTrimArgs(trimSection);
  const videoMediaExtrasArgs = buildMediaExtrasArgs(settings, { audioOnly: false, container: outputContainer, isTrimmed: trimArgs.length > 0 });
  // true solo si el corte va a re-codificar con ffmpeg (--force-keyframes-at-cuts
  // está en trimArgs): esa etapa no reporta % real por stdout (ver processStdoutLine),
  // así que la UI necesita saber que debe mostrar progreso indeterminado en vez de 0%.
  const isExactTrim = trimArgs.includes('--force-keyframes-at-cuts');
  // También el corte NO exacto (solo --download-sections, sin re-codificar) puede
  // tardar en emitir la primera línea "[download] XX.X%" -a veces directamente no
  // llega ninguna intermedia y salta de 0% a terminado-, así que cualquier descarga
  // con recorte arranca en modo indeterminado; en cuanto llega un % real se apaga solo.
  const isTrimmedDownload = trimArgs.length > 0;

  let args;
  if (presetOptions) {
    // Preset: la cadena de "Opciones" ya trae los argumentos completos de yt-dlp
    // (ej: "-f bestvideo[...]+bestaudio" o "-f bestaudio --extract-audio ...")
    const presetArgs = presetOptions.trim().split(/\s+/);
    args = [...presetArgs, ...trimArgs, ...ffmpegArgs, ...overwriteArgs, ...settingsArgs, '-o', outputTemplate, url];
  } else if (audioOnly) {
    // Solo audio: fuerza la mejor pista de audio disponible y extrae al formato elegido
    // (mp3 por defecto, o el que haya elegido el usuario en la lista de formatos: m4a, opus, flac, wav...)
    const finalAudioFormat = audioFormat || 'mp3';
    // Nivel de calidad elegido en la IU (Alta/Media/Baja -> bitrate objetivo en kbps).
    // Si no viene ninguno (ej. preajuste "Mejor audio disponible"), se usa la
    // mejor calidad posible ("0" = VBR más alta que soporte ffmpeg).
    const audioQualityArg = Number.isFinite(audioBitrateKbps) && audioBitrateKbps > 0
      ? `${audioBitrateKbps}K`
      : '0';
    // Subtítulos/miniatura/capítulos según Configuración → Descargas (WAV es sin
    // pérdida y no soporta portada incrustada de forma fiable, así que se omite ahí).
    const mediaExtrasArgs = buildMediaExtrasArgs(settings, { audioOnly: true, container: finalAudioFormat, isTrimmed: trimArgs.length > 0 });
    args = [
      '-f',
      'bestaudio',
      '--extract-audio',
      '--audio-quality',
      audioQualityArg,
      '--add-metadata',
      '--audio-format',
      finalAudioFormat,
      ...mediaExtrasArgs,
      ...trimArgs,
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
      ...videoMediaExtrasArgs,
      ...trimArgs,
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
      ...videoMediaExtrasArgs,
      ...trimArgs,
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
    // Además del downloadId interno, se registra también bajo el "extId"
    // (si esta descarga vino de la extensión del navegador) para que el
    // servidor HTTP local (extension-server.js) pueda pausarla/cancelarla
    // directamente por ese id — el popup de la extensión nunca llega a
    // conocer el downloadId interno del renderer, solo su propio extId.
    if (extId) {
      activeProcs.set(extId, proc);
    }

    // Corte (exacto o no): hasta que llegue la primera línea "[download] XX.X%"
    // real (si es que llega) se muestra progreso indeterminado en vez de un 0%
    // que parece colgado. processStdoutLine lo apaga solo en cuanto ve un % real.
    if (isTrimmedDownload && downloadId !== undefined && downloadId !== null && mainWindow) {
      sendToWindow('app:progress', {
        id: downloadId,
        indeterminate: true,
        indeterminateLabelKey: isExactTrim ? 'status_trimming' : 'status_trimming_section',
      });
    }
    reportExt({ status: 'downloading' });

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
      // Línea típica de progreso de yt-dlp:
      // "[download]  33.0% of   10.00MiB at    1.23MiB/s ETA 00:07"
      // A veces la velocidad o el ETA vienen como "Unknown" mientras yt-dlp
      // todavía no tiene suficientes datos para calcularlos; en ese caso no
      // se manda ese campo (queda null) para que la UI simplemente no lo muestre.
      const percentMatch = line.match(/\[download\]\s+(\d{1,3}\.\d)%/);
      if (percentMatch) {
        const speedMatch = line.match(/\bat\s+([\d.]+\S*\/s)/i);
        const etaMatch = line.match(/\bETA\s+(\d[\d:]*)/i);
        const percentValue = parseFloat(percentMatch[1]);
        const speedValue = speedMatch ? speedMatch[1] : null;
        const etaValue = etaMatch ? etaMatch[1] : null;
        sendToWindow('app:progress', {
          id: downloadId,
          percent: percentValue,
          speed: speedValue,
          eta: etaValue,
          indeterminate: false,
        });
        reportExt({ status: 'downloading', percent: percentValue, speed: speedValue, eta: etaValue });
      }

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
      if (extId) activeProcs.delete(extId);
      cleanupTempCookieFiles(tempFiles);
      // Procesar cualquier resto que haya quedado en el buffer sin línea
      // final (\n) al momento de cerrarse el proceso.
      if (stdoutBuffer) processStdoutLine(stdoutBuffer);

      // Pausado desde la UI: no es un error de yt-dlp, no se registra en el
      // historial. yt-dlp deja el archivo .part parcial, así que al reanudar
      // (volver a invocar la descarga con la misma URL) continúa donde quedó.
      if (wasPaused) {
        reportExt({ status: 'paused' });
        return resolve({ paused: true });
      }
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
          videoId: historyVideoId,
          extractorKey: historyExtractorKey,
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
        reportExt({ status: 'cancelled' });
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
          videoId: historyVideoId,
          extractorKey: historyExtractorKey,
        });
        reportExt({ status: 'error', error: errorMessage });
        return reject(new Error(errorMessage));
      }

      // Si lo parseado del stdout no coincide con nada real en disco (título
      // con caracteres no-ASCII que corrompieron la línea "Destination:",
      // ver findFallbackFinalFile más arriba), se busca el archivo nuevo de
      // verdad comparando la carpeta antes/después en vez de quedarse con
      // una ruta que "No se pudo abrir" — así "Abrir archivo" no falla en
      // descargas que en realidad sí terminaron bien.
      let finalPath = destinationPath || downloadsPath;
      if (!fs.existsSync(finalPath)) {
        const fallback = findFallbackFinalFile(downloadsPath, preExistingFiles, [thumbnailPath]);
        if (fallback) finalPath = fallback;
      }
      addHistoryEntry({
        date: new Date().toISOString(),
        status: 'success',
        title: title || url,
        url,
        site: site || '',
        label: label || '',
        path: finalPath,
        thumbnail: historyThumbnail,
        videoId: historyVideoId,
        extractorKey: historyExtractorKey,
      });
      reportExt({ status: 'completed', percent: 100, path: finalPath, folder: path.dirname(finalPath) || downloadsPath });
      resolve({ path: finalPath });
    });

    proc.on('error', (spawnErr) => {
      if (downloadId !== undefined && downloadId !== null) activeProcs.delete(downloadId);
      if (extId) activeProcs.delete(extId);
      cleanupTempCookieFiles(tempFiles);
      const spawnErrorMessage = spawnErr.code === 'ENOENT'
        ? 'No se encontró yt-dlp. Ve a Configuración → Actualizaciones para descargarlo.'
        : (spawnErr.message || 'Error desconocido');
      reportExt({ status: 'error', error: spawnErrorMessage });
      reject(spawnErr.code === 'ENOENT'
        ? new Error('No se encontró yt-dlp. Ve a Configuración → Actualizaciones para descargarlo.')
        : spawnErr);
    });
  });
}

ipcMain.handle('app:download', (_event, opts) => {
  // Se guardan las opciones originales de toda descarga que venga de la
  // extensión (trae extId) para poder reanudarla después vía resumeDownloadById,
  // incluso si el popup de la extensión se cerró y se volvió a abrir mientras tanto.
  if (opts && opts.extId) extensionDownloadOpts.set(opts.extId, opts);
  return performDownload(opts);
});

// Pausar una descarga en curso: mata el proceso de yt-dlp (no hay pausa real
// multiplataforma), pero como no se usa --no-continue, al reanudar retoma el
// archivo .part desde donde quedó en vez de empezar de cero. Se usa tanto
// desde el panel de "Descargas en curso" (IPC, downloadId interno) como
// desde el popup de la extensión del navegador (HTTP, extId) — ver
// activeProcs.set(extId, proc) más arriba y /pause en extension-server.js.
function pauseDownloadById(id) {
  const proc = activeProcs.get(id);
  if (!proc) return false;
  if (proc.__markPaused) proc.__markPaused();
  killProcessTree(proc);
  return true;
}

// Reanudar una descarga pausada desde la extensión: vuelve a invocar
// performDownload con las mismas opciones que se usaron la primera vez
// (guardadas en extensionDownloadOpts, ver ipcMain.handle('app:download')).
// yt-dlp retoma el archivo .part solo (no se usa --no-continue), así que
// alcanza con relanzar el proceso — no hace falta tocar argumentos.
// Solo aplica a descargas que vinieron de la extensión (por HTTP, vía id);
// las que arrancan desde la propia ventana ya se reanudan por su cuenta
// (ver resumeActiveDownload en renderer.js, que vuelve a llamar a
// window.yoinksAPI.download con el payload que guarda del lado del renderer).
function resumeDownloadById(id) {
  const opts = extensionDownloadOpts.get(id);
  if (!opts) return false;
  setExtensionDownload(id, { status: 'starting' });
  performDownload(opts).catch(() => {
    // Si falla al relanzar, processStdoutLine/proc.on('error') dentro de
    // performDownload ya deja reflejado el estado 'error' vía reportExt;
    // acá no hace falta hacer nada más.
  });
  return true;
}

// Cancelar una descarga en curso: mata el proceso; el archivo .part parcial
// puede quedar en el disco (yt-dlp no lo borra al recibir la señal). Mismo
// doble uso (IPC + HTTP) que pauseDownloadById.
function cancelDownloadById(id) {
  const proc = activeProcs.get(id);
  if (!proc) return false;
  if (proc.__markCanceled) proc.__markCanceled();
  killProcessTree(proc);
  return true;
}

ipcMain.on('app:pause', (_event, downloadId) => {
  pauseDownloadById(downloadId);
});

ipcMain.on('app:cancel', (_event, downloadId) => {
  cancelDownloadById(downloadId);
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
  const customSites = settings.customCookieSites || [];
  const site = detectCookieSite(url, customSites);
  const siteConfig = perSite[site] || perSite.other;
  const customSite = customSites.find((s) => s.id === site);
  const siteLabel = customSite ? customSite.name : (COOKIE_SITE_LABELS_MAIN[site] || site);

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

// FFmpeg se busca primero en la carpeta administrada (userData/bin, la que
// gestiona el panel de Actualizaciones) y, si no está ahí, en el ffmpeg.exe
// empaquetado dentro del .exe (assets/bin -> resourcesPath/bin, ver
// package.json "extraResources"). Si tampoco está empaquetado, se descarga
// automáticamente a la carpeta administrada la primera vez que se necesita
// (ver ensureManagedFfmpeg más abajo).
function getFfmpegPath() {
  const managed = getManagedFfmpegPath();
  if (fs.existsSync(managed)) return managed;

  const bundled = path.join(process.resourcesPath || __dirname, 'bin', 'ffmpeg.exe');
  if (fs.existsSync(bundled)) return bundled;

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

// Se llama antes de cualquier descarga de video/audio (y también al abrir la
// app): si ya hay un ffmpeg disponible -en la carpeta administrada o
// empaquetado dentro del .exe- lo usa tal cual; si no hay ninguno, lo
// descarga a la carpeta administrada (mostrando progreso en el panel de
// Actualizaciones si está abierto) antes de continuar. Usar getFfmpegPath()
// acá (en vez de mirar solo la carpeta administrada) evita que la app
// re-descargue ffmpeg en cada primer arranque cuando ya viene empaquetado.
function ensureManagedFfmpeg(onProgress) {
  const existing = getFfmpegPath();
  if (existing) return Promise.resolve(existing);
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

// Deno se busca primero en la carpeta administrada (userData/bin) y luego en
// el deno.exe empaquetado dentro del .exe (assets/bin, igual que ffmpeg y
// yt-dlp). Si no está en ninguno de los dos lugares, yt-dlp simplemente sigue
// funcionando como hasta ahora (algunos formatos/videos con restricciones
// pueden fallar en su extracción sin él); el usuario puede instalarlo desde
// el panel de Actualizaciones.
function getDenoPath() {
  const managed = getManagedDenoPath();
  if (fs.existsSync(managed)) return managed;

  const bundled = path.join(process.resourcesPath || __dirname, 'bin', 'deno.exe');
  if (fs.existsSync(bundled)) return bundled;

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
