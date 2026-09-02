// Servidor HTTP mínimo, atado solo a 127.0.0.1, que recibe la URL que el
// usuario elige desde la extensión de navegador y se la pasa a la ventana
// principal por IPC. No expone nada fuera de la máquina local: al escuchar
// explícitamente en '127.0.0.1' (en vez de '0.0.0.0'), el sistema operativo
// rechaza cualquier conexión que no venga del propio equipo.
const http = require('http');
const crypto = require('crypto');

const PORT = 14370;
const HOST = '127.0.0.1';

// Id corto para identificar cada descarga que llega desde la extensión.
// No necesita ser criptográficamente fuerte (es solo una clave de
// correlación local entre el popup y esta app), pero sí única.
function generateDownloadId() {
  return `ext-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Valida (sin confiar del todo) el objeto "quality" que puede mandar la
// extensión. Cualquier forma inesperada se trata como "sin calidad elegida"
// en vez de rechazar el request entero — así una extensión desactualizada o
// con un bug nunca rompe el flujo normal de "mandar la URL".
function sanitizeQuality(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'best') return { type: 'best' };
  if (value.type === 'audio') {
    const format = ['mp3', 'm4a', 'opus'].includes(value.format) ? value.format : 'mp3';
    return { type: 'audio', format };
  }
  if (value.type === 'video') {
    const height = Number(value.height);
    if (Number.isFinite(height) && height > 0 && height <= 8640) {
      return { type: 'video', height };
    }
  }
  return null;
}

// Valida el id que la extensión puede mandar para esta descarga puntual
// (generado del lado del navegador — ver generateClientDownloadId en
// background.js de la extensión — ANTES de siquiera intentar este mismo
// POST). Si tiene forma razonable lo usamos tal cual en vez de generar uno
// acá, para que sea EL MISMO id con el que el popup ya empezó a sondear
// /progress apenas lo generó, sin depender de esta respuesta para
// enterarse de cuál es. Cualquier valor con forma inesperada (extensión
// vieja que no lo manda, o corrompido) se trata igual que "no vino" — se
// genera uno nuevo como antes.
function sanitizeExtId(value) {
  if (typeof value !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) return null;
  return value;
}

// onUrl(url, title) se llama cuando llega una URL válida.
// onUrl(url, title, quality) se llama cuando llega una URL válida. "quality"
// es opcional (extensiones viejas no lo mandan): null/undefined significa
// "sin calidad elegida en el navegador", igual que antes — la app abre su
// propio selector como siempre. Si viene, la app descarga directo con esa
// calidad, sin mostrar el selector (ver handleUrlFromExtension en main.js).
// Cabeceras CORS: sin estas, el fetch() que hace la extensión (desde un
// origen chrome-extension://...) se resuelve como 200 en el servidor pero
// el NAVEGADOR bloquea la lectura de la respuesta por no encontrar
// Access-Control-Allow-Origin, y fetch() termina rechazando la promesa
// como si la conexión hubiera fallado. El resultado visible era que la
// extensión SIEMPRE caía al plan B (el link de protocolo), incluso con la
// app ya abierta y el servidor respondiendo perfectamente.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  // Private Network Access: Chrome/Edge exigen esto además del resto de
  // CORS cuando quien pide es una extensión (o cualquier origen sin IP
  // "local") y el destino es 127.0.0.1. Sin esto, el preflight puede
  // pasar pero el navegador igual bloquea la respuesta del POST real.
  'Access-Control-Allow-Private-Network': 'true',
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req, res, onData) {
  let body = '';
  let tooLarge = false;
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 8192) {
      tooLarge = true;
      sendJson(res, 413, { error: 'payload too large' });
      req.destroy();
    }
  });
  req.on('end', () => {
    if (tooLarge) return;
    let data;
    try {
      data = JSON.parse(body || '{}');
    } catch (e) {
      sendJson(res, 400, { error: 'bad request' });
      return;
    }
    onData(data);
  });
}

// onUrl(url, title, quality, id) se llama cuando llega una URL válida desde
// la extensión; "id" es el identificador que este servidor genera para
// poder correlacionar más tarde el progreso de ESA descarga puntual (ver
// /progress más abajo).
//
// handlers = { getStatus(id), openFile(id), openFolder(id), pause(id), resume(id), cancel(id),
//              openFileByPath(path), openFolderByPath(path, folder), getSettings(), updateSettings(patch) }
//            — provistos por main.js.
// getStatus(id) debe devolver algo como:
//   { status: 'starting'|'downloading'|'completed'|'error'|'cancelled'|'paused',
//     percent, speed, eta, title, path, folder, error }
// o null/undefined si no existe (aún) ese id. pause(id)/resume(id)/cancel(id)
// devuelven true/false según si encontraron (y pudieron actuar sobre) una
// descarga con ese id. openFileByPath/openFolderByPath devuelven
// { ok: true|false } y se usan desde el historial (por ruta, no por id: ver
// comentario junto al endpoint /open-file-by-path más abajo).
function startExtensionServer(onUrl, handlers) {
  const { getStatus, openFile, openFolder, pause, resume, cancel, openFileByPath, openFolderByPath, getSettings, updateSettings } = handlers || {};

  const server = http.createServer((req, res) => {
    const [pathname, query] = req.url.split('?');

    // Preflight que manda el navegador antes del POST/GET real porque el
    // request lleva 'Content-Type: application/json' o es cross-origin.
    // Si no se responde acá, el navegador nunca llega a hacer el request real.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (req.method === 'POST' && pathname === '/add-url') {
      readJsonBody(req, res, (data) => {
        if (!isHttpUrl(data.url)) {
          sendJson(res, 400, { error: 'invalid url' });
          return;
        }
        const id = sanitizeExtId(data.extId) || generateDownloadId();
        onUrl(data.url, typeof data.title === 'string' ? data.title : '', sanitizeQuality(data.quality), id);
        sendJson(res, 200, { ok: true, id });
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/progress') {
      const params = new URLSearchParams(query || '');
      const id = params.get('id');
      if (!id) {
        sendJson(res, 400, { error: 'missing id' });
        return;
      }
      const status = typeof getStatus === 'function' ? getStatus(id) : null;
      if (!status) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      sendJson(res, 200, { ok: true, ...status });
      return;
    }

    if (req.method === 'POST' && pathname === '/open-file') {
      readJsonBody(req, res, (data) => {
        if (!data.id || typeof openFile !== 'function') {
          sendJson(res, 400, { error: 'missing id' });
          return;
        }
        const result = openFile(data.id) || { ok: false };
        sendJson(res, result.ok ? 200 : 404, result);
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/open-folder') {
      readJsonBody(req, res, (data) => {
        if (!data.id || typeof openFolder !== 'function') {
          sendJson(res, 400, { error: 'missing id' });
          return;
        }
        const result = openFolder(data.id) || { ok: false };
        sendJson(res, result.ok ? 200 : 404, result);
      });
      return;
    }

    // Abrir archivo/carpeta desde el HISTORIAL de la extensión: a diferencia
    // de /open-file y /open-folder (que buscan por "id" en el estado en
    // memoria, efímero), acá el popup manda directamente la ruta que ya
    // tenía guardada en el historial — así sigue funcionando aunque la app
    // se haya cerrado y vuelto a abrir desde que terminó esa descarga.
    if (req.method === 'POST' && pathname === '/open-file-by-path') {
      readJsonBody(req, res, (data) => {
        if (!data.path || typeof openFileByPath !== 'function') {
          sendJson(res, 400, { error: 'missing path' });
          return;
        }
        const result = openFileByPath(data.path) || { ok: false };
        sendJson(res, result.ok ? 200 : 404, result);
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/open-folder-by-path') {
      readJsonBody(req, res, (data) => {
        if (!data.path && !data.folder) {
          sendJson(res, 400, { error: 'missing path' });
          return;
        }
        if (typeof openFolderByPath !== 'function') {
          sendJson(res, 400, { error: 'not supported' });
          return;
        }
        const result = openFolderByPath(data.path, data.folder) || { ok: false };
        sendJson(res, result.ok ? 200 : 404, result);
      });
      return;
    }

    // Pausar/cancelar una descarga en curso que se mandó desde este mismo
    // popup (mismo "id" que devolvió /add-url). No hay pausa real: del lado
    // de main.js esto mata el proceso de yt-dlp; al reanudar retoma el
    // archivo .part donde quedó (ver pauseDownloadById en main.js).
    if (req.method === 'POST' && pathname === '/pause') {
      readJsonBody(req, res, (data) => {
        if (!data.id || typeof pause !== 'function') {
          sendJson(res, 400, { error: 'missing id' });
          return;
        }
        const ok = pause(data.id);
        sendJson(res, ok ? 200 : 404, { ok });
      });
      return;
    }

    // Reanudar una descarga que quedó pausada: vuelve a arrancar yt-dlp con
    // las mismas opciones originales (guardadas en main.js), que retoma el
    // archivo .part donde quedó en vez de empezar de cero.
    if (req.method === 'POST' && pathname === '/resume') {
      readJsonBody(req, res, (data) => {
        if (!data.id || typeof resume !== 'function') {
          sendJson(res, 400, { error: 'missing id' });
          return;
        }
        const ok = resume(data.id);
        sendJson(res, ok ? 200 : 404, { ok });
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/cancel') {
      readJsonBody(req, res, (data) => {
        if (!data.id || typeof cancel !== 'function') {
          sendJson(res, 400, { error: 'missing id' });
          return;
        }
        const ok = cancel(data.id);
        sendJson(res, ok ? 200 : 404, { ok });
      });
      return;
    }

    // La extensión pregunta acá cuál es el valor ACTUAL de "mantener en
    // segundo plano" (entre otros ajustes que se agreguen a futuro) apenas
    // se abre su página de Opciones — la app es la fuente de verdad, así que
    // si el usuario lo cambió desde el panel General de la app, la extensión
    // se entera al abrirse sin que haga falta nada más.
    if (req.method === 'GET' && pathname === '/settings') {
      const settings = (typeof getSettings === 'function' ? getSettings() : null) || {};
      sendJson(res, 200, { ok: true, extensionKeepInBackground: settings.extensionKeepInBackground === true });
      return;
    }

    // La extensión manda esto cuando el usuario cambia el toggle desde sus
    // propias Opciones, para que quede guardado en la app tal cual como si
    // se hubiera tocado ahí (ver updateSettingsFromExtension en main.js).
    // Solo se acepta "extensionKeepInBackground"; cualquier otro campo se
    // ignora en vez de rechazar el request entero, por si una extensión más
    // nueva manda algo que esta versión de la app todavía no entiende.
    if (req.method === 'POST' && pathname === '/settings') {
      readJsonBody(req, res, (data) => {
        if (typeof updateSettings !== 'function') {
          sendJson(res, 400, { error: 'not supported' });
          return;
        }
        if (typeof data.extensionKeepInBackground !== 'boolean') {
          sendJson(res, 400, { error: 'invalid settings' });
          return;
        }
        const result = updateSettings({ extensionKeepInBackground: data.extensionKeepInBackground }) || {};
        sendJson(res, 200, { ok: true, extensionKeepInBackground: result.extensionKeepInBackground === true });
      });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });

  server.on('error', (err) => {
    // Puerto ocupado (ej. dos instancias de la app abiertas): no rompemos la app,
    // solo queda sin escuchar y la extensión mostrará "no se pudo conectar".
    console.warn('[extension-server] No se pudo iniciar:', err.message);
  });

  server.listen(PORT, HOST);
  return server;
}

// sanitizeQuality y sanitizeExtId se re-exportan para que main.js pueda
// validar de la misma forma la calidad y el id que llegan por el link de
// protocolo (ytdlpminimalist://), que siguen reglas idénticas a las que
// llegan por POST /add-url.
module.exports = { startExtensionServer, sanitizeQuality, sanitizeExtId };
