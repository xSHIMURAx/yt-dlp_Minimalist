// ---- Idioma (i18n) ----
// Se aplica lo antes posible (antes de leer settings de disco) usando el
// idioma guardado localmente para evitar un "flash" en español al abrir la
// app; luego, cuando cargan los settings reales del panel General, se
// re-confirma/corrige por si difiere.
(function bootstrapLanguage() {
  let lang = 'es';
  try {
    lang = localStorage.getItem('ytdlp-minimalist-lang') || 'es';
  } catch (e) {
    // localStorage puede no estar disponible en algunos contextos; usamos 'es' por defecto
  }
  window.i18n.setLanguage(lang);
})();

function applyLanguage(lang) {
  window.i18n.setLanguage(lang);
  try {
    localStorage.setItem('ytdlp-minimalist-lang', lang);
  } catch (e) {
    // si falla el guardado local no es crítico, solo no persiste entre sesiones
  }
  window.i18n.applyTranslations(document);

  // Re-pintar listas armadas dinámicamente (no usan data-i18n, así que
  // applyTranslations no las toca): el historial guardado en disco puede
  // traer "labels" en el idioma viejo (ver translateKnownText en i18n.js),
  // y la lista de descargas activas usa textos de estado generados en JS.
  // Sin esto, ambas quedaban "congeladas" en el idioma que estaba activo
  // cuando se pintaron por última vez hasta que el usuario cambiaba de
  // pestaña manualmente.
  if (typeof refreshAllHistoryTabsFromDisk === 'function') refreshAllHistoryTabsFromDisk();
  if (typeof renderDownloadsPanel === 'function') renderDownloadsPanel();

  // Igual problema en la pantalla de calidades: las filas incorporadas
  // ("Mejor video y audio disponible", "Mejor audio disponible", "Alta/Media/Baja")
  // se arman una sola vez al abrir esa pantalla (buildDownloadOptions) y su
  // texto queda guardado tal cual en formatItems, así que si el usuario
  // cambia de idioma sin salir de esa pantalla, esas filas no se retraducían
  // aunque el resto de la UI sí. Re-traducimos in-place y volvemos a pintar.
  if (typeof formatItems !== 'undefined' && formatItems.length) {
    formatItems.forEach((opt) => {
      if (opt.res) opt.res = window.i18n.translateKnownText(opt.res);
    });
    if (typeof renderDownloadList === 'function') {
      renderDownloadList();
    }
  }

  // Mismo problema en las "píldoras" de estadísticas (Duración/Vistas/Likes/
  // Publicado): sus etiquetas se escriben una sola vez como texto plano al
  // consultar el video (renderStatsPills), tanto en la pantalla de calidades
  // como en el panel de Información. currentVideoInfo guarda los datos crudos
  // del último video consultado, así que alcanza con volver a armarlas.
  if (typeof currentVideoInfo !== 'undefined' && currentVideoInfo && typeof renderStatsPills === 'function') {
    if (typeof videoMetaStatsEl !== 'undefined' && videoMetaStatsEl) renderStatsPills(videoMetaStatsEl, currentVideoInfo);
    if (typeof videoInfoStatsEl !== 'undefined' && videoInfoStatsEl) renderStatsPills(videoInfoStatsEl, currentVideoInfo);
  }

  // La tabla de presets (panel ⚙) tiene el mismo problema cuando está vacía:
  // el "Sin presets todavía." se escribe una sola vez como texto plano y no
  // se retraduce solo. Cuando SÍ hay presets, cada fila ya usa data-i18n /
  // se regenera con botones traducidos dinámicamente al abrirse, así que
  // alcanza con volver a pintar la tabla completa.
  if (typeof renderPresetsTable === 'function' && typeof presets !== 'undefined') {
    renderPresetsTable();
  }
  // Mismo caso con el desplegable de presets del selector de calidad (si
  // llegara a estar abierto justo al cambiar de idioma).
  if (typeof populatePresetDropdown === 'function') {
    populatePresetDropdown();
  }
}

// Vuelve a pedir el historial completo al disco y repinta las 4 pestañas
// (Historial, Completadas, Error, Cancelado) con el idioma actual.
async function refreshAllHistoryTabsFromDisk() {
  let history = [];
  try {
    history = (await window.yoinksAPI.listHistory()) || [];
  } catch (e) {
    history = [];
  }
  renderAllHistoryTabs(history);
}

document.addEventListener('DOMContentLoaded', () => {
  window.i18n.applyTranslations(document);
});
// Por si el script corre después de que el DOM ya esté listo.
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  window.i18n.applyTranslations(document);
}

// ---- Controles de la barra de título ----
document.getElementById('btn-min').addEventListener('click', () => window.yoinksAPI.minimize());
document.getElementById('btn-close').addEventListener('click', () => window.yoinksAPI.close());

// Todos los paneles/overlays de tipo "modal" (Info del video, Presets,
// Configuración de Descarga, Actualizaciones, Actividad/Procesos, Acerca de)
// comparten la clase "presets-overlay". Antes de abrir cualquiera de ellos se
// cierran los demás que estuvieran abiertos, para que no queden dos paneles
// superpuestos en pantalla.
function closeAllOverlayPanels() {
  document.querySelectorAll('.presets-overlay').forEach((el) => el.classList.add('hidden'));
}

// ---- Elementos ----
const input = document.getElementById('url-input');
const pasteUrlBtn = document.getElementById('paste-url-btn');
const clearUrlBtn = document.getElementById('clear-url-btn');
const yoinkBtn = document.getElementById('yoink-btn'); // botón "Download"
const statusHomeEl = document.getElementById('status-home');
const statusPickerEl = document.getElementById('status-picker');
const videoMetaEl = document.getElementById('video-meta');
const videoThumbEl = document.getElementById('video-thumb');
const videoTitleEl = document.getElementById('video-title');
const videoSubEl = document.getElementById('video-sub');
const videoMetaStatsEl = document.getElementById('video-meta-stats');
const downloadFrameEl = document.getElementById('download-frame');
const downloadListEl = document.getElementById('download-list');
let downloadListInner = downloadListEl;
const pickerDownloadBtn = document.getElementById('picker-download-btn');

// ---- Dropdown de Preajustes en Download Frame ----
const presetMenuBtn = document.getElementById('preset-menu-btn');
const presetDropdownMenu = document.getElementById('preset-dropdown-menu');
const presetDropdownList = document.getElementById('preset-dropdown-list');
let selectedPresetForDownload = null; // índice del preajuste seleccionado para descarga
const backBtn = document.getElementById('back-btn');

// ---- Panel de Información del Video (consulta sin descargar) ----
const infoBtn = document.getElementById('info-btn');
const videoInfoOverlay = document.getElementById('video-info-overlay');
const videoInfoCloseBtn = document.getElementById('video-info-close-btn');
const videoInfoThumbEl = document.getElementById('video-info-thumb');
const videoInfoTitleEl = document.getElementById('video-info-title');
const videoInfoUploaderEl = document.getElementById('video-info-uploader');
const videoInfoSiteEl = document.getElementById('video-info-site');
const videoInfoStatsEl = document.getElementById('video-info-stats');
const videoInfoFormatsSectionEl = document.getElementById('video-info-formats-section');
const videoInfoFormatsEl = document.getElementById('video-info-formats');
const videoInfoDescriptionSectionEl = document.getElementById('video-info-description-section');
const videoInfoDescriptionEl = document.getElementById('video-info-description');
const videoInfoPlaylistSectionEl = document.getElementById('video-info-playlist-section');
const videoInfoPlaylistListEl = document.getElementById('video-info-playlist-list');
const videoInfoLinkEl = document.getElementById('video-info-link');
const videoInfoStatusEl = document.getElementById('video-info-status');
const videoInfoCopyBtn = document.getElementById('video-info-copy-btn');
const videoInfoDownloadBtn = document.getElementById('video-info-download-btn');

// Datos del último resultado mostrado en el panel de información,
// para poder "Descargar este video" / "Copiar información" sin volver a consultar yt-dlp.
let videoInfoContext = null; // { type: 'video', url, info } | { type: 'playlist', url, result }

// ---- Pantalla de playlist ----
const screenPlaylist = document.getElementById('screen-playlist');
const playlistBackBtn = document.getElementById('playlist-back-btn');
const playlistTitleEl = document.getElementById('playlist-title');
const playlistCountEl = document.getElementById('playlist-count');
const playlistSelectAllEl = document.getElementById('playlist-select-all');
const playlistQualitySelect = document.getElementById('playlist-quality-select');
const playlistReverseBtn = document.getElementById('playlist-reverse-btn');
const playlistListEl = document.getElementById('playlist-list');
const playlistDownloadBtn = document.getElementById('playlist-download-btn');
const statusPlaylistEl = document.getElementById('status-playlist');
const playlistDownloadPathInput = document.getElementById('playlist-download-path');
const playlistPathBrowseBtn = document.getElementById('playlist-path-browse-btn');
const playlistCreateFolderCheckbox = document.getElementById('playlist-create-folder');

// '' = usar la carpeta predeterminada de Configuración de Descarga
let playlistCustomPath = '';

// ---- Pantallas (home / picker), como en yoinks ----
const screenHome = document.getElementById('screen-home');
const screenPicker = document.getElementById('screen-picker');

// Mide cuánto contenido real tiene la pantalla de video (título largo,
// formatos, etc.) y le pide a main.js que agrande la ventana lo necesario
// para que se vea todo sin scroll. Se llama tras poblar la pantalla y de
// nuevo tras cargar los datos del video (el título puede tardar en llegar).
function goToPickerScreen() {
  screenHome.classList.remove('active');
  screenPicker.classList.add('active');
  setTimeout(() => downloadListEl.focus(), 180);
}

function goToHomeScreen() {
  screenPicker.classList.remove('active');
  screenPlaylist.classList.remove('active');
  screenHome.classList.add('active');
  setStatus('', '', 'picker');
  setTimeout(() => input.focus(), 180);
}

function goToPlaylistScreen() {
  screenHome.classList.remove('active');
  screenPlaylist.classList.add('active');
}

playlistBackBtn.addEventListener('click', goToHomeScreen);

// ---- Detectar si el link pegado es una playlist de YouTube (parámetro ?list=) ----
function getPlaylistId(url) {
  try {
    const u = new URL(url);
    const list = u.searchParams.get('list');
    // 'WL' (watch later), 'LL' (liked) y mixes 'RD...' también sirven; solo evitamos cadenas vacías
    return list && list.trim() ? list : null;
  } catch {
    return null;
  }
}

backBtn.addEventListener('click', goToHomeScreen);

// Elementos de presets (panel ⚙)
const settingsBtn = document.getElementById('btn-presets');
const settingsMenu = document.getElementById('settings-menu');
const menuGeneral = document.getElementById('menu-general');
const menuDownload = document.getElementById('menu-download');
const menuCookies = document.getElementById('menu-cookies');
const menuPresets = document.getElementById('menu-presets');
const menuUpdates = document.getElementById('menu-updates');
const menuAbout = document.getElementById('menu-about');
const presetsOverlay = document.getElementById('presets-overlay');
const presetsCloseBtn = document.getElementById('presets-close-btn');
const presetsTbody = document.getElementById('presets-tbody');
const presetSiteInput = document.getElementById('preset-site');
const presetNameInput = document.getElementById('preset-name');
const presetOptionsInput = document.getElementById('preset-options');
const presetsAddBtn = document.getElementById('presets-add-btn');
const presetsResetBtn = document.getElementById('presets-reset-btn');
const presetsCancelEditBtn = document.getElementById('presets-cancel-edit-btn');

// Elementos de Configuración de Descarga (panel ⚙ → Download)
const downloadSettingsOverlay = document.getElementById('download-settings-overlay');
const downloadSettingsCloseBtn = document.getElementById('download-settings-close-btn');
const downloadSettingsSaveBtn = document.getElementById('download-settings-save-btn');
const downloadSettingsResetBtn = document.getElementById('download-settings-reset-btn');
const settingDownloadPathInput = document.getElementById('setting-download-path');
const settingPathBrowseBtn = document.getElementById('setting-path-browse-btn');
const settingOutputTemplateInput = document.getElementById('setting-output-template');
const settingCookiesSiteSelect = document.getElementById('setting-cookies-site');
const settingCookiesModeSelect = document.getElementById('setting-cookies-mode');
const settingCookiesBrowserRow = document.getElementById('setting-cookies-browser-row');
const settingCookiesBrowserSelect = document.getElementById('setting-cookies-browser');
const settingCookiesFileRow = document.getElementById('setting-cookies-file-row');
const settingCookiesFileInput = document.getElementById('setting-cookies-file');
const settingCookiesFileBrowseBtn = document.getElementById('setting-cookies-file-browse-btn');
const settingLoginRow = document.getElementById('setting-login-row');
const settingLoginBtn = document.getElementById('setting-login-btn');
const settingLoginLogoutBtn = document.getElementById('setting-login-logout-btn');
const settingLoginStatusEl = document.getElementById('setting-login-status');
const settingRateLimitInput = document.getElementById('setting-rate-limit');
const settingConcurrentDownloadsSelect = document.getElementById('setting-concurrent-downloads');
const settingSoundEnabledCheckbox = document.getElementById('setting-sound-enabled');
const settingCloseBehaviorSelect = document.getElementById('setting-close-behavior');
const settingLanguageSelect = document.getElementById('setting-language');

// Elementos del panel de Cookies (panel ⚙ → Cookies)
const cookiesOverlay = document.getElementById('cookies-overlay');
const cookiesCloseBtn = document.getElementById('cookies-close-btn');
const cookiesSaveBtn = document.getElementById('cookies-save-btn');
const cookiesResetBtn = document.getElementById('cookies-reset-btn');

// Elementos del panel General (panel ⚙ → General)
const generalOverlay = document.getElementById('general-overlay');
const generalCloseBtn = document.getElementById('general-close-btn');
const generalSaveBtn = document.getElementById('general-save-btn');
const generalResetBtn = document.getElementById('general-reset-btn');

// Elementos del panel de Actualizaciones (yt-dlp / FFmpeg)
const updatesOverlay = document.getElementById('updates-overlay');
const updatesCloseBtn = document.getElementById('updates-close-btn');
const updatesStatusEl = document.getElementById('updates-status');
const settingYtdlpChannelSelect = document.getElementById('setting-ytdlp-channel');
const updateYtdlpVersionEl = document.getElementById('update-ytdlp-version');
const updateYtdlpBtn = document.getElementById('update-ytdlp-btn');
const updateYtdlpProgressWrap = document.getElementById('update-ytdlp-progress-wrap');
const updateYtdlpProgressFill = document.getElementById('update-ytdlp-progress-fill');
const updateYtdlpProgressText = document.getElementById('update-ytdlp-progress-text');
const updateFfmpegVersionEl = document.getElementById('update-ffmpeg-version');
const updateFfmpegBtn = document.getElementById('update-ffmpeg-btn');
const updateFfmpegProgressWrap = document.getElementById('update-ffmpeg-progress-wrap');
const updateFfmpegProgressFill = document.getElementById('update-ffmpeg-progress-fill');
const updateFfmpegProgressText = document.getElementById('update-ffmpeg-progress-text');
const updateDenoVersionEl = document.getElementById('update-deno-version');
const updateDenoBtn = document.getElementById('update-deno-btn');
const updateDenoProgressWrap = document.getElementById('update-deno-progress-wrap');
const updateDenoProgressFill = document.getElementById('update-deno-progress-fill');
const updateDenoProgressText = document.getElementById('update-deno-progress-text');
const settingsUpdateBadge = document.getElementById('settings-update-badge');
const menuUpdatesBadge = document.getElementById('menu-updates-badge');
const updateYtdlpAvailableTag = document.getElementById('update-ytdlp-available-tag');
const updateFfmpegAvailableTag = document.getElementById('update-ffmpeg-available-tag');
const updateYtdlpUpToDateTag = document.getElementById('update-ytdlp-uptodate-tag');
const updateFfmpegUpToDateTag = document.getElementById('update-ffmpeg-uptodate-tag');
const updateDenoAvailableTag = document.getElementById('update-deno-available-tag');
const updateDenoUpToDateTag = document.getElementById('update-deno-uptodate-tag');

// Último resultado conocido de la revisión automática de actualizaciones
// (se usa para pintar las etiquetas "Nueva versión disponible" al abrir el panel)
let lastUpdateCheck = { ytdlpUpdateAvailable: false, ffmpegUpdateAvailable: false, denoUpdateAvailable: false };

