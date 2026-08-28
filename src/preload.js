const { contextBridge, ipcRenderer, clipboard } = require('electron');

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
  // Confirma que el link ya se aplicó (se pegó en el input y se disparó la
  // búsqueda), para que main.js deje de reenviarlo.
  ackExtensionUrl: () => ipcRenderer.send('extension:url-ack'),
  // Link con el que se pudo haber lanzado la app en frío (ej. el usuario
  // hizo clic en "Descargar" en la extensión sin tener la app abierta, y
  // el navegador la abrió vía el protocolo ytdlpminimalist://). Se consulta
  // una sola vez al arrancar, en vez de depender de que main.js le mande el
  // evento 'extension:url' justo a tiempo (ver comentario en main.js).
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
  showInFolder: (filePath) => ipcRenderer.send('history:open-file', filePath),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
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
