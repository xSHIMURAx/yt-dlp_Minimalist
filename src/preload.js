const { contextBridge, ipcRenderer, clipboard } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('yoinksAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  openDownloads: () => ipcRenderer.send('open-downloads'),

  getAppVersion: () => ipcRenderer.invoke('app:get-version'),

  readClipboard: () => ipcRenderer.invoke('clipboard:read'),

  fetchFormats: (url) => ipcRenderer.invoke('app:fetch-formats', url),
  fetchPlaylist: (url) => ipcRenderer.invoke('app:fetch-playlist', url),
  download: (payload) => ipcRenderer.invoke('app:download', payload),
  pauseDownload: (downloadId) => ipcRenderer.send('app:pause', downloadId),
  cancelDownload: (downloadId) => ipcRenderer.send('app:cancel', downloadId),
  onProgress: (callback) =>
    ipcRenderer.on('app:progress', (_event, data) => callback(data)),

  // URL recibida desde la extensión del navegador. main.js puede reenviar
  // el mismo link varias veces (ver 'pendingUrlRetryTimer' ahí) hasta que
  // confirmemos que lo aplicamos con ackExtensionUrl(); por eso el
  // callback tiene que ser capaz de recibir el mismo link más de una vez
  // sin romper nada (ver 'lastAppliedExtensionUrl' en renderer.js).
  onExtensionUrl: (callback) =>
    ipcRenderer.on('extension:url', (_event, url) => callback(url)),
  // Igual que 'extension:url', pero para cuando el usuario ya eligió una
  // calidad en el popup o el botón flotante del navegador: en vez de solo
  // pegar el link, la app arranca la descarga directo con esa calidad (ver
  // handleUrlFromExtension en main.js y applyExtensionDownload en renderer.js).
  onExtensionDownload: (callback) =>
    ipcRenderer.on('extension:download', (_event, payload) => callback(payload)),
  // Confirma que el link ya se aplicó (se pegó en el input y se disparó la
  // búsqueda), para que main.js deje de reenviarlo.
  ackExtensionUrl: () => ipcRenderer.send('extension:url-ack'),
  // Link con el que se pudo haber lanzado la app en frío (ej. el usuario
  // hizo clic en "Descargar" en la extensión sin tener la app abierta, y
  // el navegador la abrió vía el protocolo ytdlpminimalist://). Se consulta
  // una sola vez al arrancar, en vez de depender de que main.js le mande el
  // evento 'extension:url'/'extension:download' justo a tiempo (ver
  // comentario en main.js). Devuelve null si no había nada pendiente, o
  // { url, quality } — "quality" es null si el link no traía una calidad
  // ya elegida.
  getPendingExtensionUrl: () => ipcRenderer.invoke('extension:get-pending-url'),

  // Diálogo "¿Qué querés hacer?" al presionar ✕ (closeBehavior = 'ask').
  onAskCloseBehavior: (callback) =>
    ipcRenderer.on('close:ask-behavior', () => callback()),
  respondCloseBehavior: (payload) => ipcRenderer.send('close:behavior-response', payload),

  // ---- Modo Terminal (ejecutar comandos de yt-dlp "en crudo") ----
  runTerminalCommand: (command) => ipcRenderer.invoke('terminal:run', command),
  stopTerminalCommand: () => ipcRenderer.send('terminal:stop'),
  onTerminalOutput: (callback) =>
    ipcRenderer.on('terminal:output', (_event, data) => callback(data)),
  onTerminalDone: (callback) =>
    ipcRenderer.on('terminal:done', (_event, data) => callback(data)),

  listPresets: () => ipcRenderer.invoke('presets:list'),
  addPreset: (preset) => ipcRenderer.invoke('presets:add', preset),
  deletePreset: (index) => ipcRenderer.invoke('presets:delete', index),
  updatePreset: (index, preset) => ipcRenderer.invoke('presets:update', index, preset),
  resetPresets: () => ipcRenderer.invoke('presets:reset'),

  listHistory: () => ipcRenderer.invoke('history:list'),
  deleteHistoryItem: (id) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  openHistoryFile: (filePath) => ipcRenderer.send('history:open-file', filePath),
  openHistoryFolder: (filePath) => ipcRenderer.send('history:open-folder', filePath),
  showInFolder: (filePath) => ipcRenderer.send('history:open-folder', filePath),
  // Convierte una ruta local (ej. "C:\Users\...\video.mp4") a un file:// URL
  // válido para el src del <video> del modal de previsualización. Se hace acá
  // (preload, con acceso a Node) porque el renderer no tiene el módulo 'url'.
  pathToFileUrl: (filePath) => pathToFileURL(filePath).href,

  // Algunos sitios (Bilibili es el caso típico) exigen un Referer/User-Agent
  // puntual en el pedido HTTP del video/audio de la vista previa o el CDN lo
  // rechaza, algo que un <video>/<audio> nativo no puede mandar por sí solo.
  // El main process los inyecta por nosotros (ver 'preview:set-headers').
  setPreviewHeaders: (entries) => ipcRenderer.invoke('preview:set-headers', entries),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  // Avisa cuando el toggle "Mantener en segundo plano" cambió desde la
  // extensión del navegador (Opciones), para reflejarlo al instante en el
  // panel General si está abierto (ver settings:extension-updated en main.js).
  onExtensionSettingsUpdated: (callback) =>
    ipcRenderer.on('settings:extension-updated', (_event, data) => callback(data)),
  setLanguage: (lang) => ipcRenderer.send('language:set', lang),
  selectDownloadFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  selectCookiesFile: (site) => ipcRenderer.invoke('dialog:select-cookies-file', site),
  addCustomCookieSite: (payload) => ipcRenderer.invoke('cookies:add-custom-site', payload),
  updateCustomCookieSite: (payload) => ipcRenderer.invoke('cookies:update-custom-site', payload),
  removeCustomCookieSite: (id) => ipcRenderer.invoke('cookies:remove-custom-site', id),

  startLogin: (site) => ipcRenderer.invoke('login:start', site),
  getLoginStatus: () => ipcRenderer.invoke('login:status'),
  logoutSite: (site) => ipcRenderer.invoke('login:logout', site),

  getUpdateVersions: () => ipcRenderer.invoke('update:get-versions'),
  updateYtDlp: () => ipcRenderer.invoke('update:ytdlp'),
  updateFfmpeg: () => ipcRenderer.invoke('update:ffmpeg'),
  updateDeno: () => ipcRenderer.invoke('update:deno'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  playNotificationSound: () => ipcRenderer.invoke('app:play-notification-sound'),
  onUpdateProgress: (callback) =>
    ipcRenderer.on('update:progress', (_event, data) => callback(data)),
});