// Elementos del panel de Actividad (Descargas en curso + Historial, unificados con pestañas)
const btnActivity = document.getElementById('btn-activity');
const downloadsBadge = document.getElementById('downloads-badge');
const activityOverlay = document.getElementById('activity-overlay');
const activityCloseBtn = document.getElementById('activity-close-btn');
const activityTabDownloads = document.getElementById('activity-tab-downloads');
const activityTabCompleted = document.getElementById('activity-tab-completed');
const activityTabError = document.getElementById('activity-tab-error');
const activityTabCancelled = document.getElementById('activity-tab-cancelled');
const activityTabHistory = document.getElementById('activity-tab-history');
const activityPanelDownloads = document.getElementById('activity-panel-downloads');
const activityPanelCompleted = document.getElementById('activity-panel-completed');
const activityPanelError = document.getElementById('activity-panel-error');
const activityPanelCancelled = document.getElementById('activity-panel-cancelled');
const activityPanelHistory = document.getElementById('activity-panel-history');

// Elementos de la pestaña "Descargas en curso"
const downloadsListEl = document.getElementById('downloads-list');
const downloadsEmptyEl = document.getElementById('downloads-empty');
const downloadsToolbarEl = document.getElementById('downloads-toolbar');
const downloadsSelectAllCheckbox = document.getElementById('downloads-select-all');
const downloadsPauseBtn = document.getElementById('downloads-pause-btn');
const downloadsResumeBtn = document.getElementById('downloads-resume-btn');
const downloadsCancelBtn = document.getElementById('downloads-cancel-btn');

// Elementos de las pestañas filtradas por estado (Completadas / Error / Canceladas)
const completedListEl = document.getElementById('completed-list');
const completedEmptyEl = document.getElementById('completed-empty');
const errorListEl = document.getElementById('error-list');
const errorEmptyEl = document.getElementById('error-empty');
const cancelledListEl = document.getElementById('cancelled-list');
const cancelledEmptyEl = document.getElementById('cancelled-empty');

// Elementos de la pestaña "Historial" (todas las entradas, sin filtrar)
const historyListEl = document.getElementById('history-list');
const historyEmptyEl = document.getElementById('history-empty');
const historyClearBtn = document.getElementById('history-clear-btn');

let presets = [];
let currentUrl = '';
// downloadId "dueño" actual del mensaje de estado en la pantalla de picker.
// Evita que el progreso de una descarga anterior (o de otro video) siga
// escribiendo en el mismo status cuando ya se cambió de pantalla/video.
let currentPickerStatusOwner = null;
let currentVideoInfo = null; // { title, extractor_key } del último video consultado
let formatItems = []; // formatos detectados del video (+ audio only)

// Contenedores de salida entre los que se puede elegir para las filas de video
// (columna "Formato"). yt-dlp remuxea/combina al contenedor elegido con ffmpeg.
const CONTAINER_FORMATS = ['mp4', 'mkv', 'webm', 'mov'];
// Formatos de audio para el preajuste "Mejor audio disponible".
const AUDIO_FORMATS = ['mp3', 'm4a', 'opus'];
let presetItems = []; // presets que coinciden con el sitio
let downloadOptions = []; // lista "aplanada" y navegable = formatItems + presetItems
let selectedIndex = 0;

function recomputeVisibleOptions() {
  downloadOptions = formatItems.concat(presetItems);
  if (selectedIndex >= downloadOptions.length) selectedIndex = 0;
}

function setStatus(text, type = '', screen = 'home', action = null) {
  const el = screen === 'picker' ? statusPickerEl : statusHomeEl;
  el.textContent = text;
  // Acción opcional: si se pasa, el propio mensaje se vuelve clicable
  // (ej. "Listo. Guardado en..." -> click abre la carpeta de descarga)
  el.onclick = action && action.onClick ? action.onClick : null;
  el.className = 'status' + (type ? ' ' + type : '') + (action && action.onClick ? ' status-clickable' : '');
}

function clearResults() {
  downloadOptions = [];
  selectedIndex = 0;
  setStatus('', '', 'home');
  setStatus('', '', 'picker');
}

// ---- Enter en el input dispara la búsqueda de formatos ----
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleYoink();
});
yoinkBtn.addEventListener('click', handleYoink);

// ---- Botón "📋" para pegar del portapapeles / "✕" para borrar el link ----
function updateClearBtnVisibility() {
  const hasText = input.value.length > 0;
  clearUrlBtn.classList.toggle('hidden', !hasText);
  pasteUrlBtn.classList.toggle('hidden', hasText);
}

input.addEventListener('input', updateClearBtnVisibility);

clearUrlBtn.addEventListener('click', () => {
  input.value = '';
  updateClearBtnVisibility();
  input.focus();
});

pasteUrlBtn.addEventListener('click', async () => {
  try {
    pasteUrlBtn.disabled = true;
    pasteUrlBtn.textContent = window.i18n.t('reading_clipboard');
    
    const text = await window.yoinksAPI.readClipboard();
    
    if (text && text.trim()) {
      input.value = text.trim();
      updateClearBtnVisibility();
      setStatus(window.i18n.t('link_pasted'), 'success', 'home');
      setTimeout(() => setStatus('', '', 'home'), 2000);
    } else {
      setStatus(window.i18n.t('clipboard_empty'), 'error', 'home');
    }
    input.focus();
  } catch (err) {
    setStatus(window.i18n.t('generic_error', { error: err.message }), 'error', 'home');
    console.error('Clipboard error:', err);
  } finally {
    pasteUrlBtn.disabled = false;
    pasteUrlBtn.textContent = window.i18n.t('btn_paste');
  }
});

updateClearBtnVisibility(); // estado inicial (por si el input trae algo precargado)

// ---- URL enviada desde la extensión del navegador ----
// Si ya estábamos en la pantalla de calidades (viendo otro video), primero
// volvemos a la pantalla principal para que se vea el link pegado antes de
// pasar a buscar los formatos del nuevo video.
window.yoinksAPI.onExtensionUrl((url) => {
  goToHomeScreen();
  input.value = url;
  updateClearBtnVisibility();
  setStatus(window.i18n.t('link_from_extension'), 'success', 'home');
  handleYoink();
});

// ---- Diálogo "¿Qué querés hacer?" al presionar ✕ (closeBehavior = 'ask') ----
const closeBehaviorOverlay = document.getElementById('close-behavior-overlay');
const closeBehaviorRememberCheckbox = document.getElementById('close-behavior-remember');
const closeBehaviorCancelBtn = document.getElementById('close-behavior-cancel-btn');
const closeBehaviorCloseBtn = document.getElementById('close-behavior-close-btn');
const closeBehaviorMinimizeBtn = document.getElementById('close-behavior-minimize-btn');

function respondCloseBehavior(action) {
  closeBehaviorOverlay.classList.add('hidden');
  window.yoinksAPI.respondCloseBehavior({ action, remember: closeBehaviorRememberCheckbox.checked });
  closeBehaviorRememberCheckbox.checked = false;
}

closeBehaviorMinimizeBtn.addEventListener('click', () => respondCloseBehavior('minimize'));
closeBehaviorCloseBtn.addEventListener('click', () => respondCloseBehavior('close'));
closeBehaviorCancelBtn.addEventListener('click', () => respondCloseBehavior('cancel'));
closeBehaviorOverlay.addEventListener('click', (e) => {
  if (e.target === closeBehaviorOverlay) respondCloseBehavior('cancel');
});

window.yoinksAPI.onAskCloseBehavior(() => {
  closeBehaviorOverlay.classList.remove('hidden');
  closeBehaviorMinimizeBtn.focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !closeBehaviorOverlay.classList.contains('hidden')) {
    respondCloseBehavior('cancel');
  }
});

// Reintenta una función asíncrona hasta `maxRetries` veces extra (con una
// pequeña pausa entre intentos) antes de rendirse. Sirve para fallos
// intermitentes como el bloqueo anti-bot de TikTok, que a veces funciona
// con solo reintentar sin que el usuario tenga que volver a hacer clic.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries(fn, { maxRetries = 2, delayMs = 1500, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        if (onRetry) onRetry(attempt + 1, maxRetries);
        await sleep(delayMs);
      }
    }
  }
  throw lastErr;
}

async function handleYoink() {
  const url = input.value.trim();
  if (!url) {
    setStatus(window.i18n.t('paste_link_first'), 'error', 'home');
    return;
  }

  currentUrl = url;

  // ---- Si el link trae un ?list=, lo tratamos como playlist ----
  const playlistId = getPlaylistId(url);
  if (playlistId) {
    yoinkBtn.disabled = true;
    setStatus(window.i18n.t('loading_playlist'), 'loading', 'home');
    try {
      const result = await withRetries(() => window.yoinksAPI.fetchPlaylist(url), {
        maxRetries: 2,
        delayMs: 1500,
        onRetry: (attempt, total) =>
          setStatus(window.i18n.t('no_response_retrying', { attempt, total }), 'loading', 'home'),
      });
      renderPlaylist(result);
      setStatus('', '', 'home');
      goToPlaylistScreen();
    } catch (err) {
      setStatus(window.i18n.t('could_not_read_playlist', { error: err.message }), 'error', 'home');
    } finally {
      yoinkBtn.disabled = false;
    }
    return;
  }

  yoinkBtn.disabled = true;
  setStatus(window.i18n.t('searching_formats'), 'loading', 'home');

  try {
    const info = await withRetries(() => window.yoinksAPI.fetchFormats(url), {
      maxRetries: 2,
      delayMs: 1500,
      onRetry: (attempt, total) =>
        setStatus(window.i18n.t('no_response_retrying', { attempt, total }), 'loading', 'home'),
    });
    currentVideoInfo = info;
    renderVideoMeta(info);
    buildDownloadOptions(info);
    renderDownloadList();
    setStatus('', '', 'home');
    currentPickerStatusOwner = null; // este picker ya no pertenece a la descarga anterior
    setStatus('', '', 'picker');
    goToPickerScreen(); // ---- transición a la "segunda pantalla" con los formatos/presets ----
  } catch (err) {
    setStatus(window.i18n.t('could_not_read_link', { error: err.message }), 'error', 'home');
  } finally {
    yoinkBtn.disabled = false;
  }
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

// Si la miniatura no carga (link caído, sin CORS, etc.), la ocultamos en vez de mostrar el icono roto
videoThumbEl.addEventListener('error', () => videoThumbEl.classList.add('hidden'));

// Elige la mejor miniatura disponible del video (yt-dlp expone "thumbnail" o un arreglo "thumbnails")
function pickThumbnailUrl(info) {
  if (info.thumbnail) return info.thumbnail;
  if (Array.isArray(info.thumbnails) && info.thumbnails.length > 0) {
    return info.thumbnails[info.thumbnails.length - 1].url;
  }
  return null;
}

function renderVideoMeta(info) {
  videoTitleEl.textContent = info.title || window.i18n.t('no_title');

  const thumbUrl = pickThumbnailUrl(info);
  if (thumbUrl) {
    videoThumbEl.src = thumbUrl;
    videoThumbEl.classList.remove('hidden');
  } else {
    videoThumbEl.removeAttribute('src');
    videoThumbEl.classList.add('hidden');
  }

  const parts = [];
  if (info.extractor_key) parts.push(info.extractor_key);
  if (info.uploader) parts.push(info.uploader);

  videoSubEl.textContent = parts.join(' · ');

  renderStatsPills(videoMetaStatsEl, info);
}

// ================= INFORMACIÓN DEL VIDEO (sin descargar) =================

infoBtn.addEventListener('click', handleVideoInfo);

async function handleVideoInfo() {
  const url = input.value.trim();
  if (!url) {
    setStatus(window.i18n.t('paste_link_first'), 'error', 'home');
    return;
  }

  infoBtn.disabled = true;
  const originalLabel = infoBtn.textContent;
  infoBtn.textContent = window.i18n.t('querying');
  setStatus('', '', 'home');

  try {
    const playlistId = getPlaylistId(url);
    if (playlistId) {
      const result = await withRetries(() => window.yoinksAPI.fetchPlaylist(url), {
        maxRetries: 2,
        delayMs: 1500,
        onRetry: (attempt, total) => (infoBtn.textContent = window.i18n.t('retrying', { attempt, total })),
      });
      renderVideoInfoPlaylist(result, url);
    } else {
      const info = await withRetries(() => window.yoinksAPI.fetchFormats(url), {
        maxRetries: 2,
        delayMs: 1500,
        onRetry: (attempt, total) => (infoBtn.textContent = window.i18n.t('retrying', { attempt, total })),
      });
      renderVideoInfoSingle(info, url);
    }
    openVideoInfoPanel();
  } catch (err) {
    setStatus(window.i18n.t('could_not_get_info', { error: err.message }), 'error', 'home');
  } finally {
    infoBtn.disabled = false;
    infoBtn.textContent = originalLabel;
  }
}

// Formatea vistas/likes con separador de miles (ej. 1.234.567)
function formatCount(n) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return null;
  try {
    return Number(n).toLocaleString(window.i18n.getLanguage() === 'en' ? 'en' : 'es');
  } catch (e) {
    return String(n);
  }
}

// yt-dlp entrega la fecha de publicación como "YYYYMMDD"
function formatUploadDate(yyyymmdd) {
  if (!yyyymmdd || typeof yyyymmdd !== 'string' || yyyymmdd.length !== 8) return null;
  const year = yyyymmdd.slice(0, 4);
  const month = yyyymmdd.slice(4, 6);
  const day = yyyymmdd.slice(6, 8);
  return `${day}/${month}/${year}`;
}

function addVideoInfoStat(container, label, value) {
  if (value === null || value === undefined || value === '') return;
  const pill = document.createElement('span');
  pill.className = 'video-info-stat';
  const labelEl = document.createElement('span');
  labelEl.className = 'video-info-stat-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'video-info-stat-value';
  valueEl.textContent = String(value);
  pill.appendChild(labelEl);
  pill.appendChild(valueEl);
  container.appendChild(pill);
}

// Arma las mismas "píldoras" de estadísticas (duración, vistas, likes, publicado)
// que usa el panel de Información del Video, reutilizables en cualquier contenedor.
function renderStatsPills(container, info) {
  container.innerHTML = '';
  const duration = formatDuration(info.duration);
  if (duration) addVideoInfoStat(container, window.i18n.t('stat_duration'), duration);
  const views = formatCount(info.view_count);
  if (views) addVideoInfoStat(container, window.i18n.t('stat_views'), views);
  const likes = formatCount(info.like_count);
  if (likes) addVideoInfoStat(container, window.i18n.t('stat_likes'), likes);
  const uploadDate = formatUploadDate(info.upload_date);
  if (uploadDate) addVideoInfoStat(container, window.i18n.t('stat_published'), uploadDate);
}

// Lista de resoluciones de video detectadas (sin traer/descargar nada, solo lo que ya viene en el JSON de metadatos)
function buildResolutionsSummary(info) {
  const videoFormats = (info.formats || []).filter((f) => f.vcodec && f.vcodec !== 'none' && f.height);
  const heights = [...new Set(videoFormats.map((f) => f.height))].sort((a, b) => b - a);
  if (!heights.length) return window.i18n.t('no_video_formats_detected');
  return heights.map((h) => `${h}p`).join(' · ');
}

function renderVideoInfoSingle(info, url) {
  videoInfoContext = { type: 'video', url, info };

  videoInfoPlaylistSectionEl.classList.add('hidden');
  videoInfoFormatsSectionEl.classList.remove('hidden');
  videoInfoDescriptionSectionEl.classList.remove('hidden');

  const thumbUrl = pickThumbnailUrl(info);
  if (thumbUrl) {
    videoInfoThumbEl.src = thumbUrl;
    videoInfoThumbEl.classList.remove('hidden');
  } else {
    videoInfoThumbEl.removeAttribute('src');
    videoInfoThumbEl.classList.add('hidden');
  }

  videoInfoTitleEl.textContent = info.title || window.i18n.t('no_title');

  const uploader = info.uploader || info.channel || '';
  const uploaderUrl = info.uploader_url || info.channel_url || '';
  videoInfoUploaderEl.innerHTML = '';
  if (uploader && uploaderUrl) {
    const a = document.createElement('a');
    a.href = uploaderUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = uploader;
    videoInfoUploaderEl.appendChild(a);
  } else if (uploader) {
    videoInfoUploaderEl.textContent = uploader;
  }
  videoInfoUploaderEl.classList.toggle('hidden', !uploader);

  videoInfoSiteEl.textContent = info.extractor_key || '';
  videoInfoSiteEl.classList.toggle('hidden', !info.extractor_key);

  videoInfoStatsEl.innerHTML = '';
  renderStatsPills(videoInfoStatsEl, info);

  videoInfoFormatsEl.textContent = buildResolutionsSummary(info);

  const description = (info.description || '').trim();
  videoInfoDescriptionEl.textContent = description || window.i18n.t('no_description');

  const link = info.webpage_url || url;
  videoInfoLinkEl.textContent = link;
  videoInfoLinkEl.href = link;

  videoInfoDownloadBtn.textContent = window.i18n.t('btn_download_this_video');
  setVideoInfoStatus('');
}

