// Centraliza la comunicación con YT-DLP Minimalist. Tanto el popup como el
// botón flotante (content-overlay.js) le mandan un mensaje a este service
// worker en vez de hacer fetch cada uno por su cuenta: así el fetch corre
// siempre en el contexto de la extensión (nunca sujeto al CSP de la página
// que se esté viendo, que en varios sitios bloquearía la conexión directa).
importScripts('url-utils.js');

const APP_BASE = 'http://127.0.0.1:14370';
const APP_ENDPOINT = `${APP_BASE}/add-url`;
const PROGRESS_ENDPOINT = `${APP_BASE}/progress`;
const OPEN_FILE_ENDPOINT = `${APP_BASE}/open-file`;
const OPEN_FOLDER_ENDPOINT = `${APP_BASE}/open-folder`;
const OPEN_FILE_BY_PATH_ENDPOINT = `${APP_BASE}/open-file-by-path`;
const OPEN_FOLDER_BY_PATH_ENDPOINT = `${APP_BASE}/open-folder-by-path`;
const PAUSE_ENDPOINT = `${APP_BASE}/pause`;
const RESUME_ENDPOINT = `${APP_BASE}/resume`;
const CANCEL_ENDPOINT = `${APP_BASE}/cancel`;
const SETTINGS_ENDPOINT = `${APP_BASE}/settings`;
const HISTORY_KEY = 'sendHistory';
const HISTORY_LIMIT = 100; // no dejamos crecer el historial sin límite
// Misma clave que usa popup.js para retomar el estado al reabrirse. Se
// guarda ACÁ (no solo en popup.js) porque una descarga puede arrancar desde
// el botón flotante sobre el video (content-overlay.js) sin que el popup
// esté siquiera abierto — si no se guardara en este punto central, el popup
// no tendría forma de enterarse de que hay una descarga en curso.
// Es una LISTA (no una sola descarga como antes): puede haber varias en
// curso a la vez, cada una identificada por su "id", y ninguna debe pisar a
// las demás.
const ACTIVE_DOWNLOADS_KEY = 'activeDownloads';

// Agrega (o reemplaza, si ya existiera con el mismo id) una descarga a la
// lista de "activas" que el popup usa para pintar sus tarjetas de progreso.
async function addActiveDownload(entry) {
  const data = await chrome.storage.local.get({ [ACTIVE_DOWNLOADS_KEY]: [] });
  const list = (data[ACTIVE_DOWNLOADS_KEY] || []).filter((e) => e.id !== entry.id);
  list.push(entry);
  await chrome.storage.local.set({ [ACTIVE_DOWNLOADS_KEY]: list });
}

// Agrega una entrada al historial (el más nuevo primero) y recorta el
// tamaño. El panel lateral escucha chrome.storage.onChanged, así que no
// hace falta avisarle a mano: se actualiza solo apenas escribimos acá.
async function recordHistory(entry) {
  const data = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  const list = data[HISTORY_KEY];
  list.unshift({ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: Date.now() });
  if (list.length > HISTORY_LIMIT) list.length = HISTORY_LIMIT;
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
}

// Actualiza el estado final (completed/error) de la entrada de historial que
// corresponde a una descarga puntual, buscándola por el "downloadId" que le
// dio la app en /add-url. Así la pestaña Historial del popup puede filtrar
// por "Completados" / "Error" en vez de mostrar siempre "Enviado".
async function updateHistoryStatus(downloadId, status, extra) {
  if (!downloadId) return;
  const data = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  const list = data[HISTORY_KEY];
  const item = list.find((e) => e.downloadId === downloadId);
  if (!item) return;
  item.status = status;
  if (extra) Object.assign(item, extra);
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
}

// Nota: el objeto "quality" (ver parseQualityValue en url-utils.js) se
// guarda TAL CUAL en el historial, sin traducir a texto acá — así popup.js
// y sidepanel.js pueden mostrarlo en el idioma que esté elegido en ese
// momento (ver formatQualityLabel en i18n.js) en vez de quedar congelado en
// el idioma que estaba activo cuando se hizo la descarga.

