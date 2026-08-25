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
  selectDownloadFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  selectCookiesFile: (site) => ipcRenderer.invoke('dialog:select-cookies-file', site),

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