function renderVideoInfoPlaylist(result, url) {
  videoInfoContext = { type: 'playlist', url, result };

  videoInfoFormatsSectionEl.classList.add('hidden');
  videoInfoDescriptionSectionEl.classList.add('hidden');
  videoInfoPlaylistSectionEl.classList.remove('hidden');

  videoInfoThumbEl.classList.add('hidden');
  videoInfoThumbEl.removeAttribute('src');

  videoInfoTitleEl.textContent = result.title || window.i18n.t('playlist_default_title');
  videoInfoUploaderEl.classList.add('hidden');
  videoInfoSiteEl.classList.add('hidden');

  videoInfoStatsEl.innerHTML = '';
  addVideoInfoStat(videoInfoStatsEl, 'Videos', String(result.entries.length));

  videoInfoPlaylistListEl.innerHTML = '';
  const entries = result.entries || [];
  entries.slice(0, 50).forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'video-info-playlist-row';
    row.innerHTML = `
      <img class="video-info-playlist-thumb" src="${escapeHtml(entry.thumbnail || '')}" alt="" onerror="this.style.visibility='hidden'" />
      <span class="video-info-playlist-title">${escapeHtml(entry.title)}</span>
      <span class="video-info-playlist-duration">${entry.duration ? formatDuration(entry.duration) : ''}</span>
    `;
    videoInfoPlaylistListEl.appendChild(row);
  });
  if (entries.length > 50) {
    const more = document.createElement('div');
    more.className = 'video-info-playlist-row video-info-playlist-more';
    more.textContent = window.i18n.t('and_n_more', { n: entries.length - 50 });
    videoInfoPlaylistListEl.appendChild(more);
  }

  videoInfoLinkEl.textContent = url;
  videoInfoLinkEl.href = url;

  videoInfoDownloadBtn.textContent = window.i18n.t('view_video_list');
  setVideoInfoStatus('');
}

function setVideoInfoStatus(text, type = '') {
  videoInfoStatusEl.textContent = text;
  videoInfoStatusEl.className = 'settings-hint video-info-status' + (type ? ' ' + type : '');
}

function openVideoInfoPanel() {
  closeAllOverlayPanels();
  videoInfoOverlay.classList.remove('hidden');
}

function closeVideoInfoPanel() {
  videoInfoOverlay.classList.add('hidden');
}

videoInfoCloseBtn.addEventListener('click', closeVideoInfoPanel);
videoInfoOverlay.addEventListener('click', (e) => {
  if (e.target === videoInfoOverlay) closeVideoInfoPanel();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !videoInfoOverlay.classList.contains('hidden')) {
    closeVideoInfoPanel();
  }
});

// "Descargar este video" / "Ver lista de videos": reutiliza lo ya consultado,
// sin volver a llamar a yt-dlp, y salta directo a la pantalla correspondiente.
videoInfoDownloadBtn.addEventListener('click', () => {
  if (!videoInfoContext) return;
  closeVideoInfoPanel();

  if (videoInfoContext.type === 'playlist') {
    renderPlaylist(videoInfoContext.result);
    goToPlaylistScreen();
    return;
  }

  currentUrl = videoInfoContext.url;
  currentVideoInfo = videoInfoContext.info;
  renderVideoMeta(videoInfoContext.info);
  buildDownloadOptions(videoInfoContext.info);
  renderDownloadList();
  setStatus('', '', 'picker');
  goToPickerScreen();
});

function buildVideoInfoText(ctx) {
  if (ctx.type === 'playlist') {
    const r = ctx.result;
    return [`Playlist: ${r.title || ''}`, `Videos: ${(r.entries || []).length}`, `Enlace: ${ctx.url}`].join('\n');
  }

  const info = ctx.info;
  const lines = [];
  lines.push(`${window.i18n.t('copy_info_title')}: ${info.title || ''}`);
  const uploader = info.uploader || info.channel || '';
  if (uploader) lines.push(`${window.i18n.t('copy_info_channel')}: ${uploader}`);
  if (info.extractor_key) lines.push(`${window.i18n.t('copy_info_site')}: ${info.extractor_key}`);
  const duration = formatDuration(info.duration);
  if (duration) lines.push(`${window.i18n.t('stat_duration')}: ${duration}`);
  const views = formatCount(info.view_count);
  if (views) lines.push(`${window.i18n.t('stat_views')}: ${views}`);
  const likes = formatCount(info.like_count);
  if (likes) lines.push(`${window.i18n.t('stat_likes')}: ${likes}`);
  const uploadDate = formatUploadDate(info.upload_date);
  if (uploadDate) lines.push(`${window.i18n.t('stat_published')}: ${uploadDate}`);
  lines.push(`${window.i18n.t('copy_info_resolutions')}: ${buildResolutionsSummary(info)}`);
  lines.push(`${window.i18n.t('copy_info_link')}: ${info.webpage_url || ctx.url}`);
  const description = (info.description || '').trim();
  if (description) lines.push('', `${window.i18n.t('copy_info_description')}:`, description);
  return lines.join('\n');
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Alternativa por si el portapapeles moderno no está disponible
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!ok) throw new Error('No se pudo copiar');
}

videoInfoCopyBtn.addEventListener('click', async () => {
  if (!videoInfoContext) return;
  try {
    await copyTextToClipboard(buildVideoInfoText(videoInfoContext));
    setVideoInfoStatus('Información copiada al portapapeles.', 'success');
  } catch (err) {
    setVideoInfoStatus('No se pudo copiar: ' + err.message, 'error');
  }
});

// ---- Estimación de tamaño de archivo ----
// Muchos formatos (sobre todo en YouTube) no traen "filesize" ni "filesize_approx"
// en el JSON de metadatos. Cuando falta, lo estimamos nosotros mismos a partir del
// bitrate (tbr/vbr/abr, en kbps) y la duración del video — el mismo cálculo que
// hace yt-dlp internamente para su propio "filesize_approx".
function estimateSizeBytes(format, durationSeconds) {
  if (!format) return null;
  if (format.filesize) return { bytes: format.filesize, approx: false };
  if (format.filesize_approx) return { bytes: format.filesize_approx, approx: true };
  const bitrateKbps = format.tbr || format.vbr || format.abr;
  if (bitrateKbps && durationSeconds) {
    const bytes = ((bitrateKbps * 1000) / 8) * durationSeconds;
    return { bytes, approx: true };
  }
  return null;
}

// Combina dos estimaciones (ej. pista de video + pista de audio) en una sola
function combineSizeEstimates(...sizes) {
  const valid = sizes.filter(Boolean);
  if (!valid.length) return null;
  const bytes = valid.reduce((sum, s) => sum + s.bytes, 0);
  const approx = valid.some((s) => s.approx);
  return { bytes, approx };
}

function formatSizeLabel(sizeInfo) {
  if (!sizeInfo || !sizeInfo.bytes) return '~? MB';
  const mb = sizeInfo.bytes / (1024 * 1024);
  const label = mb >= 1000 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
  return sizeInfo.approx ? `~${label}` : label;
}

// La mejor pista de solo-audio disponible (la que yt-dlp usaría con "bestaudio")
function pickBestAudioFormat(info) {
  const audioFormats = (info.formats || []).filter(
    (f) => (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none'
  );
  if (!audioFormats.length) return null;
  return audioFormats.reduce((best, f) => {
    const score = f.abr || f.tbr || 0;
    const bestScore = best ? best.abr || best.tbr || 0 : -1;
    return score > bestScore ? f : best;
  }, null);
}

function buildDownloadOptions(info) {
  formatItems = [];
  presetItems = [];
  selectedIndex = 0;

  const bestAudioFormat = pickBestAudioFormat(info);
  const bestAudioSize = estimateSizeBytes(bestAudioFormat, info.duration);

  // ---- Formatos detectados del video, de mayor a menor resolución (primero) ----
  // Puede haber varias variantes con la misma altura (distinto bitrate/codec).
  // Preferimos la que trae "filesize"/"filesize_approx" real del sitio (peso
  // mostrado confiable) sobre una que solo declare "tbr" (bitrate objetivo que
  // YouTube suele reportar inflado, dando estimaciones de peso muy alejadas del
  // archivo real). Si ninguna variante de esa altura trae tamaño real, se usa
  // la de mayor tbr/vbr como antes (mejor calidad real disponible, aunque el
  // peso mostrado siga siendo una aproximación).
  const videoFormats = (info.formats || [])
    .filter((f) => f.vcodec !== 'none' && f.height)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  const bestByHeight = new Map();
  for (const f of videoFormats) {
    const hasRealSize = !!(f.filesize || f.filesize_approx);
    const qualityScore = f.tbr || f.vbr || (f.filesize || f.filesize_approx || 0) / 1000;
    const current = bestByHeight.get(f.height);
    const isBetter =
      !current ||
      (hasRealSize && !current.hasRealSize) ||
      (hasRealSize === current.hasRealSize && qualityScore > current.qualityScore);
    if (isBetter) {
      bestByHeight.set(f.height, { format: f, hasRealSize, qualityScore });
    }
  }

  const bestFormats = [...bestByHeight.values()]
    .map((v) => v.format)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  // El de mayor resolución/bitrate real que ya detectamos arriba
  const topFormat = bestFormats[0] || null;

  // ---- Opción predefinida "Mejor video y audio disponible" al inicio ----
  // Usamos el format_id exacto del mejor video detectado (mismo que la opción
  // de resolución más alta de la lista) en vez de dejar que yt-dlp adivine con
  // "bv*+ba/b": en sitios como BiliBili el bitrate real no siempre viene bien
  // etiquetado y yt-dlp puede terminar eligiendo una variante de menor calidad
  // aunque tenga la misma resolución.
  const topSize = combineSizeEstimates(estimateSizeBytes(topFormat, info.duration), bestAudioSize);
  formatItems.push({
    res: window.i18n.t('best_video_audio'),
    ext: 'mp4',
    size: formatSizeLabel(topSize),
    formatId: topFormat ? `${topFormat.format_id}+bestaudio/best` : 'bestvideo+bestaudio/best',
    audioOnly: false,
    isPreset: true, // marcar como preset para styling especial
    isBest: true, // opción incorporada (no un preset real del usuario) — no muestra el tag "preset"
  });

  // ---- Opción predefinida "Mejor audio disponible (MP3)", justo debajo de la anterior ----
  const approxBestAudioSize = bestAudioSize ? { ...bestAudioSize, approx: true } : null;
  formatItems.push({
    res: window.i18n.t('best_audio'),
    ext: 'mp3',
    size: formatSizeLabel(approxBestAudioSize),
    formatId: null,
    audioOnly: true,
    audioFormat: 'mp3',
    isPreset: true,
    isBest: true,
  });

  for (const f of bestFormats) {
    // Tamaño real (video + el mejor audio con el que se fusiona al descargar).
    // Cuando el sitio no reporta "filesize"/"filesize_approx" para alguna de las
    // dos pistas, la estimamos nosotros a partir del bitrate (ver estimateSizeBytes).
    const sizeInfo = combineSizeEstimates(estimateSizeBytes(f, info.duration), bestAudioSize);
    const sizeLabel = formatSizeLabel(sizeInfo);

    formatItems.push({
      res: `${f.height}p`,
      // Contenedor de salida por defecto: siempre MP4, sin importar el que
      // reporte la fuente para ese stream (YouTube suele entregar webm en
      // varias resoluciones); el usuario lo puede cambiar con el select.
      ext: 'mp4',
      size: sizeLabel,
      formatId: f.format_id,
      audioOnly: false,
    });
  }

  // ---- Opciones de solo-audio: mismo audio fuente, distintos niveles de calidad ----
  // (bitrate objetivo al que se re-codifica el audio; el formato de salida
  // sigue siendo elegible con el select de la columna "Formato", por defecto MP3).
  const audioQualityOptions = [
    { res: window.i18n.t('audio_quality_high'), bitrateKbps: 192 },
    { res: window.i18n.t('audio_quality_medium'), bitrateKbps: 128 },
    { res: window.i18n.t('audio_quality_low'), bitrateKbps: 64 },
  ];
  for (const aq of audioQualityOptions) {
    // Tamaño estimado a partir del bitrate objetivo de cada nivel (no del
    // bitrate original de la pista fuente), siempre aproximado.
    const estBytes = info.duration ? ((aq.bitrateKbps * 1000) / 8) * info.duration : null;
    const sizeInfo = estBytes ? { bytes: estBytes, approx: true } : null;
    formatItems.push({
      res: aq.res,
      ext: 'mp3',
      size: formatSizeLabel(sizeInfo),
      formatId: null,
      audioOnly: true,
      audioFormat: 'mp3',
      audioBitrateKbps: aq.bitrateKbps,
    });
  }

  // ---- Preajustes guardados que coinciden con el sitio del video actual ----
  // (o preajustes "universales" sin sitio especificado / marcados como "Todos")
  presetItems = computePresetItemsForCurrentSite(info);

  recomputeVisibleOptions();
  populatePresetDropdown();
}

// Filtra los preajustes guardados por el usuario según el sitio del video
// (o "universales"), devolviendo el mismo formato que usa formatItems.
// Reutilizable para refrescar la lista cuando se añade/edita/elimina un preajuste.
// Analiza el string de opciones de yt-dlp de un preset guardado (texto libre)
// y arma un resumen corto legible, ej. "1080p · mp4 · sub incluidos".
// Es heurístico: si no reconoce nada, devuelve null y se usa el tag "preset" como antes.
function parsePresetOptionsSummary(optionsStr) {
  if (!optionsStr) return null;
  const parts = [];

  const isAudioOnly = /(^|\s)-x(\s|$)|--extract-audio/i.test(optionsStr);

  if (isAudioOnly) {
    const audioFmt = optionsStr.match(/--audio-format[= ]\s*(\w+)/i);
    parts.push(audioFmt ? audioFmt[1].toLowerCase() : 'audio');
  } else {
    const heightMatch = optionsStr.match(/height\s*[<>]=?\s*(\d{3,4})/i);
    if (heightMatch) parts.push(`${heightMatch[1]}p`);

    const containerMatch =
      optionsStr.match(/--merge-output-format[= ]\s*(\w+)/i) ||
      optionsStr.match(/--recode-video[= ]\s*(\w+)/i) ||
      optionsStr.match(/--remux-video[= ]\s*(\w+)/i) ||
      optionsStr.match(/\b(mp4|mkv|webm|mov)\b/i);
    if (containerMatch) parts.push(containerMatch[1].toLowerCase());
  }

  if (/--write-subs|--write-auto-subs|--all-subs/i.test(optionsStr)) parts.push('sub incluidos');

  return parts.length ? parts.join(' · ') : null;
}

// Estima el tamaño de un preset guardado a partir de la resolución/tipo que
// detectamos en su string de opciones, reutilizando las mismas estimaciones
// (por bitrate) que ya usamos para los formatos detectados.
function estimatePresetSizeLabel(optionsStr, videoFormats, bestAudioSize, duration) {
  if (!optionsStr) return null;
  const isAudioOnly = /(^|\s)-x(\s|$)|--extract-audio/i.test(optionsStr);
  if (isAudioOnly) {
    return bestAudioSize ? formatSizeLabel(bestAudioSize) : null;
  }
  if (!videoFormats.length) return null;

  let targetFormat;
  const heightMatch = optionsStr.match(/height\s*[<>]=?\s*(\d{3,4})/i);
  if (heightMatch) {
    const targetHeight = parseInt(heightMatch[1], 10);
    targetFormat = videoFormats.find((f) => f.height <= targetHeight) || videoFormats[videoFormats.length - 1];
  } else {
    targetFormat = videoFormats[0]; // sin altura especificada: asumimos la mejor calidad
  }
  if (!targetFormat) return null;

  const sizeInfo = combineSizeEstimates(estimateSizeBytes(targetFormat, duration), bestAudioSize);
  return formatSizeLabel(sizeInfo);
}

function computePresetItemsForCurrentSite(info) {
  const currentSite = ((info && info.extractor_key) || '').trim().toLowerCase();

  const bestAudioFormat = pickBestAudioFormat(info || {});
  const bestAudioSize = estimateSizeBytes(bestAudioFormat, info && info.duration);
  const videoFormats = ((info && info.formats) || [])
    .filter((f) => f.vcodec !== 'none' && f.height)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  return presets
    .filter((p) => {
      const site = (p.site || '').trim().toLowerCase();
      return !site || site === currentSite || site === 'todos' || site === 'all';
    })
    .map((p) => ({
      res: p.name,
      presetOptions: p.options,
      isPreset: true,
      isBest: false,
      summary: parsePresetOptionsSummary(p.options),
      size: estimatePresetSizeLabel(p.options, videoFormats, bestAudioSize, info && info.duration),
    }));
}

// ========== DROPDOWN DE PREAJUSTES EN DOWNLOAD FRAME ==========

function populatePresetDropdown() {
  presetDropdownList.innerHTML = '';
  selectedPresetForDownload = null;
  
  if (!presets || presets.length === 0) {
    const emptyItem = document.createElement('div');
    emptyItem.className = 'preset-dropdown-item';
    emptyItem.textContent = window.i18n.t('no_saved_presets');
    emptyItem.style.cursor = 'default';
    presetDropdownList.appendChild(emptyItem);
    return;
  }
  
  // Filtrar preajustes por sitio del video actual
  const currentSite = (currentVideoInfo?.extractor_key || '').trim().toLowerCase();
  const applicablePresets = presets.filter((p) => {
    const site = (p.site || '').trim().toLowerCase();
    return !site || site === currentSite || site === 'todos' || site === 'all';
  });
  
  if (applicablePresets.length === 0) {
    const emptyItem = document.createElement('div');
    emptyItem.className = 'preset-dropdown-item';
    emptyItem.textContent = window.i18n.t('no_presets_for_site');
    emptyItem.style.cursor = 'default';
    presetDropdownList.appendChild(emptyItem);
    return;
  }
  
  applicablePresets.forEach((preset, index) => {
    const item = document.createElement('div');
    item.className = 'preset-dropdown-item';
    
    const name = document.createElement('span');
    name.className = 'preset-dropdown-item-name';
    name.textContent = preset.name;
    
    const site = document.createElement('span');
    site.className = 'preset-dropdown-item-site';
    site.textContent = preset.site || window.i18n.t('preset_all_sites');
    
    item.appendChild(name);
    item.appendChild(site);
    
    item.addEventListener('click', () => {
      selectPresetForDownload(preset, applicablePresets, index);
      presetDropdownMenu.classList.add('hidden');
      presetMenuBtn.classList.remove('active');
    });
    
    presetDropdownList.appendChild(item);
  });
}

function selectPresetForDownload(preset, applicablePresets, index) {
  selectedPresetForDownload = preset;
  
  // Actualizar botón
  presetMenuBtn.textContent = `⚙ ${preset.name.substring(0, 18)}`;
  
  // Actualizar visual del dropdown
  document.querySelectorAll('.preset-dropdown-item').forEach((item, i) => {
    item.classList.toggle('active', i === index);
  });
}

// Event listeners del dropdown
presetMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isHidden = presetDropdownMenu.classList.contains('hidden');
  presetDropdownMenu.classList.toggle('hidden');
  presetMenuBtn.classList.toggle('active', isHidden);
});