// Toggle "Auto-abrir" del popup (ver popup.js). Si está activo, cada
// descarga agregada con éxito intenta abrir el popup solo, sin que el
// usuario tenga que hacer clic en el ícono de la extensión — útil sobre
// todo cuando se descarga desde el botón flotante sobre el video, donde
// si no el usuario nunca ve el progreso a menos que abra el popup a mano.
// chrome.action.openPopup() solo funciona si el navegador lo permite en
// ese momento (por lo general necesita un gesto de usuario reciente, como
// el clic que disparó esta misma descarga); si falla, no rompemos nada, la
// descarga sigue igual y el usuario puede abrir el popup a mano como
// siempre.
function maybeOpenPopupOnDownload() {
  chrome.storage.sync.get({ openPopupOnDownload: false }, (data) => {
    if (!data.openPopupOnDownload) return;
    if (!chrome.action || typeof chrome.action.openPopup !== 'function') return;
    try {
      const result = chrome.action.openPopup();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (e) {
      // Ignorado a propósito: sin gesto de usuario reciente Chrome rechaza
      // el pedido, y no hay nada más que hacer desde acá en ese caso.
    }
  });
}

// Id generado ACÁ, del lado del navegador, ANTES de siquiera intentar el
// POST por HTTP — no esperamos a que la app confirme. Se manda tanto en ese
// POST (como "extId": si la app está abierta y responde, extension-server.js
// lo usa tal cual en vez de generar uno propio) como en el link de
// protocolo de respaldo si hay que abrir la app (ver buildProtocolUrl en
// url-utils.js). Gracias a esto el popup puede arrancar a sondear
// GET /progress con un id válido al toque, sin depender de ninguna
// respuesta — ni la de un servidor que todavía no está escuchando porque la
// app recién se está abriendo.
function generateClientDownloadId() {
  return `ext-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'send-url') return;

  const clientId = generateClientDownloadId();

  fetch(APP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: message.url, title: message.title || '', quality: message.quality || null, extId: clientId }),
  })
    .then((res) => {
      if (!res.ok) throw new Error('bad status');
      return res.json().catch(() => ({}));
    })
    .then((data) => {
      // "id" identifica esta descarga puntual en la app: con él el popup
      // puede ir preguntando el progreso (ver 'get-progress' más abajo),
      // pedirle a la app que abra el archivo o la carpeta, y —una vez que
      // termine— actualizar el estado de esta misma entrada en el
      // historial (ver 'update-history-status' más abajo). Normalmente
      // coincide con "clientId" (la app respeta el que le mandamos), pero
      // si por lo que sea no vino en la respuesta, usamos igual el nuestro.
      const id = data && data.id ? data.id : clientId;
      recordHistory({ url: message.url, title: message.title || '', status: 'sent', quality: message.quality || null, downloadId: id });
      maybeOpenPopupOnDownload();
      // Se guarda acá (y no solo cuando el popup manda el mensaje) para
      // que el popup pueda retomar el progreso la próxima vez que se
      // abra, sin importar si esta descarga se disparó desde el propio
      // popup o desde el botón flotante sobre el video. Se agrega a la
      // lista sin tocar las demás descargas que pudieran seguir en curso.
      addActiveDownload({
        id,
        url: message.url,
        title: message.title || '',
        quality: message.quality || null,
        status: 'starting',
        percent: null,
        speed: null,
        eta: null,
      });
      sendResponse({ ok: true, id });
    })
    .catch(() => {
      // La app no estaba abierta (o no responde). No la lanzamos desde acá:
      // le avisamos a quien nos mandó el mensaje (el botón sobre el video,
      // o el popup) para que dispare el link de protocolo ella misma, desde
      // esa misma pestaña — así el diálogo "¿Abrir YT-DLP Minimalist?" del
      // navegador aparece anclado a esa página en vez de en una ventana
      // aparte, y el navegador puede ofrecer la opción de "permitir
      // siempre" para ese sitio. La calidad Y el id (clientId) viajan
      // también en ese link de protocolo (ver buildProtocolUrl en
      // url-utils.js), así que al abrirse en frío la app arranca la
      // descarga directo y la registra con ESTE MISMO id — el popup, que ya
      // empezó a sondear /progress con él (ver needsProtocol en popup.js),
      // no tiene que esperar ninguna respuesta para encontrarla.
      recordHistory({ url: message.url, title: message.title || '', status: 'protocol', quality: message.quality || null });
      addActiveDownload({
        id: clientId,
        url: message.url,
        title: message.title || '',
        quality: message.quality || null,
        status: 'starting',
        percent: null,
        speed: null,
        eta: null,
      });
      sendResponse({ ok: false, needsProtocol: true, url: message.url, id: clientId });
    });

  return true; // respuesta asíncrona
});

// El panel lateral pide borrar el historial desde acá para no darle acceso
// directo de escritura a storage.local a cada página (content scripts
// nunca tocan el historial).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'clear-history') return;
  chrome.storage.local.set({ [HISTORY_KEY]: [] }, () => sendResponse({ ok: true }));
  return true;
});

// El popup manda esto cuando el sondeo de progreso llega a un estado final
// (completed/error/cancelled) para que la entrada correspondiente en el
// historial pase de "Enviado" a su resultado real.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'update-history-status') return;
  updateHistoryStatus(message.downloadId, message.status, message.extra).then(() => sendResponse({ ok: true }));
  return true;
});

// Consulta el progreso de una descarga puntual (por su "id", el que
// devolvió /add-url). El popup llama esto mientras está abierto para
// refrescar la barra de progreso, y una vez más al reabrirse para retomar
// el estado si se había cerrado a mitad de una descarga.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'get-progress') return;
  if (!message.id) {
    sendResponse({ ok: false });
    return;
  }

  fetch(`${PROGRESS_ENDPOINT}?id=${encodeURIComponent(message.id)}`)
    .then((res) => {
      if (!res.ok) throw new Error('bad status');
      return res.json();
    })
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch(() => sendResponse({ ok: false }));

  return true; // respuesta asíncrona
});

// Le pide a la app que abra el archivo ya descargado (o la carpeta que lo
// contiene) con la app/explorador por defecto del sistema.
function requestOpen(endpoint, id, sendResponse) {
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
    .then((res) => {
      if (!res.ok) throw new Error('bad status');
      return res.json().catch(() => ({}));
    })
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch(() => sendResponse({ ok: false }));
}

// Igual que requestOpen, pero mandando un body arbitrario en vez de siempre
// { id }. Se usa desde el historial: ahí no tenemos (o no confiamos en) el
// id efímero de la descarga, pero sí la ruta del archivo que quedó guardada
// en el historial en su momento (ver /open-file-by-path en extension-server.js).
function requestOpenByPath(endpoint, body, sendResponse) {
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then((res) => {
      if (!res.ok) throw new Error('bad status');
      return res.json().catch(() => ({}));
    })
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch(() => sendResponse({ ok: false }));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'open-file') return;
  if (!message.id) { sendResponse({ ok: false }); return; }
  requestOpen(OPEN_FILE_ENDPOINT, message.id, sendResponse);
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'open-folder') return;
  if (!message.id) { sendResponse({ ok: false }); return; }
  requestOpen(OPEN_FOLDER_ENDPOINT, message.id, sendResponse);
  return true;
});

// Abrir archivo/carpeta desde una entrada del HISTORIAL (por ruta, ver
// requestOpenByPath más arriba). "folder" es opcional: solo hace falta si
// "path" ya no existe (ej. el archivo se borró pero la carpeta sigue).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'open-file-by-path') return;
  if (!message.path) { sendResponse({ ok: false }); return; }
  requestOpenByPath(OPEN_FILE_BY_PATH_ENDPOINT, { path: message.path }, sendResponse);
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'open-folder-by-path') return;
  if (!message.path && !message.folder) { sendResponse({ ok: false }); return; }
  requestOpenByPath(OPEN_FOLDER_BY_PATH_ENDPOINT, { path: message.path, folder: message.folder }, sendResponse);
  return true;
});

// Pausar/cancelar la descarga en curso (mismo mecanismo que "Abrir archivo"/
// "Abrir carpeta": un POST con el id a la app, que hace lo pesado). El
// popup se entera del resultado (paused/cancelled) en la siguiente
// consulta de 'get-progress', ya en curso mientras la barra está visible.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'pause-download') return;
  if (!message.id) { sendResponse({ ok: false }); return; }
  requestOpen(PAUSE_ENDPOINT, message.id, sendResponse);
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'resume-download') return;
  if (!message.id) { sendResponse({ ok: false }); return; }
  requestOpen(RESUME_ENDPOINT, message.id, sendResponse);
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'cancel-download') return;
  if (!message.id) { sendResponse({ ok: false }); return; }
  requestOpen(CANCEL_ENDPOINT, message.id, sendResponse);
  return true;
});

// Trae el valor ACTUAL de "Mantener la app en segundo plano" tal como está
// guardado en la app (la app es la fuente de verdad, igual que con el resto
// de su configuración). Lo piden popup.js y options.js apenas se abren, para
// que el toggle ahí siempre arranque igual a lo que haya en el panel General
// de la app, sin importar cuál de los dos se tocó último. Si la app no está
// abierta esto falla y quien lo pidió cae al último valor conocido en
// chrome.storage.sync.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'get-app-settings') return;
  fetch(SETTINGS_ENDPOINT)
    .then((res) => {
      if (!res.ok) throw new Error('bad status');
      return res.json();
    })
    .then((data) => sendResponse({ ok: true, extensionKeepInBackground: data.extensionKeepInBackground === true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

// Manda a la app el nuevo valor del toggle cuando el usuario lo cambia desde
// la extensión (popup o página de Opciones), para que quede guardado ahí
// exactamente igual que si se hubiera tocado desde el panel General de la
// app. Si la app no está abierta esto falla en silencio: quien lo mandó ya
// guardó el valor en chrome.storage.sync para no perderlo del lado de la
// extensión, y puede avisarle al usuario que no se pudo sincronizar.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'set-app-settings') return;
  fetch(SETTINGS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ extensionKeepInBackground: !!message.extensionKeepInBackground }),
  })
    .then((res) => {
      if (!res.ok) throw new Error('bad status');
      return res.json().catch(() => ({}));
    })
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});