// Cerrar dropdown si hacen click afuera
document.addEventListener('click', (e) => {
  if (!presetMenuBtn.contains(e.target) && !presetDropdownMenu.contains(e.target)) {
    presetDropdownMenu.classList.add('hidden');
    presetMenuBtn.classList.remove('active');
  }
});

function renderDownloadList() {
  downloadListEl.innerHTML = '';

  // Envolvemos todo el contenido en un wrapper interno alineado a la
  // izquierda. El contenedor externo (.download-list) centra ESTE wrapper
  // como un solo bloque; si en cambio centráramos cada fila por separado
  // (como antes), filas con distinto ancho total (por el texto de "Peso",
  // que varía en longitud: "~585.7 MB" vs "~9.0 MB" vs "1.9 MB") quedarían
  // centradas en puntos distintos y sus columnas no alinearían entre sí.
  downloadListInner = document.createElement('div');
  downloadListInner.className = 'download-list-inner';
  downloadListEl.appendChild(downloadListInner);

  // ---- Categoría "Preajuste": los 2 incorporados + los preajustes guardados por el usuario ----
  const presetDivider = document.createElement('div');
  presetDivider.className = 'download-divider glitch-text';
  presetDivider.textContent = window.i18n.t('preset_divider');
  presetDivider.dataset.text = window.i18n.t('preset_divider');
  downloadListInner.appendChild(presetDivider);

  formatItems.forEach((opt, i) => {
    if (opt.isPreset && opt.isBest) appendOptionRow(opt, i);
  });

  presetItems.forEach((opt, j) => {
    appendOptionRow(opt, formatItems.length + j);
  });

  // ---- Categoría "Formatos detectados": resoluciones de video + audio ----
  const formatsDivider = document.createElement('div');
  formatsDivider.className = 'download-divider download-divider-section glitch-text';
  formatsDivider.textContent = window.i18n.t('formats_detected');
  formatsDivider.dataset.text = window.i18n.t('formats_detected');
  downloadListInner.appendChild(formatsDivider);

  const header = document.createElement('div');
  header.className = 'download-columns-header';
  header.innerHTML = `
    <span class="col-res">${window.i18n.t('col_quality')}</span>
    <span class="col-ext">${window.i18n.t('col_format')}</span>
    <span class="col-size">${window.i18n.t('col_size')}</span>
  `;
  downloadListInner.appendChild(header);

  formatItems.forEach((opt, i) => {
    if (!opt.isPreset) appendOptionRow(opt, i);
  });
}

// Devuelve un badge corto ("4K"/"HD"/"SD") según la altura de la resolución
// detectada en opt.res (ej. "2160p" -> "4K"). Para audio no aplica.
function getQualityBadge(opt) {
  if (opt.audioOnly) return 'AUD';
  const match = /(\d+)p/.exec(opt.res);
  if (!match) return null;
  const height = parseInt(match[1], 10);
  if (height >= 2160) return '4K';
  if (height >= 1080) return 'HD';
  return 'SD';
}

function appendOptionRow(opt, i) {
  const row = document.createElement('div');
  row.className =
    'download-item' + (opt.isPreset ? ' preset-item' : '') + (i === selectedIndex ? ' selected' : '');

  if (opt.isPreset) {
    const showSummary = !opt.isBest && opt.summary;
    // Los dos preajustes incorporados ("Mejor video y audio" / "Mejor audio")
    // también permiten elegir formato de salida, igual que las filas normales.
    const formatOptions = opt.audioOnly ? AUDIO_FORMATS : CONTAINER_FORMATS;
    const formatSelectHtml = opt.isBest
      ? `<select class="ext-select preset-ext-select" data-idx="${i}" title="${window.i18n.t('output_format_tooltip')}">
          ${formatOptions.map((fmt) => `<option value="${fmt}" ${opt.ext === fmt ? 'selected' : ''}>${fmt.toUpperCase()}</option>`).join('')}
        </select>`
      : '';
    row.innerHTML = `
      <span class="arrow">${i === selectedIndex ? '&gt;' : ''}</span>
      <span class="arrow">★</span>
      <span class="res">${opt.res}</span>
      ${showSummary ? `<span class="preset-summary">${opt.summary}</span>` : ''}
      ${!opt.isBest && !showSummary ? '<span class="tag">preset</span>' : ''}
      ${formatSelectHtml}
      ${!opt.isBest && opt.size ? `<span class="size">${opt.size}</span>` : ''}
    `;
  } else {
    const icon = opt.audioOnly ? '♪' : '▸';
    const badge = getQualityBadge(opt);
    // Solo las filas de video (no audio, no preset) permiten elegir el contenedor
    // de salida (mp4/mkv/webm/mov); el audio ya tiene sus propias filas por formato.
    // Las filas de audio también permiten elegir formato de salida (mp3/m4a/opus);
    // las de video, el contenedor (mp4/mkv/webm/mov).
    const formatOptions = opt.audioOnly ? AUDIO_FORMATS : CONTAINER_FORMATS;
    const extCell = `<select class="ext-select" data-idx="${i}" title="${window.i18n.t('output_format_tooltip')}">
          ${formatOptions.map((fmt) => `<option value="${fmt}" ${opt.ext === fmt ? 'selected' : ''}>${fmt.toUpperCase()}</option>`).join('')}
        </select>`;
    row.innerHTML = `
      <span class="arrow" data-text="${i === selectedIndex ? '>' : ''}">${i === selectedIndex ? '&gt;' : ''}</span>
      <span class="arrow" data-text="${icon}">${icon}</span>
      ${badge ? `<span class="quality-badge quality-badge-${badge.toLowerCase()}" data-text="${badge}">${badge}</span>` : '<span class="quality-badge-spacer"></span>'}
      <span class="res" data-text="${opt.res}">${opt.res}</span>
      ${extCell}
      <span class="size" data-text="${opt.size}">${opt.size}</span>
    `;
  }

  row.addEventListener('click', () => {
    selectedIndex = i;
    renderDownloadList();
  });

  const extSelect = row.querySelector('.ext-select');
  if (extSelect) {
    // Evitar que abrir/usar el select dispare el click de la fila (que la re-renderiza
    // y cierra el desplegable antes de que el usuario pueda elegir una opción).
    extSelect.addEventListener('click', (e) => e.stopPropagation());
    extSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      opt.ext = e.target.value;
      // Para el preajuste de audio, el valor elegido también define el
      // formato de extracción real que se manda a yt-dlp (--audio-format).
      if (opt.audioOnly) opt.audioFormat = e.target.value;
      selectedIndex = i;
      renderDownloadList();
    });
  }

  downloadListInner.appendChild(row);
}

// Dispara la descarga de la opción actualmente seleccionada (fila resaltada),
// o del preajuste elegido en el dropdown "⚙ Preajuste" si hay uno activo.
// Se llama al hacer click en el botón "Descargar" o al presionar Enter.
function triggerDownload() {
  if (downloadOptions.length === 0) return;

  if (selectedPresetForDownload) {
    const presetOpt = {
      res: selectedPresetForDownload.name,
      presetOptions: selectedPresetForDownload.options,
      isPreset: true,
      isBest: false,
    };
    startDownload(presetOpt);
    return;
  }

  const opt = downloadOptions[selectedIndex];
  if (opt) startDownload(opt);
}

pickerDownloadBtn.addEventListener('click', () => {
  triggerDownload();
});

// ================= PLAYLIST =================
let playlistEntries = []; // [{ id, title, url, duration, thumbnail, selected, statusEl }]

function renderPlaylist(result) {
  playlistEntries = (result.entries || []).map((e) => ({ ...e, selected: true }));
  playlistTitleEl.textContent = result.title || window.i18n.t('playlist_default_title');
  playlistCountEl.textContent = `${playlistEntries.length} video${playlistEntries.length === 1 ? '' : 's'}`;
  playlistSelectAllEl.checked = true;
  statusPlaylistEl.textContent = '';
  statusPlaylistEl.className = 'status';
  renderPlaylistList();

  // Cada playlist nueva vuelve a la carpeta predeterminada y a crear su propia subcarpeta
  playlistCustomPath = '';
  playlistCreateFolderCheckbox.checked = true;
  refreshPlaylistPathDisplay();
}

// Muestra en el campo de solo lectura la ruta elegida, o la predeterminada
// (la de Configuración de Descarga) si el usuario no eligió ninguna para esta playlist.
async function refreshPlaylistPathDisplay() {
  if (playlistCustomPath) {
    playlistDownloadPathInput.value = playlistCustomPath;
    return;
  }
  try {
    const settings = await window.yoinksAPI.getSettings();
    playlistDownloadPathInput.value = (settings && settings.downloadPath) || '';
  } catch (e) {
    playlistDownloadPathInput.value = '';
  }
}

playlistPathBrowseBtn.addEventListener('click', async () => {
  const folder = await window.yoinksAPI.selectDownloadFolder();
  if (folder) {
    playlistCustomPath = folder;
    playlistDownloadPathInput.value = folder;
  }
});

function renderPlaylistList() {
  playlistListEl.innerHTML = '';

  playlistEntries.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'playlist-item';
    row.innerHTML = `
      <input type="checkbox" class="playlist-item-check" data-index="${i}" ${entry.selected ? 'checked' : ''} />
      <img class="playlist-item-thumb" src="${entry.thumbnail || ''}" alt="" onerror="this.style.visibility='hidden'" />
      <span class="playlist-item-title">${entry.title}</span>
      <span class="playlist-item-duration">${entry.duration ? formatDuration(entry.duration) : ''}</span>
      <span class="playlist-item-status" id="playlist-status-${i}"></span>
    `;
    const checkbox = row.querySelector('.playlist-item-check');
    checkbox.addEventListener('change', (e) => {
      entry.selected = e.target.checked;
      updateSelectAllCheckbox();
    });
    // Clic en cualquier parte de la fila alterna la selección; si el clic fue
    // directo sobre el checkbox, dejamos que él mismo lo maneje (evita doble toggle).
    row.addEventListener('click', (e) => {
      if (e.target === checkbox) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    });
    playlistListEl.appendChild(row);
  });
}

function updateSelectAllCheckbox() {
  playlistSelectAllEl.checked = playlistEntries.length > 0 && playlistEntries.every((e) => e.selected);
}

playlistSelectAllEl.addEventListener('change', (e) => {
  playlistEntries.forEach((entry) => (entry.selected = e.target.checked));
  renderPlaylistList();
});

playlistReverseBtn.addEventListener('click', () => {
  playlistEntries.reverse();
  renderPlaylistList();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && screenPlaylist.classList.contains('active')) {
    goToHomeScreen();
  }
});

// ---- Mapea la calidad elegida a lo que espera el handler de descarga (formatId / audioOnly) ----
function playlistQualityToDownloadParams(quality) {
  if (quality === 'audio') return { audioOnly: true, audioFormat: 'mp3' };
  if (quality.startsWith('audio-')) return { audioOnly: true, audioFormat: quality.slice('audio-'.length) };
  if (quality === 'best') return { formatId: 'bestvideo+bestaudio/best' };
  return {
    formatId: `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`,
  };
}

function setPlaylistItemStatus(i, text, cls) {
  const el = document.getElementById(`playlist-status-${i}`);
  if (el) {
    el.textContent = text;
    el.className = 'playlist-item-status' + (cls ? ' ' + cls : '');
  }
}

playlistDownloadBtn.addEventListener('click', async () => {
  const selected = playlistEntries
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.selected);

  if (selected.length === 0) {
    statusPlaylistEl.textContent = window.i18n.t('select_at_least_one_video');
    statusPlaylistEl.className = 'status error';
    return;
  }

  playlistDownloadBtn.disabled = true;
  const quality = playlistQualitySelect.value;
  const params = playlistQualityToDownloadParams(quality);
  const qualityLabel = playlistQualitySelect.options[playlistQualitySelect.selectedIndex].textContent;
  const outputDir = playlistCustomPath || playlistDownloadPathInput.value || undefined;
  const subfolder = playlistCreateFolderCheckbox.checked ? playlistTitleEl.textContent : '';

  // Cuántos videos se descargan a la vez, según Configuración de Descarga (por defecto 1 = secuencial)
  let concurrency = 1;
  try {
    const settings = await window.yoinksAPI.getSettings();
    concurrency = Math.max(1, Math.min(5, parseInt(settings.concurrentDownloads, 10) || 1));
  } catch (e) {
    concurrency = 1;
  }
  concurrency = Math.min(concurrency, selected.length);

  let ok = 0;
  let failed = 0;
  let completed = 0;
  const total = selected.length;

  // Registrar cada video seleccionado como "en cola" en el panel de descargas
  const downloadIds = selected.map(({ entry }) => {
    const payload = {
      url: entry.url,
      formatId: params.formatId,
      audioOnly: params.audioOnly || false,
      audioFormat: params.audioFormat,
      title: entry.title,
      site: 'Youtube',
      label: entry.title,
      videoInfo: null,
      thumbnail: entry.thumbnail || null,
      outputDir,
      subfolder,
    };
    return queueActiveDownload(entry.title, qualityLabel, payload, entry.thumbnail);
  });

  function updateStatusLine() {
    const suffix = concurrency > 1 ? window.i18n.t('at_a_time_suffix', { n: concurrency }) : '';
    statusPlaylistEl.textContent = window.i18n.t('downloading_progress', { completed, total, suffix });
    statusPlaylistEl.className = 'status';
  }
  updateStatusLine();

  // Pool de workers: cada uno toma el siguiente video pendiente de la cola compartida
  // hasta agotarla, de forma que nunca haya más de "concurrency" descargas a la vez.
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < selected.length) {
      const idx = nextIndex++;
      const { entry, i } = selected[idx];
      const downloadId = downloadIds[idx];

      // Si el usuario canceló este video mientras esperaba su turno en la cola, se salta.
      if (canceledBeforeStart.has(downloadId)) {
        canceledBeforeStart.delete(downloadId);
        setPlaylistItemStatus(i, window.i18n.t('playlist_item_cancelled'), 'error');
        completed++;
        updateStatusLine();
        continue;
      }

      // Si el usuario lo pausó mientras esperaba su turno en la cola, se salta sin
      // arrancarlo: queda "pausado" (ya reflejado en la UI) hasta que se reanude a mano.
      if (pausedBeforeStart.has(downloadId)) {
        pausedBeforeStart.delete(downloadId);
        setPlaylistItemStatus(i, window.i18n.t('playlist_item_paused'), 'paused');
        continue;
      }

      setPlaylistItemStatus(i, window.i18n.t('playlist_item_downloading'), 'downloading');
      setActiveDownloadStatus(downloadId, 'downloading');
      try {
        const result = await window.yoinksAPI.download({
          url: entry.url,
          formatId: params.formatId,
          audioOnly: params.audioOnly || false,
          audioFormat: params.audioFormat,
          title: entry.title,
          site: 'Youtube',
          label: entry.title,
          videoInfo: null,
          thumbnail: entry.thumbnail || null,
          outputDir,
          subfolder,
          downloadId,
        });
        if (result && result.paused) {
          // Se quedó pausado a mitad de la descarga: no cuenta como completado todavía,
          // el usuario lo reanuda desde el panel de Actividad.
          setPlaylistItemStatus(i, window.i18n.t('playlist_item_paused'), 'paused');
          setActiveDownloadStatus(downloadId, 'paused');
        } else if (result && result.canceled) {
          setPlaylistItemStatus(i, window.i18n.t('playlist_item_cancelled'), 'error');
          removeActiveDownload(downloadId);
          completed++;
        } else {
          setPlaylistItemStatus(i, window.i18n.t('playlist_item_done'), 'done');
          finishActiveDownload(downloadId, 'done');
          ok++;
          completed++;
        }
      } catch (err) {
        setPlaylistItemStatus(i, 'error', 'error');
        finishActiveDownload(downloadId, 'error');
        failed++;
        completed++;
      }
      updateStatusLine();
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  statusPlaylistEl.textContent =
    failed === 0
      ? window.i18n.t('playlist_finished_ok', { ok, s: ok === 1 ? '' : 's' })
      : window.i18n.t('playlist_finished_errors', { ok, failed });
  statusPlaylistEl.className = failed === 0 ? 'status success' : 'status error';
  playlistDownloadBtn.disabled = false;
});


// ---- Navegación por teclado dentro de la lista (foco en download-list) ----
downloadListEl.addEventListener('keydown', (e) => {
  if (downloadOptions.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex = (selectedIndex + 1) % downloadOptions.length;
    renderDownloadList();
    scrollSelectedIntoView();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex = (selectedIndex - 1 + downloadOptions.length) % downloadOptions.length;
    renderDownloadList();
    scrollSelectedIntoView();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    triggerDownload();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    goToHomeScreen();
  }
});

function scrollSelectedIntoView() {
  const selected = downloadListEl.querySelector('.download-item.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

// Esc también funciona con foco en el input
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    clearResults();
  }
});

async function startDownload(opt) {
  const label = opt.isPreset ? opt.res : `${opt.res}`;
  setStatus(window.i18n.t('downloading_label_pct', { label, pct: 0 }), '', 'picker');

  const payload = {
    url: currentUrl,
    formatId: opt.formatId,
    audioOnly: opt.audioOnly,
    audioFormat: opt.audioFormat,
    // Bitrate objetivo (kbps) del nivel de calidad elegido (Alta/Media/Baja)
    // para las filas de solo-audio; el preajuste "Mejor audio" no define uno
    // (usa la mejor calidad disponible por defecto en main.js).
    audioBitrateKbps: opt.audioOnly ? opt.audioBitrateKbps : undefined,
    // Contenedor de salida elegido en la columna "Formato" (mp4/mkv/webm/mov).
    // Aplica a filas de video normales y al preajuste "Mejor video y audio
    // disponible" (también editable); se ignora para audio y presets custom.
    mergeFormat: !opt.audioOnly && (!opt.isPreset || opt.isBest) ? opt.ext : undefined,
    presetOptions: opt.presetOptions,
    title: currentVideoInfo ? currentVideoInfo.title : '',
    site: currentVideoInfo ? currentVideoInfo.extractor_key : '',
    label,
    videoInfo: currentVideoInfo, // Pasar todos los metadatos del video
    thumbnail: currentVideoInfo ? pickThumbnailUrl(currentVideoInfo) : null,
  };

  const downloadId = queueActiveDownload(
    currentVideoInfo ? currentVideoInfo.title : label,
    label,
    payload,
    payload.thumbnail
  );
  setActiveDownloadStatus(downloadId, 'downloading');
  // Esta descarga pasa a ser la dueña del mensaje de estado del picker.
  currentPickerStatusOwner = downloadId;

  progressCallbacks.set(downloadId, (percent) => {
    if (currentPickerStatusOwner !== downloadId) return; // ya no es la descarga visible
    setStatus(window.i18n.t('downloading_label_pct', { label, pct: percent.toFixed(0) }), '', 'picker');
  });

  try {
    const result = await window.yoinksAPI.download({ ...payload, downloadId });
    const isVisible = currentPickerStatusOwner === downloadId;
    if (result && result.paused) {
      setActiveDownloadStatus(downloadId, 'paused');
      if (isVisible) setStatus(window.i18n.t('paused'), '', 'picker');
    } else if (result && result.canceled) {
      removeActiveDownload(downloadId);
      if (isVisible) setStatus(window.i18n.t('download_cancelled'), '', 'picker');
    } else {
      if (isVisible) {
        setStatus(window.i18n.t('download_done_saved', { path: result.path }), 'success', 'picker', {
          onClick: () => window.yoinksAPI.showInFolder(result.path),
        });
      }
      finishActiveDownload(downloadId, 'done');
    }
  } catch (err) {
    if (currentPickerStatusOwner === downloadId) {
      setStatus(window.i18n.t('download_failed', { error: err.message }), 'error', 'picker');
    }
    finishActiveDownload(downloadId, 'error');
  } finally {
    progressCallbacks.delete(downloadId);
    // Resetear preset seleccionado después de descargar
    selectedPresetForDownload = null;
    presetMenuBtn.textContent = window.i18n.t('btn_preset_menu');
    document.querySelectorAll('.preset-dropdown-item').forEach(item => item.classList.remove('active'));
    // Si hay alguna pestaña basada en historial abierta (Historial, Completadas,
    // Error o Canceladas), refrescarla para que se vea la nueva entrada.
    if (!activityOverlay.classList.contains('hidden') && HISTORY_TABS[activeActivityTab]) loadHistoryTab(activeActivityTab);
  }
}

// ================= MENU DROPDOWN DE CONFIGURACIÓN =================

function toggleSettingsMenu() {
  settingsMenu.classList.toggle('hidden');
}

function closeSettingsMenu() {
  settingsMenu.classList.add('hidden');
}

settingsBtn.addEventListener('click', toggleSettingsMenu);

// Cerrar menú cuando se hace clic en cualquier lugar del documento
document.addEventListener('click', (e) => {
  if (!settingsBtn.contains(e.target) && !settingsMenu.contains(e.target)) {
    closeSettingsMenu();
  }
});

// Opción General: abre el panel General
menuGeneral.addEventListener('click', () => {
  closeSettingsMenu();
  openGeneralPanel();
});

// Opción Download: abre el panel de Configuración de Descarga
menuDownload.addEventListener('click', () => {
  closeSettingsMenu();
  openDownloadSettingsPanel();
});

// Opción Cookies
menuCookies.addEventListener('click', () => {
  closeSettingsMenu();
  openCookiesPanel();
});

// Opción Presets
menuPresets.addEventListener('click', () => {
  closeSettingsMenu();
  openPresetsPanel();
});

// Opción Actualizaciones
menuUpdates.addEventListener('click', () => {
  closeSettingsMenu();
  openUpdatesPanel();
});

// Opción Acerca de
menuAbout.addEventListener('click', () => {
  closeSettingsMenu();
  openAboutPanel();
});

// ================= ACERCA DE (panel ⚙) =================

const aboutOverlay = document.getElementById('about-overlay');
const aboutCloseBtn = document.getElementById('about-close-btn');
const aboutVersionEl = document.getElementById('about-version');
const aboutFfmpegVersionEl = document.getElementById('about-ffmpeg-version');
const aboutDenoVersionEl = document.getElementById('about-deno-version');

let aboutVersionLoaded = false;

// Extrae solo el número de versión (ej. "6.0" o "1.42.0") de la primera
// línea que devuelve el binario (ej. "ffmpeg version 6.0-full_build..." o
// "deno 1.42.0 (release, ...)"). Si no encuentra un patrón de versión,
// devuelve null y el llamador usa el texto crudo o un mensaje por defecto.
function extractShortVersion(raw) {
  if (!raw) return null;
  const match = raw.match(/(\d+(?:\.\d+){1,3})/);
  return match ? match[1] : null;
}

// Consulta la versión real de ffmpeg y Deno actualmente instalados
// (misma fuente que el panel de Actualizaciones) y actualiza las filas
// correspondientes en "Librerías usadas". Se llama cada vez que se abre
// el panel, así que si el usuario actualizó ffmpeg o Deno, la próxima vez
// que abra "Acerca de" verá el número de versión nuevo automáticamente.
async function loadAboutLibraryVersions() {
  aboutFfmpegVersionEl.textContent = window.i18n.t('checking_version');
  aboutDenoVersionEl.textContent = window.i18n.t('checking_version');
  try {
    const info = await window.yoinksAPI.getUpdateVersions();

    const ffmpegShort = extractShortVersion(info.ffmpegVersion);
    aboutFfmpegVersionEl.textContent = ffmpegShort
      ? `v${ffmpegShort}`
      : info.ffmpegVersion || window.i18n.t('auto_downloaded');

    const denoShort = extractShortVersion(info.denoVersion);
    aboutDenoVersionEl.textContent = denoShort
      ? `v${denoShort}`
      : info.denoVersion || window.i18n.t('auto_downloaded');
  } catch {
    aboutFfmpegVersionEl.textContent = window.i18n.t('auto_downloaded');
    aboutDenoVersionEl.textContent = window.i18n.t('auto_downloaded');
  }
}

async function openAboutPanel() {
  closeAllOverlayPanels();
  aboutOverlay.classList.remove('hidden');
  if (!aboutVersionLoaded) {
    aboutVersionLoaded = true;
    try {
      const version = await window.yoinksAPI.getAppVersion();
      aboutVersionEl.textContent = `v${version}`;
    } catch {
      // deja el texto por defecto si falla
    }
  }
  loadAboutLibraryVersions();
}

function closeAboutPanel() {
  aboutOverlay.classList.add('hidden');
}

aboutCloseBtn.addEventListener('click', closeAboutPanel);
aboutOverlay.addEventListener('click', (e) => {
  if (e.target === aboutOverlay) closeAboutPanel();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !aboutOverlay.classList.contains('hidden')) {
    closeAboutPanel();
  }
});

// ================= PRESETS (panel ⚙) =================

async function loadPresets() {
  try {
    presets = (await window.yoinksAPI.listPresets()) || [];
  } catch (e) {
    presets = [];
  }
  renderPresetsTable();
}

let editingPresetIndex = null; // índice del preset que se está editando (null = modo "añadir")

function renderPresetsTable() {
  presetsTbody.innerHTML = '';

  if (presets.length === 0) {
    presetsTbody.innerHTML =
      `<tr><td colspan="4" style="color:var(--fg-dimmer); padding:14px;">${window.i18n.t('no_presets_yet')}</td></tr>`;
    return;
  }

  presets.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="site">${escapeHtml(p.site)}</td>
      <td class="name">${escapeHtml(p.name)}</td>
      <td class="options">${escapeHtml(p.options)}</td>
      <td class="actions">
        <button class="preset-edit" data-index="${i}">${window.i18n.t('btn_edit')}</button>
        <button class="preset-delete" data-index="${i}">${window.i18n.t('btn_delete')}</button>
      </td>
    `;
    presetsTbody.appendChild(tr);
  });

  presetsTbody.querySelectorAll('.preset-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.dataset.index, 10);
      // Si se elimina el preset que se estaba editando (o uno antes de él en
      // la lista), salimos del modo edición para no guardar en un índice inválido.
      if (editingPresetIndex !== null && index <= editingPresetIndex) {
        cancelPresetEdit();
      }
      presets = await window.yoinksAPI.deletePreset(index);
      renderPresetsTable();
      refreshPresetItemsInPicker();
    });
  });

  presetsTbody.querySelectorAll('.preset-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index, 10);
      startPresetEdit(index);
    });
  });
}

function startPresetEdit(index) {
  const preset = presets[index];
  if (!preset) return;
  editingPresetIndex = index;
  presetSiteInput.value = preset.site || '';
  presetNameInput.value = preset.name || '';
  presetOptionsInput.value = preset.options || '';
  presetsAddBtn.textContent = window.i18n.t('btn_save_changes');
  presetsAddBtn.classList.add('editing');
  presetsCancelEditBtn.classList.remove('hidden');
  presetSiteInput.focus();
}

function cancelPresetEdit() {
  editingPresetIndex = null;
  presetSiteInput.value = '';
  presetNameInput.value = '';
  presetOptionsInput.value = '';
  presetsAddBtn.textContent = window.i18n.t('btn_add');
  presetsAddBtn.classList.remove('editing');
  presetsCancelEditBtn.classList.add('hidden');
}

function openPresetsPanel() {
  closeAllOverlayPanels();
  presetsOverlay.classList.remove('hidden');
}

function closePresetsPanel() {
  presetsOverlay.classList.add('hidden');
  cancelPresetEdit();
}

// El evento para abrir el panel ahora se maneja a través del menú dropdown
// btnPresets.addEventListener('click', openPresetsPanel); <- REMOVIDO
presetsCloseBtn.addEventListener('click', closePresetsPanel);
presetsOverlay.addEventListener('click', (e) => {
  if (e.target === presetsOverlay) closePresetsPanel();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!activityOverlay.classList.contains('hidden')) {
    closeActivityPanel();
  } else if (!presetsOverlay.classList.contains('hidden')) {
    closePresetsPanel();
  } else if (screenPicker.classList.contains('active')) {
    goToHomeScreen();
  }
});

// Recalcula presetItems con la lista de presets actualizada y refresca la
// pantalla de formatos si está abierta, para que el nuevo/editado/eliminado
// preajuste aparezca ahí de inmediato sin tener que recargar el video.
function refreshPresetItemsInPicker() {
  presetItems = computePresetItemsForCurrentSite(currentVideoInfo || {});
  recomputeVisibleOptions();
  if (screenPicker.classList.contains('active')) {
    renderDownloadList();
  }
}

presetsAddBtn.addEventListener('click', async () => {
  const site = presetSiteInput.value.trim();
  const name = presetNameInput.value.trim();
  const options = presetOptionsInput.value.trim();

  if (!site || !name || !options) return;

  if (editingPresetIndex !== null) {
    presets = await window.yoinksAPI.updatePreset(editingPresetIndex, { site, name, options });
  } else {
    presets = await window.yoinksAPI.addPreset({ site, name, options });
  }
  cancelPresetEdit();
  renderPresetsTable();
  refreshPresetItemsInPicker();
});

presetsResetBtn.addEventListener('click', async () => {
  presets = await window.yoinksAPI.resetPresets();
  cancelPresetEdit();
  renderPresetsTable();
  refreshPresetItemsInPicker();
});

presetsCancelEditBtn.addEventListener('click', () => {
  cancelPresetEdit();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ================= HISTORIAL (panel 🕘) =================

function formatHistoryDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleString();
  } catch (e) {
    return isoString || '';
  }
}

// Etiquetas/clase de badge por estado de una entrada del historial. "cancelled"
// reutiliza los mismos tonos ámbar que usa el badge "paused" del panel de
// descargas en curso, para mantener el mismo lenguaje visual.
const HISTORY_BADGE_CLASS = { success: 'success', error: 'error', cancelled: 'paused' };
function getHistoryBadgeText(status) {
  if (status === 'success') return 'ok';
  if (status === 'cancelled') return window.i18n.t('badge_cancelled');
  return 'error';
}

// Mapa de cada pestaña de historial a su lista/estado vacío en el DOM y, si
// corresponde, el status por el que filtrar. "history" no filtra (muestra todo).
const HISTORY_TABS = {
  history: { listEl: historyListEl, emptyEl: historyEmptyEl, filter: null },
  completed: { listEl: completedListEl, emptyEl: completedEmptyEl, filter: 'success' },
  error: { listEl: errorListEl, emptyEl: errorEmptyEl, filter: 'error' },
  cancelled: { listEl: cancelledListEl, emptyEl: cancelledEmptyEl, filter: 'cancelled' },
};

// Trae el historial completo del disco y pinta la pestaña pedida (filtrando
// por estado si corresponde). Se vuelve a pedir el historial completo en
// cada cambio de pestaña en vez de guardarlo en memoria porque es barato
// (un solo archivo JSON) y así siempre refleja cambios hechos en otra pestaña
// (ej. borrar una entrada en "Historial" debe desaparecer también de "Error").
async function loadHistoryTab(tab) {
  let history = [];
  try {
    history = (await window.yoinksAPI.listHistory()) || [];
  } catch (e) {
    history = [];
  }
  renderHistoryTab(tab, history);
}

function renderHistoryTab(tab, history) {
  const cfg = HISTORY_TABS[tab];
  if (!cfg) return;
  const filtered = cfg.filter ? history.filter((entry) => entry.status === cfg.filter) : history;
  renderHistoryList(cfg.listEl, cfg.emptyEl, filtered);
}

// Vuelve a pintar todas las pestañas de historial a la vez a partir del mismo
// array (evita 4 llamadas IPC cuando ya se tiene el historial actualizado a
// mano, ej. justo después de borrar una entrada o vaciar todo).
function renderAllHistoryTabs(history) {
  Object.keys(HISTORY_TABS).forEach((tab) => renderHistoryTab(tab, history));
}

function renderHistoryList(listEl, emptyEl, history) {
  listEl.innerHTML = '';
  emptyEl.classList.toggle('hidden', history.length > 0);

  history.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'history-item';

    const badgeClass = HISTORY_BADGE_CLASS[entry.status] || 'error';
    const badgeText = getHistoryBadgeText(entry.status);

    const metaParts = [];
    if (entry.site) metaParts.push(escapeHtml(entry.site));
    if (entry.label) metaParts.push(escapeHtml(window.i18n.translateKnownText(entry.label)));
    metaParts.push(formatHistoryDate(entry.date));

    row.innerHTML = `
      ${entry.thumbnail ? `<img class="history-item-thumb" src="${escapeHtml(entry.thumbnail)}" alt="" onerror="this.remove()" />` : ''}
      <div class="history-item-main">
        <div class="history-item-title">${escapeHtml(entry.title || entry.url)}</div>
        <div class="history-item-meta">${metaParts
          .map((p) => `<span>${p}</span>`)
          .join('<span class="sep">·</span>')}
          <span class="history-badge ${badgeClass}">${badgeText}</span>
        </div>
        ${entry.status === 'error' ? `<div class="history-item-error">${escapeHtml(entry.error || '')}</div>` : ''}
      </div>
      <div class="history-item-actions">
        ${entry.url ? `<button class="history-redownload">${window.i18n.t('btn_redownload')}</button>` : ''}
        ${entry.status === 'success' ? `<button class="history-open">${window.i18n.t('btn_open')}</button>` : ''}
        <button class="history-delete">${window.i18n.t('btn_delete')}</button>
      </div>
    `;

    if (entry.url) {
      row.querySelector('.history-redownload').addEventListener('click', () => {
        redownloadFromHistory(entry);
      });
    }

    if (entry.status === 'success') {
      row.querySelector('.history-open').addEventListener('click', () => {
        window.yoinksAPI.openHistoryFile(entry.path);
      });
    }

    row.querySelector('.history-delete').addEventListener('click', async () => {
      const updated = await window.yoinksAPI.deleteHistoryItem(entry.id);
      renderAllHistoryTabs(updated);
    });

    listEl.appendChild(row);
  });
}

// Retoma una entrada del historial: precarga su URL en la pantalla principal
// y abre el selector de formatos para elegir calidad y descargar de nuevo.
function redownloadFromHistory(entry) {
  if (!entry.url) return;
  closeActivityPanel();
  goToHomeScreen();
  input.value = entry.url;
  updateClearBtnVisibility();
  handleYoink();
}

historyClearBtn.addEventListener('click', async () => {
  const updated = await window.yoinksAPI.clearHistory();
  renderAllHistoryTabs(updated);
});

// ================= DESCARGAS EN CURSO (panel) =================
let activeDownloads = []; // [{ id, title, label, percent, status: 'queued'|'downloading'|'paused'|'done'|'error', payload }]
let downloadIdCounter = 0;
// IDs cancelados mientras aún estaban "en cola" (sin proceso propio todavía),
// para que el worker de la playlist los salte antes de arrancarlos.
const canceledBeforeStart = new Set();
// Igual, pero para pausar: el worker los salta sin arrancarlos y quedan "pausados".
const pausedBeforeStart = new Set();
// IDs marcados con el checkbox de cada fila, para las acciones "seleccionados".
const selectedDownloadIds = new Set();

function isSelectableDownload(d) {
  return d.status === 'queued' || d.status === 'downloading' || d.status === 'paused';
}

function queueActiveDownload(title, label, payload, thumbnail) {
  const id = ++downloadIdCounter;
  activeDownloads.push({
    id,
    title: title || window.i18n.t('no_title'),
    label: label || '',
    percent: 0,
    status: 'queued',
    payload: payload || null,
    thumbnail: thumbnail || (payload && payload.thumbnail) || null,
  });
  renderDownloadsPanel();
  return id;
}

function setActiveDownloadStatus(id, status) {
  const d = activeDownloads.find((x) => x.id === id);
  if (d) d.status = status;
  renderDownloadsPanel();
}

// Actualiza el progreso de una descarga. En vez de rehacer todo el panel
// (renderDownloadsPanel), que borra y vuelve a crear todas las filas y sus
// botones, actualiza en el lugar solo la barra/porcentaje de la fila ya
// pintada. Esto es importante porque los eventos de progreso llegan muy
// seguido: si se reconstruyera la fila completa cada vez, un click de
// "pausar"/"cancelar" podía caer justo cuando el botón se destruye y se
// vuelve a crear, y el navegador nunca llegaba a disparar el evento
// (parecía que el botón "no respondía").
function setActiveDownloadProgress(id, percent) {
  const d = activeDownloads.find((x) => x.id === id);
  if (!d) return;
  const wasQueued = d.status === 'queued';
  d.percent = percent;
  d.status = 'downloading';

  const row = downloadsListEl.querySelector(`[data-download-id="${id}"]`);
  if (row) {
    const fill = row.querySelector('.update-progress-fill');
    const text = row.querySelector('.update-progress-text');
    if (fill) fill.style.width = percent + '%';
    if (text) text.textContent = percent.toFixed(0) + '%';

    // Si venía de "en cola", el texto/badge de estado deben pasar a
    // "descargando" sin tocar el resto de la fila (los botones se quedan
    // igual: ya mostraba "pausar"/"cancelar" desde que estaba en cola).
    if (wasQueued) {
      const statusText = row.querySelector('.active-dl-status-text');
      if (statusText) statusText.textContent = window.i18n.t('status_downloading');
      const badge = row.querySelector('.history-badge');
      if (badge) {
        badge.textContent = window.i18n.t('status_downloading');
        badge.className = 'history-badge ' + DOWNLOAD_STATUS_BADGE_CLASS.downloading;
      }
    }
    return;
  }

  // Si la fila todavía no existe en el DOM (caso raro), se recurre al
  // render completo como respaldo.
  renderDownloadsPanel();
}

function removeActiveDownload(id) {
  activeDownloads = activeDownloads.filter((x) => x.id !== id);
  selectedDownloadIds.delete(id);
  renderDownloadsPanel();
}

// Marca la descarga como terminada (lista/error) y la quita de la lista
// un momento después, para que el usuario alcance a ver el resultado.
function finishActiveDownload(id, status) {
  const d = activeDownloads.find((x) => x.id === id);
  if (d) {
    d.status = status;
    d.percent = 100;
  }
  renderDownloadsPanel();
  if (status === 'done') playNotificationSoundIfEnabled();
  setTimeout(() => removeActiveDownload(id), 2500);
}

// ================= SONIDO DE NOTIFICACIÓN =================
// Se reproduce al terminar una descarga (con éxito) y al terminar la
// instalación automática de dependencias la primera vez. Respeta el
// interruptor "Sonido" de Configuración.
async function playNotificationSoundIfEnabled() {
  try {
    const settings = await window.yoinksAPI.getSettings();
    if (!settings || settings.soundEnabled === false) return;
    await window.yoinksAPI.playNotificationSound();
  } catch (e) {
    // sin sonido disponible: no es crítico, se ignora
  }
}

// Despachador único de progreso: yt-dlp reporta el % por descarga (identificada por
// downloadId) para que, con varias descargas simultáneas, cada barra de progreso
// del panel de Actividad se actualice de forma independiente. Se registra una sola
// vez (no en cada clic) para no acumular listeners duplicados.
const progressCallbacks = new Map(); // downloadId -> function(percent)
window.yoinksAPI.onProgress((data) => {
  if (!data || data.id === undefined) return;
  setActiveDownloadProgress(data.id, data.percent);
  const cb = progressCallbacks.get(data.id);
  if (cb) cb(data.percent);
});

function getDownloadStatusLabel(status) {
  const map = {
    queued: 'status_queued',
    downloading: 'status_downloading',
    paused: 'status_paused',
    done: 'status_done',
    error: 'status_error',
  };
  return map[status] ? window.i18n.t(map[status]) : status;
}
const DOWNLOAD_STATUS_BADGE_CLASS = { queued: 'queued', downloading: 'downloading', paused: 'paused', done: 'success', error: 'error' };

function pauseActiveDownload(id) {
  const d = activeDownloads.find((x) => x.id === id);
  if (!d) return;
  if (d.status === 'queued') {
    // Todavía no arrancó (esperando su turno en el pool de la playlist): márcalo
    // para que el worker no lo empiece, y refleja "pausado" en la UI de inmediato.
    pausedBeforeStart.add(id);
    setActiveDownloadStatus(id, 'paused');
    return;
  }
  window.yoinksAPI.pauseDownload(id);
}

function cancelActiveDownload(id) {
  const d = activeDownloads.find((x) => x.id === id);
  if (!d) return;
  pausedBeforeStart.delete(id);
  if (d.status === 'queued') {
    // Todavía no arrancó (esperando su turno en el pool de la playlist):
    // márcalo para que el worker lo salte cuando le toque, y quítalo ya de la lista.
    canceledBeforeStart.add(id);
    removeActiveDownload(id);
    return;
  }
  if (d.status === 'paused') {
    // Ya no hay proceso corriendo (se mató al pausar), así que no hay nada que
    // señalizar en el proceso principal: simplemente se quita de la lista.
    removeActiveDownload(id);
    return;
  }
  window.yoinksAPI.cancelDownload(id);
}

async function resumeActiveDownload(id) {
  const d = activeDownloads.find((x) => x.id === id);
  if (!d || !d.payload) return;
  setActiveDownloadStatus(id, 'downloading');
  try {
    const result = await window.yoinksAPI.download({ ...d.payload, downloadId: id });
    if (result && result.paused) {
      setActiveDownloadStatus(id, 'paused');
    } else if (result && result.canceled) {
      removeActiveDownload(id);
    } else {
      finishActiveDownload(id, 'done');
    }
  } catch (err) {
    finishActiveDownload(id, 'error');
  }
}

function toggleDownloadSelection(id, checked) {
  if (checked) selectedDownloadIds.add(id);
  else selectedDownloadIds.delete(id);
  renderDownloadsPanel();
}

function pauseAllActiveDownloads() {
  activeDownloads
    .filter((d) => d.status === 'downloading' || d.status === 'queued')
    .forEach((d) => pauseActiveDownload(d.id));
}

function resumeAllActiveDownloads() {
  activeDownloads.filter((d) => d.status === 'paused').forEach((d) => resumeActiveDownload(d.id));
}

function cancelAllActiveDownloads() {
  activeDownloads.filter(isSelectableDownload).forEach((d) => cancelActiveDownload(d.id));
}

function resumeSelectedDownloads() {
  activeDownloads
    .filter((d) => selectedDownloadIds.has(d.id) && d.status === 'paused')
    .forEach((d) => resumeActiveDownload(d.id));
}

function pauseSelectedDownloads() {
  activeDownloads
    .filter((d) => selectedDownloadIds.has(d.id) && (d.status === 'downloading' || d.status === 'queued'))
    .forEach((d) => pauseActiveDownload(d.id));
}

function cancelSelectedDownloads() {
  activeDownloads
    .filter((d) => selectedDownloadIds.has(d.id) && isSelectableDownload(d))
    .forEach((d) => cancelActiveDownload(d.id));
}

downloadsSelectAllCheckbox.addEventListener('change', () => {
  const selectable = activeDownloads.filter(isSelectableDownload);
  if (downloadsSelectAllCheckbox.checked) {
    selectable.forEach((d) => selectedDownloadIds.add(d.id));
  } else {
    selectable.forEach((d) => selectedDownloadIds.delete(d.id));
  }
  renderDownloadsPanel();
});

// Botones dinámicos que actúan sobre seleccionados o todos según el contexto
downloadsPauseBtn.addEventListener('click', () => {
  const selectedCount = selectedDownloadIds.size;
  if (selectedCount > 0) {
    pauseSelectedDownloads();
  } else {
    pauseAllActiveDownloads();
  }
});

downloadsResumeBtn.addEventListener('click', () => {
  const selectedCount = selectedDownloadIds.size;
  if (selectedCount > 0) {
    resumeSelectedDownloads();
  } else {
    resumeAllActiveDownloads();
  }
});

downloadsCancelBtn.addEventListener('click', () => {
  const selectedCount = selectedDownloadIds.size;
  if (selectedCount > 0) {
    cancelSelectedDownloads();
  } else {
    cancelAllActiveDownloads();
  }
});

function renderDownloadsPanel() {
  downloadsBadge.textContent = String(activeDownloads.length);
  downloadsBadge.classList.toggle('hidden', activeDownloads.length === 0);

  downloadsListEl.innerHTML = '';
  downloadsEmptyEl.classList.toggle('hidden', activeDownloads.length > 0);

  // La barra de acciones masivas solo aparece si hay algo que seleccionar/pausar/cancelar.
  const selectableItems = activeDownloads.filter(isSelectableDownload);
  downloadsToolbarEl.classList.toggle('hidden', selectableItems.length === 0);

  // Limpiar selecciones de descargas que ya no están activas (terminadas/eliminadas)
  const selectableIds = new Set(selectableItems.map((d) => d.id));
  Array.from(selectedDownloadIds).forEach((id) => {
    if (!selectableIds.has(id)) selectedDownloadIds.delete(id);
  });

  const selectedCount = selectedDownloadIds.size;
  
  // Actualizar textos y estados de los botones dinámicos
  const hasPauseable = activeDownloads.some((d) => d.status === 'downloading' || d.status === 'queued');
  const hasResumeable = activeDownloads.some((d) => d.status === 'paused');
  const selectedPauseable = Array.from(selectedDownloadIds).some((id) => {
    const d = activeDownloads.find((x) => x.id === id);
    return d && (d.status === 'downloading' || d.status === 'queued');
  });
  const selectedResumeable = Array.from(selectedDownloadIds).some((id) => {
    const d = activeDownloads.find((x) => x.id === id);
    return d && d.status === 'paused';
  });
  
  if (selectedCount > 0) {
    // Modo "seleccionados"
    downloadsPauseBtn.textContent = selectedCount === 1 ? window.i18n.t('pause_selected') : window.i18n.t('pause_selected_plural');
    downloadsResumeBtn.textContent = selectedCount === 1 ? window.i18n.t('resume_selected') : window.i18n.t('resume_selected_plural');
    downloadsCancelBtn.textContent = selectedCount === 1 ? window.i18n.t('cancel_selected') : window.i18n.t('cancel_selected_plural');
    
    downloadsPauseBtn.disabled = !selectedPauseable;
    downloadsResumeBtn.disabled = !selectedResumeable;
    downloadsCancelBtn.disabled = selectedDownloadIds.size === 0;
  } else {
    // Modo "todo"
    downloadsPauseBtn.textContent = window.i18n.t('btn_pause_all');
    downloadsResumeBtn.textContent = window.i18n.t('btn_resume_all');
    downloadsCancelBtn.textContent = window.i18n.t('btn_cancel_all');
    
    downloadsPauseBtn.disabled = !hasPauseable;
    downloadsResumeBtn.disabled = !hasResumeable;
    downloadsCancelBtn.disabled = selectableItems.length === 0;
  }
  
  downloadsSelectAllCheckbox.checked = selectableItems.length > 0 && selectedCount === selectableItems.length;
  downloadsSelectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < selectableItems.length;

  activeDownloads.forEach((d) => {
    const row = document.createElement('div');
    row.className = 'history-item';

    const statusLabel = getDownloadStatusLabel(d.status);
    const badgeClass = DOWNLOAD_STATUS_BADGE_CLASS[d.status] || '';
    const showProgress = d.status === 'queued' || d.status === 'downloading';
    const selectable = isSelectableDownload(d);
    const isChecked = selectedDownloadIds.has(d.id);

    // Pausar solo tiene sentido si ya hay un proceso corriendo; en cola/pausado se puede cancelar;
    // pausado se puede reanudar (retoma el .part donde quedó).
    const actionButtons = [];
    if (d.status === 'downloading' || d.status === 'queued') {
      actionButtons.push(`<button class="active-dl-pause" title="${window.i18n.t('tt_pause')}">${window.i18n.t('btn_pause')}</button>`);
    }
    if (d.status === 'paused') actionButtons.push(`<button class="active-dl-resume" title="${window.i18n.t('tt_resume')}">${window.i18n.t('btn_resume')}</button>`);
    if (d.status === 'queued' || d.status === 'downloading' || d.status === 'paused') {
      actionButtons.push(`<button class="active-dl-cancel" title="${window.i18n.t('tt_cancel')}">${window.i18n.t('btn_cancel_download')}</button>`);
    }

    row.innerHTML = `
      ${selectable ? `<input type="checkbox" class="active-dl-select" ${isChecked ? 'checked' : ''} title="${window.i18n.t('tt_select')}" />` : '<span class="active-dl-select-spacer"></span>'}
      ${d.thumbnail ? `<img class="history-item-thumb" src="${escapeHtml(d.thumbnail)}" alt="" onerror="this.remove()" />` : ''}
      <div class="history-item-main">
        <div class="history-item-title">${escapeHtml(d.title)}</div>
        <div class="history-item-meta">
          ${d.label ? `<span>${escapeHtml(window.i18n.translateKnownText(d.label))}</span><span class="sep">·</span>` : ''}
          <span class="active-dl-status-text">${statusLabel}</span>
        </div>
        ${
          showProgress
            ? `<div class="update-progress">
                 <div class="update-progress-bar"><div class="update-progress-fill" style="width:${d.percent}%"></div></div>
                 <span class="update-progress-text">${d.percent.toFixed(0)}%</span>
               </div>`
            : ''
        }
      </div>
      ${actionButtons.length ? `<div class="history-item-actions">${actionButtons.join('')}</div>` : ''}
      <span class="history-badge ${badgeClass}">${statusLabel}</span>
    `;

    row.dataset.downloadId = String(d.id);
    const selectCheckbox = row.querySelector('.active-dl-select');
    if (selectCheckbox) {
      selectCheckbox.addEventListener('change', () => toggleDownloadSelection(d.id, selectCheckbox.checked));
    }

    const pauseBtn = row.querySelector('.active-dl-pause');
    if (pauseBtn) pauseBtn.addEventListener('click', () => pauseActiveDownload(d.id));

    const resumeBtn = row.querySelector('.active-dl-resume');
    if (resumeBtn) resumeBtn.addEventListener('click', () => resumeActiveDownload(d.id));

    const cancelBtn = row.querySelector('.active-dl-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => cancelActiveDownload(d.id));

    downloadsListEl.appendChild(row);
  });
}

renderDownloadsPanel();

// ---- Panel de Actividad: Descargas en curso + Completadas/Error/Canceladas + Historial, unificados con pestañas ----
let activeActivityTab = 'downloads';

// Cada pestaña asocia su botón con su panel. "downloads" es la única que no
// viene del historial en disco (se arma en memoria en tiempo real).
const ACTIVITY_TABS = {
  downloads: { tabBtn: activityTabDownloads, panelEl: activityPanelDownloads },
  completed: { tabBtn: activityTabCompleted, panelEl: activityPanelCompleted },
  error: { tabBtn: activityTabError, panelEl: activityPanelError },
  cancelled: { tabBtn: activityTabCancelled, panelEl: activityPanelCancelled },
  history: { tabBtn: activityTabHistory, panelEl: activityPanelHistory },
};

function setActivityTab(tab) {
  activeActivityTab = tab;
  Object.entries(ACTIVITY_TABS).forEach(([key, { tabBtn, panelEl }]) => {
    const isActive = key === tab;
    tabBtn.classList.toggle('active', isActive);
    panelEl.classList.toggle('hidden', !isActive);
  });
  if (tab !== 'downloads') loadHistoryTab(tab);
}

// Abre el panel de Actividad. Por defecto muestra "Descargas en curso".
function openActivityPanel(tab = 'downloads') {
  closeAllOverlayPanels();
  activityOverlay.classList.remove('hidden');
  setActivityTab(tab);
}

function closeActivityPanel() {
  activityOverlay.classList.add('hidden');
}

btnActivity.addEventListener('click', () => openActivityPanel('downloads'));
activityCloseBtn.addEventListener('click', closeActivityPanel);
activityOverlay.addEventListener('click', (e) => {
  if (e.target === activityOverlay) closeActivityPanel();
});
activityTabDownloads.addEventListener('click', () => setActivityTab('downloads'));
activityTabCompleted.addEventListener('click', () => setActivityTab('completed'));
activityTabError.addEventListener('click', () => setActivityTab('error'));
activityTabCancelled.addEventListener('click', () => setActivityTab('cancelled'));
activityTabHistory.addEventListener('click', () => setActivityTab('history'));

// ================= CONFIGURACIÓN DE DESCARGA (panel ⚙ → Download) =================
// Las cookies se configuran por sitio (no un único modo para toda la app): la app
// detecta automáticamente el sitio del link pegado y usa la config de ESE sitio.
// Mientras el panel está abierto, se guarda un "borrador" en memoria con la
// configuración de cada sitio (cookiesDraft), y el selector "Cookies por sitio"
// simplemente muestra/edita la parte de ese borrador que corresponde al sitio
// elegido. Todo se persiste junto al guardar (botón "Guardar").

const COOKIE_SITE_KEYS = ['youtube', 'tiktok', 'instagram', 'twitter', 'threads', 'bilibili', 'other'];
const COOKIE_SITE_LABELS = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  twitter: 'X / Twitter',
  threads: 'Threads',
  bilibili: 'Bilibili',
  other: 'otros sitios',
};

function defaultCookiesDraft() {
  const draft = {};
  for (const key of COOKIE_SITE_KEYS) {
    draft[key] = { mode: 'none', browser: 'firefox', file: '' };
  }
  return draft;
}

let cookiesDraft = defaultCookiesDraft();

// Guarda lo que esté en el formulario ahora mismo dentro del borrador del sitio
// que estaba seleccionado, antes de cambiar a otro sitio o de guardar todo.
function commitCookiesFormToDraft(site) {
  if (!site) return;
  cookiesDraft[site] = {
    mode: settingCookiesModeSelect.value,
    browser: settingCookiesBrowserSelect.value,
    file: settingCookiesFileInput.value.trim(),
  };
}

// Carga en el formulario la parte del borrador correspondiente al sitio elegido.
function loadCookiesFormFromDraft(site) {
  const entry = cookiesDraft[site] || { mode: 'none', browser: 'firefox', file: '' };
  settingCookiesModeSelect.value = entry.mode || 'none';
  settingCookiesBrowserSelect.value = entry.browser || 'firefox';
  settingCookiesFileInput.value = entry.file || '';
  updateCookiesRowsVisibility();
}

function updateCookiesRowsVisibility() {
  const site = settingCookiesSiteSelect.value;
  const mode = settingCookiesModeSelect.value;
  settingCookiesBrowserRow.classList.toggle('hidden', mode !== 'browser');
  settingCookiesFileRow.classList.toggle('hidden', mode !== 'file');
  settingLoginRow.classList.toggle('hidden', mode !== 'applogin');
  if (mode === 'applogin') refreshLoginStatus();
}

// "Otros sitios" no tiene ventana de login propia, así que se oculta esa opción
// del desplegable de modo cuando el sitio elegido para configurar es "other".
function updateApploginOptionAvailability() {
  const applyOption = settingCookiesModeSelect.querySelector('option[value="applogin"]');
  if (!applyOption) return;
  const isOther = settingCookiesSiteSelect.value === 'other';
  applyOption.disabled = isOther;
  if (isOther && settingCookiesModeSelect.value === 'applogin') {
    settingCookiesModeSelect.value = 'none';
  }
}

settingCookiesSiteSelect.addEventListener('change', (e) => {
  // Antes de mostrar el nuevo sitio, guardamos lo que había quedado del anterior.
  // dataset.prevSite guarda cuál era el sitio mostrado hasta este cambio.
  commitCookiesFormToDraft(settingCookiesSiteSelect.dataset.prevSite);
  updateApploginOptionAvailability();
  loadCookiesFormFromDraft(e.target.value);
  settingCookiesSiteSelect.dataset.prevSite = e.target.value;
});

settingCookiesModeSelect.addEventListener('change', updateCookiesRowsVisibility);

// Refresca el texto/estado de la cuenta del sitio actualmente seleccionado
async function refreshLoginStatus() {
  const site = settingCookiesSiteSelect.value;
  let status = {};
  try {
    status = (await window.yoinksAPI.getLoginStatus()) || {};
  } catch (e) {
    // si falla, se asume que no hay sesión guardada
  }
  const info = status[site];
  if (info) {
    const date = new Date(info.loggedInAt);
    const localeDate = date.toLocaleDateString(window.i18n.getLanguage() === 'en' ? 'en' : 'es');
    settingLoginStatusEl.textContent = window.i18n.t('session_started_on', { date: localeDate, count: info.cookieCount });
    settingLoginLogoutBtn.classList.remove('hidden');
  } else {
    settingLoginStatusEl.textContent = window.i18n.t('login_status_default');
    settingLoginLogoutBtn.classList.add('hidden');
  }
}

settingLoginBtn.addEventListener('click', async () => {
  const site = settingCookiesSiteSelect.value;
  const label = COOKIE_SITE_LABELS[site] || site;
  settingLoginBtn.disabled = true;
  settingLoginBtn.textContent = window.i18n.t('waiting');
  settingLoginStatusEl.textContent = window.i18n.t('login_window_opened', { site: label });
  try {
    const result = await window.yoinksAPI.startLogin(site);
    if (result && result.success) {
      settingLoginStatusEl.textContent = window.i18n.t('login_saved', { count: result.cookieCount });
      settingLoginLogoutBtn.classList.remove('hidden');
    } else {
      settingLoginStatusEl.textContent = window.i18n.t('no_session_saved', {
        reason: result && result.error ? result.error : window.i18n.t('close_only_after_login'),
      });
    }
  } catch (e) {
    settingLoginStatusEl.textContent = window.i18n.t('login_window_error', { error: e.message });
  } finally {
    settingLoginBtn.disabled = false;
    settingLoginBtn.textContent = window.i18n.t('btn_login');
  }
});

settingLoginLogoutBtn.addEventListener('click', async () => {
  const site = settingCookiesSiteSelect.value;
  settingLoginLogoutBtn.disabled = true;
  try {
    await window.yoinksAPI.logoutSite(site);
  } catch (e) {
    // aunque falle, refrescamos el estado para reflejar lo que haya quedado
  } finally {
    settingLoginLogoutBtn.disabled = false;
    refreshLoginStatus();
  }
});

async function loadDownloadSettings() {
  let settings;
  try {
    settings = await window.yoinksAPI.getSettings();
  } catch (e) {
    settings = null;
  }
  applyDownloadSettingsToForm(settings || {});
}

function applyDownloadSettingsToForm(settings) {
  settingDownloadPathInput.value = settings.downloadPath || '';
  settingOutputTemplateInput.value = settings.outputTemplate || '%(title).200B - %(uploader).30B.%(ext)s';

  settingRateLimitInput.value = settings.rateLimit || '';
  settingConcurrentDownloadsSelect.value = String(settings.concurrentDownloads || 1);
}

function openDownloadSettingsPanel() {
  closeAllOverlayPanels();
  loadDownloadSettings();
  downloadSettingsOverlay.classList.remove('hidden');
}

function closeDownloadSettingsPanel() {
  downloadSettingsOverlay.classList.add('hidden');
}

downloadSettingsCloseBtn.addEventListener('click', closeDownloadSettingsPanel);
downloadSettingsOverlay.addEventListener('click', (e) => {
  if (e.target === downloadSettingsOverlay) closeDownloadSettingsPanel();
});

settingPathBrowseBtn.addEventListener('click', async () => {
  try {
    const folder = await window.yoinksAPI.selectDownloadFolder();
    if (folder) settingDownloadPathInput.value = folder;
  } catch (e) {
    // el usuario canceló el diálogo u ocurrió un error; no hacer nada
  }
});

settingCookiesFileBrowseBtn.addEventListener('click', async () => {
  try {
    // Se pasa el sitio elegido en "Cookies por sitio": la app copia el archivo
    // seleccionado a su propia carpeta de configuración (file-cookies/<sitio>.txt)
    // y guarda esa ruta, en vez de depender del archivo original.
    const site = settingCookiesSiteSelect.value;
    const file = await window.yoinksAPI.selectCookiesFile(site);
    if (file) settingCookiesFileInput.value = file;
  } catch (e) {
    // el usuario canceló el diálogo u ocurrió un error; no hacer nada
  }
});

downloadSettingsSaveBtn.addEventListener('click', async () => {
  // Este panel ya no edita cookies ni General (sonido / cierre de ventana), así
  // que traemos lo que haya guardado en disco para no pisarlo con lo del form.
  let current;
  try {
    current = await window.yoinksAPI.getSettings();
  } catch (e) {
    current = {};
  }

  const settings = {
    downloadPath: settingDownloadPathInput.value.trim(),
    outputTemplate: settingOutputTemplateInput.value.trim() || '%(title).200B - %(uploader).30B.%(ext)s',
    cookiesPerSite: current.cookiesPerSite,
    rateLimit: settingRateLimitInput.value.trim(),
    concurrentDownloads: parseInt(settingConcurrentDownloadsSelect.value, 10) || 1,
    soundEnabled: current.soundEnabled,
    closeBehavior: current.closeBehavior,
  };

  try {
    const saved = await window.yoinksAPI.saveSettings(settings);
    applyDownloadSettingsToForm(saved);
    closeDownloadSettingsPanel();
  } catch (e) {
    // si falla el guardado, dejamos el panel abierto para que el usuario reintente
  }
});

downloadSettingsResetBtn.addEventListener('click', async () => {
  try {
    const defaults = await window.yoinksAPI.resetSettings();
    applyDownloadSettingsToForm(defaults);
  } catch (e) {
    // no hacer nada si falla el restablecimiento
  }
});

// ================= PANEL GENERAL (panel ⚙ → General) =================

async function loadGeneralSettings() {
  let settings;
  try {
    settings = await window.yoinksAPI.getSettings();
  } catch (e) {
    settings = null;
  }
  applyGeneralSettingsToForm(settings || {});
}

function applyGeneralSettingsToForm(settings) {
  settingSoundEnabledCheckbox.checked = settings.soundEnabled !== false;
  settingCloseBehaviorSelect.value = ['ask', 'minimize', 'close'].includes(settings.closeBehavior) ? settings.closeBehavior : 'ask';
  settingLanguageSelect.value = settings.language === 'en' ? 'en' : 'es';
}

function openGeneralPanel() {
  closeAllOverlayPanels();
  loadGeneralSettings();
  generalOverlay.classList.remove('hidden');
}

function closeGeneralPanel() {
  generalOverlay.classList.add('hidden');
}

generalCloseBtn.addEventListener('click', closeGeneralPanel);
generalOverlay.addEventListener('click', (e) => {
  if (e.target === generalOverlay) closeGeneralPanel();
});

generalSaveBtn.addEventListener('click', async () => {
  // Traemos el resto de la configuración actual para no pisarla: este panel
  // solo debe tocar sonido y comportamiento al cerrar.
  let current;
  try {
    current = await window.yoinksAPI.getSettings();
  } catch (e) {
    current = {};
  }

  try {
    const saved = await window.yoinksAPI.saveSettings({
      ...current,
      soundEnabled: settingSoundEnabledCheckbox.checked,
      closeBehavior: settingCloseBehaviorSelect.value,
      language: settingLanguageSelect.value,
    });
    applyGeneralSettingsToForm(saved);
    applyLanguage(saved.language === 'en' ? 'en' : 'es');
    if (window.yoinksAPI.setLanguage) window.yoinksAPI.setLanguage(saved.language === 'en' ? 'en' : 'es');
    closeGeneralPanel();
  } catch (e) {
    // si falla el guardado, dejamos el panel abierto para que el usuario reintente
  }
});

generalResetBtn.addEventListener('click', () => {
  // Restablece solo el formulario en pantalla a los valores por defecto;
  // hay que presionar "Guardar" para que quede persistido.
  applyGeneralSettingsToForm({ soundEnabled: true, closeBehavior: 'ask', language: 'es' });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !generalOverlay.classList.contains('hidden')) {
    closeGeneralPanel();
  }
});

// ================= PANEL DE COOKIES (panel ⚙ → Cookies) =================

async function loadCookiesSettings() {
  let settings;
  try {
    settings = await window.yoinksAPI.getSettings();
  } catch (e) {
    settings = null;
  }
  applyCookiesSettingsToForm((settings && settings.cookiesPerSite) || null);
}

function applyCookiesSettingsToForm(cookiesPerSite) {
  cookiesDraft = defaultCookiesDraft();
  if (cookiesPerSite) {
    for (const key of COOKIE_SITE_KEYS) {
      const entry = cookiesPerSite[key];
      if (entry) cookiesDraft[key] = { mode: entry.mode || 'none', browser: entry.browser || 'firefox', file: entry.file || '' };
    }
  }
  const currentSite = settingCookiesSiteSelect.value || 'youtube';
  settingCookiesSiteSelect.dataset.prevSite = currentSite;
  updateApploginOptionAvailability();
  loadCookiesFormFromDraft(currentSite);
}

function openCookiesPanel() {
  closeAllOverlayPanels();
  loadCookiesSettings();
  cookiesOverlay.classList.remove('hidden');
}

function closeCookiesPanel() {
  cookiesOverlay.classList.add('hidden');
}

cookiesCloseBtn.addEventListener('click', closeCookiesPanel);
cookiesOverlay.addEventListener('click', (e) => {
  if (e.target === cookiesOverlay) closeCookiesPanel();
});

cookiesSaveBtn.addEventListener('click', async () => {
  // Volcamos al borrador lo que haya quedado en el formulario del sitio visible
  // antes de armar el objeto final, para no perder la última edición.
  commitCookiesFormToDraft(settingCookiesSiteSelect.value);

  // Traemos el resto de la configuración actual para no pisarla: este panel
  // solo debe tocar cookiesPerSite.
  let current;
  try {
    current = await window.yoinksAPI.getSettings();
  } catch (e) {
    current = {};
  }

  try {
    const saved = await window.yoinksAPI.saveSettings({ ...current, cookiesPerSite: cookiesDraft });
    applyCookiesSettingsToForm(saved.cookiesPerSite);
    closeCookiesPanel();
  } catch (e) {
    // si falla el guardado, dejamos el panel abierto para que el usuario reintente
  }
});

cookiesResetBtn.addEventListener('click', () => {
  // Restablece solo el borrador en pantalla (a "Ninguna" en todos los sitios);
  // hay que presionar "Guardar" para que quede persistido.
  applyCookiesSettingsToForm(null);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !cookiesOverlay.classList.contains('hidden')) {
    closeCookiesPanel();
  }
});

// Esc también cierra el panel de Configuración de Descarga
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !downloadSettingsOverlay.classList.contains('hidden')) {
    closeDownloadSettingsPanel();
  }
});

// ================= ACTUALIZACIONES (panel ⚙ → Actualizaciones) =================

function setUpdatesStatus(text, type = '') {
  updatesStatusEl.textContent = text;
  updatesStatusEl.className = 'settings-hint' + (type ? ' ' + type : '');
}

function showUpdateProgress(target, percent) {
  const wrap = target === 'ytdlp' ? updateYtdlpProgressWrap : target === 'ffmpeg' ? updateFfmpegProgressWrap : updateDenoProgressWrap;
  const fill = target === 'ytdlp' ? updateYtdlpProgressFill : target === 'ffmpeg' ? updateFfmpegProgressFill : updateDenoProgressFill;
  const text = target === 'ytdlp' ? updateYtdlpProgressText : target === 'ffmpeg' ? updateFfmpegProgressText : updateDenoProgressText;

  wrap.classList.remove('hidden');
  const clamped = Math.max(0, Math.min(100, percent));
  fill.style.width = clamped.toFixed(0) + '%';
  text.textContent = clamped.toFixed(0) + '%';
}

function applyUpdateCheckResult(result) {
  lastUpdateCheck = result;
  const count =
    (result.ytdlpUpdateAvailable ? 1 : 0) + (result.ffmpegUpdateAvailable ? 1 : 0) + (result.denoUpdateAvailable ? 1 : 0);

  settingsUpdateBadge.classList.toggle('hidden', count === 0);
  menuUpdatesBadge.textContent = String(count);
  menuUpdatesBadge.classList.toggle('hidden', count === 0);

  updateYtdlpAvailableTag.classList.toggle('hidden', !result.ytdlpUpdateAvailable);
  updateFfmpegAvailableTag.classList.toggle('hidden', !result.ffmpegUpdateAvailable);
  updateDenoAvailableTag.classList.toggle('hidden', !result.denoUpdateAvailable);

  // "Estás en la última versión": solo se muestra cuando se pudo comparar
  // contra la última versión remota (ytdlpChecked/ffmpegChecked/denoChecked)
  // y no hay actualización pendiente. Si la revisión falló (sin conexión,
  // Deno no instalado, etc.) no se muestra ningún mensaje, para no afirmar
  // algo que no se pudo confirmar.
  updateYtdlpUpToDateTag.classList.toggle('hidden', !result.ytdlpChecked || result.ytdlpUpdateAvailable);
  updateFfmpegUpToDateTag.classList.toggle('hidden', !result.ffmpegChecked || result.ffmpegUpdateAvailable);
  updateDenoUpToDateTag.classList.toggle('hidden', !result.denoChecked || result.denoUpdateAvailable);
}

// Revisa si hay versiones nuevas de yt-dlp/FFmpeg/Deno disponibles (silencioso:
// si falla por falta de conexión, simplemente no muestra ninguna notificación).
async function checkForUpdatesSilently() {
  try {
    const result = await window.yoinksAPI.checkForUpdates();
    applyUpdateCheckResult(result);
  } catch (e) {
    // sin conexión u otro error: no se notifica nada
  }
}

function hideUpdateProgress(target) {
  const wrap = target === 'ytdlp' ? updateYtdlpProgressWrap : target === 'ffmpeg' ? updateFfmpegProgressWrap : updateDenoProgressWrap;
  wrap.classList.add('hidden');
}

window.yoinksAPI.onUpdateProgress(({ target, percent }) => {
  if (typeof percent === 'number') showUpdateProgress(target, percent);
});

async function loadUpdateVersions() {
  updateYtdlpVersionEl.textContent = window.i18n.t('checking_version');
  updateFfmpegVersionEl.textContent = window.i18n.t('checking_version');
  updateDenoVersionEl.textContent = window.i18n.t('checking_version');
  try {
    const info = await window.yoinksAPI.getUpdateVersions();
    updateYtdlpVersionEl.textContent = info.ytdlpVersion;
    updateFfmpegVersionEl.textContent = info.ffmpegVersion;
    updateDenoVersionEl.textContent = info.denoVersion;
    updateDenoBtn.textContent = info.denoManaged ? window.i18n.t('btn_update') : window.i18n.t('btn_install');
    updateDenoBtn.dataset.managed = info.denoManaged ? '1' : '0';
    return info;
  } catch (e) {
    updateYtdlpVersionEl.textContent = window.i18n.t('not_installed');
    updateFfmpegVersionEl.textContent = window.i18n.t('not_installed');
    updateDenoVersionEl.textContent = window.i18n.t('not_installed');
    return null;
  }
}

async function loadYtdlpChannelSetting() {
  try {
    const settings = await window.yoinksAPI.getSettings();
    settingYtdlpChannelSelect.value = (settings && settings.ytdlpChannel) || 'nightly';
  } catch (e) {
    settingYtdlpChannelSelect.value = 'nightly';
  }
}

// ================= MENSAJE INFERIOR (toast) =================
const startupToast = document.getElementById('startup-toast');
const startupToastText = document.getElementById('startup-toast-text');
let startupToastHideTimer = null;

function showStartupToast(text, type = '', autoHideMs = 0) {
  clearTimeout(startupToastHideTimer);
  startupToastText.textContent = text;
  startupToast.className = 'startup-toast' + (type ? ' ' + type : '');
  if (autoHideMs > 0) {
    startupToastHideTimer = setTimeout(hideStartupToast, autoHideMs);
  }
}

function hideStartupToast() {
  startupToast.classList.add('hidden');
}

// Al tocar el aviso inferior (ej. "Primera vez: instalando...") se abre
// directamente el panel de Actualizaciones, donde ya se ven las barras de
// progreso de yt-dlp/FFmpeg/Deno en vivo aunque la instalación haya
// arrancado en segundo plano antes de abrir el panel.
startupToast.addEventListener('click', () => {
  hideStartupToast();
  openUpdatesPanel();
});
startupToast.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    hideStartupToast();
    openUpdatesPanel();
  }
});

function openUpdatesPanel() {
  closeAllOverlayPanels();
  setUpdatesStatus('');
  hideUpdateProgress('ytdlp');
  hideUpdateProgress('ffmpeg');
  hideUpdateProgress('deno');
  updatesOverlay.classList.remove('hidden');
  loadYtdlpChannelSetting();
  applyUpdateCheckResult(lastUpdateCheck);
  loadUpdateVersions();
  checkForUpdatesSilently();
}

function closeUpdatesPanel() {
  updatesOverlay.classList.add('hidden');
}

updatesCloseBtn.addEventListener('click', closeUpdatesPanel);
updatesOverlay.addEventListener('click', (e) => {
  if (e.target === updatesOverlay) closeUpdatesPanel();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !updatesOverlay.classList.contains('hidden')) {
    closeUpdatesPanel();
  }
});

settingYtdlpChannelSelect.addEventListener('change', async () => {
  const channel = settingYtdlpChannelSelect.value;
  try {
    const current = await window.yoinksAPI.getSettings();
    await window.yoinksAPI.saveSettings({ ...current, ytdlpChannel: channel });
    setUpdatesStatus('Canal cambiado a "' + (channel === 'nightly' ? 'Nightly' : 'Estable') + '". Revisando versión…');
    await checkForUpdatesSilently();
  } catch (e) {
    setUpdatesStatus(window.i18n.t('channel_save_failed'), 'error');
  }
});

// Descarga/actualiza yt-dlp. Se reutiliza tanto desde el botón "Actualizar"
// como desde la instalación automática al abrir la app.
async function runYtdlpUpdate() {
  updateYtdlpBtn.disabled = true;
  updateYtdlpBtn.textContent = window.i18n.t('updating_ellipsis');
  showUpdateProgress('ytdlp', 0);
  setUpdatesStatus(window.i18n.t('downloading_ytdlp_latest'));

  try {
    const result = await window.yoinksAPI.updateYtDlp();
    if (result.success) {
      updateYtdlpVersionEl.textContent = result.version;
      setUpdatesStatus(window.i18n.t('ytdlp_updated_ok'), 'success');
      applyUpdateCheckResult({ ...lastUpdateCheck, ytdlpUpdateAvailable: false, ytdlpLatestVersion: null, ytdlpChecked: true });
    } else {
      setUpdatesStatus(window.i18n.t('ytdlp_update_failed', { error: result.error }), 'error');
    }
    return result;
  } catch (err) {
    setUpdatesStatus(window.i18n.t('ytdlp_update_failed', { error: err.message }), 'error');
    return { success: false, error: err.message };
  } finally {
    hideUpdateProgress('ytdlp');
    updateYtdlpBtn.disabled = false;
    updateYtdlpBtn.textContent = window.i18n.t('btn_update');
  }
}

updateYtdlpBtn.addEventListener('click', runYtdlpUpdate);

// Descarga/actualiza FFmpeg. Ídem: reutilizada por el botón y por la
// instalación automática.
async function runFfmpegUpdate() {
  updateFfmpegBtn.disabled = true;
  updateFfmpegBtn.textContent = window.i18n.t('updating_ellipsis');
  showUpdateProgress('ffmpeg', 0);
  setUpdatesStatus(window.i18n.t('downloading_ffmpeg_latest'));

  try {
    const result = await window.yoinksAPI.updateFfmpeg();
    if (result.success) {
      updateFfmpegVersionEl.textContent = result.version;
      setUpdatesStatus(window.i18n.t('ffmpeg_updated_ok'), 'success');
      applyUpdateCheckResult({ ...lastUpdateCheck, ffmpegUpdateAvailable: false, ffmpegChecked: true });
    } else {
      setUpdatesStatus(window.i18n.t('ffmpeg_update_failed', { error: result.error }), 'error');
    }
    return result;
  } catch (err) {
    setUpdatesStatus(window.i18n.t('ffmpeg_update_failed', { error: err.message }), 'error');
    return { success: false, error: err.message };
  } finally {
    hideUpdateProgress('ffmpeg');
    updateFfmpegBtn.disabled = false;
    updateFfmpegBtn.textContent = window.i18n.t('btn_update');
  }
}

updateFfmpegBtn.addEventListener('click', runFfmpegUpdate);

// Instala/actualiza Deno. "wasManaged" decide si el texto es "Instalando…"
// (primera vez) o "Actualizando…" (ya estaba instalado).
async function runDenoUpdate(wasManaged) {
  updateDenoBtn.disabled = true;
  updateDenoBtn.textContent = wasManaged ? window.i18n.t('updating_ellipsis') : window.i18n.t('installing_ellipsis');
  showUpdateProgress('deno', 0);
  setUpdatesStatus(wasManaged ? window.i18n.t('downloading_deno_latest') : window.i18n.t('installing_deno'));

  try {
    const result = await window.yoinksAPI.updateDeno();
    if (result.success) {
      updateDenoVersionEl.textContent = result.version;
      setUpdatesStatus(
        wasManaged ? window.i18n.t('deno_updated_ok') : window.i18n.t('deno_installed_ok'),
        'success'
      );
      applyUpdateCheckResult({ ...lastUpdateCheck, denoUpdateAvailable: false, denoLatestVersion: null, denoChecked: true });
    } else {
      setUpdatesStatus(window.i18n.t('deno_install_failed', { error: result.error }), 'error');
    }
    return result;
  } catch (err) {
    setUpdatesStatus(window.i18n.t('deno_install_failed', { error: err.message }), 'error');
    return { success: false, error: err.message };
  } finally {
    hideUpdateProgress('deno');
    updateDenoBtn.disabled = false;
    updateDenoBtn.textContent = window.i18n.t('btn_update');
    updateDenoBtn.dataset.managed = '1';
  }
}

updateDenoBtn.addEventListener('click', () => {
  const wasManaged = updateDenoBtn.dataset.managed === '1';
  runDenoUpdate(wasManaged);
});

// ================= INSTALACIÓN AUTOMÁTICA AL ABRIR LA APP =================
// La primera vez que se abre la app (o si el usuario borró/movió algún
// binario a mano) yt-dlp/FFmpeg/Deno no están disponibles todavía. En vez de
// obligar a entrar a Configuración → Actualizaciones y pulsar cada botón,
// se detecta qué falta y se descarga solo, mostrando el mismo panel con sus
// barras de progreso para que quede claro qué está pasando.
async function autoInstallMissingBinaries() {
  let info;
  try {
    info = await window.yoinksAPI.getUpdateVersions();
  } catch (e) {
    return; // sin conexión u otro error: no se insiste, se reintentará en el próximo arranque
  }
  if (!info) return;

  const missingLabels = { ytdlp: 'yt-dlp', ffmpeg: 'FFmpeg', deno: 'Deno' };
  const missing = [];
  if (info.ytdlpVersion === 'No instalado') missing.push('ytdlp');
  if (info.ffmpegVersion === 'No instalado') missing.push('ffmpeg');
  // Deno: se descarga la copia propia de la app aunque el sistema ya tenga
  // Deno instalado por fuera (ej. para desarrollo), porque yt-dlp acá solo
  // usa la copia administrada o la empaquetada dentro del .exe (ver
  // getDenoPath() en main.js) — basarse en "denoVersion" haría creer que ya
  // está listo cuando en realidad esa versión detectada no es la que yt-dlp
  // terminaría usando. denoAvailable sí contempla ambos casos (administrado
  // o empaquetado), a diferencia de denoManaged que solo mira lo administrado.
  if (!info.denoAvailable) missing.push('deno');

  if (missing.length === 0) return;

  // En vez de abrir el panel de Actualizaciones, se avisa con un mensaje
  // discreto en la parte inferior de la ventana mientras se instala en
  // segundo plano.
  showStartupToast(
    window.i18n.t('installing_first_time', { items: missing.map((m) => missingLabels[m]).join(', ') })
  );

  const results = {};
  if (missing.includes('ytdlp')) results.ytdlp = await runYtdlpUpdate();
  if (missing.includes('ffmpeg')) results.ffmpeg = await runFfmpegUpdate();
  if (missing.includes('deno')) results.deno = await runDenoUpdate(false);

  const stillMissing = missing.filter((m) => !results[m] || !results[m].success);

  if (stillMissing.length === 0) {
    showStartupToast(window.i18n.t('ready_to_download'), 'success', 4000);
    playNotificationSoundIfEnabled();
  } else {
    showStartupToast(
      window.i18n.t('auto_install_failed', { items: stillMissing.map((m) => missingLabels[m]).join(', ') }),
      'error',
      8000
    );
  }
}

// Sincroniza el idioma real guardado en disco (fuente de verdad) con lo que
// se aplicó al vuelo desde localStorage al arrancar, por si difieren (ej.
// primer inicio en un equipo nuevo, o cambio hecho desde otra instalación).
(async function syncLanguageFromSettings() {
  try {
    const settings = await window.yoinksAPI.getSettings();
    const lang = settings && settings.language === 'en' ? 'en' : 'es';
    if (lang !== window.i18n.getLanguage()) {
      applyLanguage(lang);
    }
    if (window.yoinksAPI.setLanguage) window.yoinksAPI.setLanguage(lang);
  } catch (e) {
    // si falla, seguimos con el idioma ya aplicado desde localStorage
  }
})();

loadPresets();
checkForUpdatesSilently();
autoInstallMissingBinaries();
