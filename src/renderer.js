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

  // Etiqueta "Ya descargado": el texto y el formato de fecha dependen del
  // idioma activo, así que se vuelve a pintar (sin volver a pedir el
  // historial) cada vez que el usuario cambia de idioma.
  if (typeof renderAlreadyDownloadedBadge === 'function') {
    renderAlreadyDownloadedBadge();
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

  // Panel "Referencia de comandos" de la Terminal: la lista de comandos
  // (window.YTDLP_COMMANDS_ES / _EN) se pinta a mano con textContent y no
  // usa data-i18n, así que si el panel está abierto al cambiar de idioma
  // hay que volver a renderizarla para que categorías y descripciones
  // reflejen el idioma nuevo.
  if (
    typeof terminalReferenceOverlay !== 'undefined' &&
    terminalReferenceOverlay &&
    !terminalReferenceOverlay.classList.contains('hidden') &&
    typeof renderTerminalReferenceList === 'function'
  ) {
    renderTerminalReferenceList(terminalReferenceSearchEl ? terminalReferenceSearchEl.value : '');
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
const trimEnabledCheckbox = document.getElementById('trim-enabled');
const trimExactCheckbox = document.getElementById('trim-exact-enabled');
const trimEditorEl = document.getElementById('trim-editor');
const trimTimeRow = document.getElementById('trim-time-row');
const trimStartInput = document.getElementById('trim-start');
const trimEndInput = document.getElementById('trim-end');
const trimHintEl = document.getElementById('trim-hint');
const trimErrorEl = document.getElementById('trim-error');
const trimVideoEl = document.getElementById('trim-video');
const trimPosterEl = document.getElementById('trim-preview-poster');
const trimPlayBtn = document.getElementById('trim-preview-play');
const trimTimeLabelEl = document.getElementById('trim-preview-time');
const trimRangeEl = document.getElementById('trim-range');
const trimRangeFillEl = document.getElementById('trim-range-fill');
const trimHandleStartEl = document.getElementById('trim-handle-start');
const trimHandleEndEl = document.getElementById('trim-handle-end');
const trimRangeChaptersEl = document.getElementById('trim-range-chapters');
const alreadyDownloadedBadgeEl = document.getElementById('already-downloaded-badge');
const previewVideoBtn = document.getElementById('preview-video-btn');
const previewVideoOverlayEl = document.getElementById('preview-video-overlay');
const previewVideoElEl = document.getElementById('preview-video-el');
const previewAudioEl = document.getElementById('preview-audio-el');
const previewVideoTitleEl = document.getElementById('preview-video-title');
const previewVideoErrorEl = document.getElementById('preview-video-error');
const previewVideoCloseBtn = document.getElementById('preview-video-close-btn');
const downloadFrameEl = document.getElementById('download-frame');
const downloadListEl = document.getElementById('download-list');
let downloadListInner = downloadListEl;
const pickerDownloadBtn = document.getElementById('picker-download-btn');

// ---- Menú flotante de "Opciones avanzadas" (Cortar video, Subtítulos, Miniaturas, Capítulos) ----
const advancedOptionsBtn = document.getElementById('advanced-options-btn');
const advancedOptionsMenu = document.getElementById('advanced-options-menu');

if (advancedOptionsBtn && advancedOptionsMenu) {
  advancedOptionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = advancedOptionsMenu.classList.contains('hidden');
    advancedOptionsMenu.classList.toggle('hidden');
    advancedOptionsBtn.classList.toggle('active', isHidden);
    if (!isHidden) releaseTrimVideoStream(); // se está cerrando: soltar la conexión de la preview
  });

  document.addEventListener('click', (e) => {
    if (!advancedOptionsBtn.contains(e.target) && !advancedOptionsMenu.contains(e.target)) {
      const wasOpen = !advancedOptionsMenu.classList.contains('hidden');
      advancedOptionsMenu.classList.add('hidden');
      advancedOptionsBtn.classList.remove('active');
      if (wasOpen) releaseTrimVideoStream();
    }
  });
}


// ---- Dropdown de Preajustes en Download Frame ----
const presetMenuBtn = document.getElementById('preset-menu-btn');
const presetDropdownMenu = document.getElementById('preset-dropdown-menu');
const presetDropdownList = document.getElementById('preset-dropdown-list');
let selectedPresetForDownload = null; // índice del preajuste seleccionado para descarga
const backBtn = document.getElementById('back-btn');

// ---- Panel de Información del Video (consulta sin descargar) ----
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

// ---- Pantallas (home / picker / playlist / actividad), como en yoinks ----
const screenHome = document.getElementById('screen-home');
const screenPicker = document.getElementById('screen-picker');
const screenActivity = document.getElementById('screen-activity');
const screenSettings = document.getElementById('screen-settings');
const screenTerminal = document.getElementById('screen-terminal');

// Mide cuánto contenido real tiene la pantalla de video (título largo,
// formatos, etc.) y le pide a main.js que agrande la ventana lo necesario
// para que se vea todo sin scroll. Se llama tras poblar la pantalla y de
// nuevo tras cargar los datos del video (el título puede tardar en llegar).
// Refleja en la barra lateral cuál de las dos tarjetas ("Nueva tarea" /
// "Tareas") corresponde a la pantalla que está visible en este momento.
function updateSidebarActiveStates() {
  const sidebarNewTaskBtn = document.getElementById('sidebar-new-task');
  const sidebarTerminalBtn = document.getElementById('sidebar-terminal');
  if (sidebarNewTaskBtn) sidebarNewTaskBtn.classList.toggle('active', screenHome.classList.contains('active'));
  if (sidebarTerminalBtn) sidebarTerminalBtn.classList.toggle('active', screenTerminal.classList.contains('active'));
  if (btnActivity) btnActivity.classList.toggle('active', screenActivity.classList.contains('active'));
  if (settingsBtn) settingsBtn.classList.toggle('active', screenSettings.classList.contains('active'));
}

// Desactiva las 5 pantallas para que, al activar la nueva, no queden dos
// superpuestas (cada goTo*Screen la llama antes de activar la suya).
function deactivateAllScreens() {
  screenHome.classList.remove('active');
  screenPicker.classList.remove('active');
  screenPlaylist.classList.remove('active');
  screenActivity.classList.remove('active');
  screenSettings.classList.remove('active');
  screenTerminal.classList.remove('active');
}

function goToPickerScreen() {
  deactivateAllScreens();
  screenPicker.classList.add('active');
  updateSidebarActiveStates();
  setTimeout(() => downloadListEl.focus(), 180);
}

function goToHomeScreen() {
  deactivateAllScreens();
  screenHome.classList.add('active');
  setStatus('', '', 'picker');
  updateSidebarActiveStates();
  setTimeout(() => input.focus(), 180);
}

function goToPlaylistScreen() {
  deactivateAllScreens();
  screenPlaylist.classList.add('active');
  updateSidebarActiveStates();
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

// Elementos de la pantalla de Configuración (pestañas, como en Tareas)
const settingsBtn = document.getElementById('btn-presets');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsTabGeneral = document.getElementById('settings-tab-general');
const settingsTabDownload = document.getElementById('settings-tab-download');
const settingsTabCookies = document.getElementById('settings-tab-cookies');
const settingsTabPresets = document.getElementById('settings-tab-presets');
const settingsTabUpdates = document.getElementById('settings-tab-updates');
const settingsTabAbout = document.getElementById('settings-tab-about');
const presetsOverlay = document.getElementById('presets-overlay');
const presetsTbody = document.getElementById('presets-tbody');
const presetSiteInput = document.getElementById('preset-site');
const presetNameInput = document.getElementById('preset-name');
const presetOptionsInput = document.getElementById('preset-options');
const presetsAddBtn = document.getElementById('presets-add-btn');
const presetsResetBtn = document.getElementById('presets-reset-btn');
const presetsCancelEditBtn = document.getElementById('presets-cancel-edit-btn');
const presetsReferenceBtn = document.getElementById('presets-reference-btn');

// Elementos del panel de Terminal (ejecutar un comando de yt-dlp "en crudo")
const terminalOverlay = document.getElementById('terminal-overlay');
const terminalOutputEl = document.getElementById('terminal-output');
const terminalCommandInput = document.getElementById('terminal-command-input');
const terminalRunBtn = document.getElementById('terminal-run-btn');
const terminalClearInputBtn = document.getElementById('terminal-clear-input-btn');
const terminalClearOutputBtn = document.getElementById('terminal-clear-output-btn');
const terminalQuickCommandsEl = document.getElementById('terminal-quick-commands');
const terminalReferenceBtn = document.getElementById('terminal-reference-btn');
const terminalReferenceOverlay = document.getElementById('terminal-reference-overlay');
const terminalReferenceCloseBtn = document.getElementById('terminal-reference-close-btn');
const terminalReferenceSearchEl = document.getElementById('terminal-reference-search');
const terminalReferenceListEl = document.getElementById('terminal-reference-list');

// Elementos de Configuración de Descarga (panel ⚙ → Download)
const downloadSettingsOverlay = document.getElementById('download-settings-overlay');
const downloadSettingsSaveBtn = document.getElementById('download-settings-save-btn');
const downloadSettingsResetBtn = document.getElementById('download-settings-reset-btn');
const settingDownloadPathInput = document.getElementById('setting-download-path');
const settingPathBrowseBtn = document.getElementById('setting-path-browse-btn');
const settingOutputTemplateInput = document.getElementById('setting-output-template');
const settingCookiesSiteSelect = document.getElementById('setting-cookies-site');
const settingCookiesRemoveSiteBtn = document.getElementById('setting-cookies-remove-site-btn');
const settingNewSiteNameInput = document.getElementById('setting-new-site-name');
const settingNewSiteUrlInput = document.getElementById('setting-new-site-url');
const settingAddSiteBtn = document.getElementById('setting-add-site-btn');
const settingAddSiteError = document.getElementById('setting-add-site-error');
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
const settingRateLimitModeSelect = document.getElementById('setting-rate-limit-mode');
const settingConcurrentDownloadsSelect = document.getElementById('setting-concurrent-downloads');
const settingConcurrentFragmentsInput = document.getElementById('setting-concurrent-fragments');
const settingSubtitlesEnabledCheckbox = document.getElementById('setting-subtitles-enabled');
const settingSubtitleLangsInput = document.getElementById('setting-subtitle-langs');
const settingSubtitleModeSelect = document.getElementById('setting-subtitle-mode');
const settingSubtitlesOptionsRow = document.getElementById('setting-subtitles-options-row');
const settingSubtitleModeRow = document.getElementById('setting-subtitle-mode-row');
const settingThumbnailsEnabledCheckbox = document.getElementById('setting-thumbnails-enabled');
const settingChaptersEnabledCheckbox = document.getElementById('setting-chapters-enabled');
const settingOrganizeBySiteCheckbox = document.getElementById('setting-organize-by-site');
const settingSoundEnabledCheckbox = document.getElementById('setting-sound-enabled');
const settingSoundStyleSelect = document.getElementById('setting-sound-style');
const settingCloseBehaviorSelect = document.getElementById('setting-close-behavior');
const settingLanguageSelect = document.getElementById('setting-language');
const settingExtensionKeepInBackgroundCheckbox = document.getElementById('setting-extension-keep-in-background');

// Elementos del panel de Cookies (panel ⚙ → Cookies)
const cookiesOverlay = document.getElementById('cookies-overlay');
const cookiesSaveBtn = document.getElementById('cookies-save-btn');
const cookiesResetBtn = document.getElementById('cookies-reset-btn');

// Elementos del panel General (panel ⚙ → General)
const generalOverlay = document.getElementById('general-overlay');
const generalSaveBtn = document.getElementById('general-save-btn');
const generalResetBtn = document.getElementById('general-reset-btn');

// Elementos del panel de Actualizaciones (yt-dlp / FFmpeg)
const updatesOverlay = document.getElementById('updates-overlay');
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
const downloadsSpeedSummaryEl = document.getElementById('downloads-speed-summary');
const downloadsSpeedSummaryTextEl = document.getElementById('downloads-speed-summary-text');
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
// main.js puede reenviar el mismo link de arranque en frío varias veces
// (cada ~400ms) hasta que le confirmemos que lo aplicamos — así no importa
// si el primer envío llega antes de que este script termine de cargar.
// 'lastAppliedExtensionUrl' evita que un reenvío duplicado (que sí puede
// llegar por una condición de carrera minúscula entre el ack y el próximo
// tick del intervalo) pegue el link de nuevo y dispare handleYoink() dos
// veces. Sí queremos, en cambio, poder recibir un link *distinto* al que
// ya estábamos mostrando (por eso no es simplemente "ignorar todo").
let lastAppliedExtensionUrl = null;

function applyExtensionUrl(url) {
  console.log('[extension-debug] applyExtensionUrl llamado con', url, 'lastAppliedExtensionUrl=', lastAppliedExtensionUrl);
  if (!url || url === lastAppliedExtensionUrl) return;
  lastAppliedExtensionUrl = url;
  goToHomeScreen();
  input.value = url;
  updateClearBtnVisibility();
  setStatus(window.i18n.t('link_from_extension'), 'success', 'home');
  handleYoink();
  if (window.yoinksAPI.ackExtensionUrl) window.yoinksAPI.ackExtensionUrl();
  // Solo bloqueamos duplicados por un ratito (cubre la ventana en la que
  // main.js podría reenviar el mismo link una vez más antes de recibir el
  // ack); pasado eso, un envío nuevo del mismo video vuelve a funcionar.
  setTimeout(() => {
    if (lastAppliedExtensionUrl === url) lastAppliedExtensionUrl = null;
  }, 2000);
}

// Si ya estábamos en la pantalla de calidades (viendo otro video), primero
// volvemos a la pantalla principal para que se vea el link pegado antes de
// pasar a buscar los formatos del nuevo video.
window.yoinksAPI.onExtensionUrl((url) => {
  console.log('[extension-debug] evento extension:url recibido con', url);
  applyExtensionUrl(url);
});

// ---- Descarga directa con calidad elegida desde el navegador (popup/botón flotante) ----
// A diferencia de applyExtensionUrl() (que solo pega el link y deja el picker
// para que el usuario elija), acá la calidad ya viene decidida: se busca la
// opción equivalente entre las que arma buildDownloadOptions() (la misma
// lista que ve el picker) y se arranca la descarga al toque, sin mostrar
// ninguna pantalla intermedia — el mismo resultado que si el usuario hubiera
// pegado el link y clickeado esa fila a mano.
let lastAppliedExtensionDownloadKey = null;

// Busca en 'formatItems' (recién poblado por buildDownloadOptions) la fila
// que mejor matchea la calidad pedida. Si la altura/bitrate exacto no está
// disponible para este video en particular, cae a la más cercana en vez de
// fallar — igual que elegir manualmente "lo más parecido" en el picker.
function pickFormatItemForQuality(quality) {
  if (!quality || quality.type === 'best') {
    return formatItems.find((i) => i.isBest && !i.audioOnly) || null;
  }
  if (quality.type === 'audio') {
    const bestAudio = formatItems.find((i) => i.isBest && i.audioOnly) || formatItems.find((i) => i.audioOnly);
    if (!bestAudio) return null;
    // La extensión puede pedir un formato específico (M4A/OPUS) en vez del
    // MP3 por defecto del preset "Mejor audio disponible" — ver AUDIO_FORMATS.
    const format = quality.format && AUDIO_FORMATS.includes(quality.format) ? quality.format : 'mp3';
    if (format === bestAudio.audioFormat) return bestAudio;
    return { ...bestAudio, ext: format, audioFormat: format };
  }
  if (quality.type === 'video' && quality.height) {
    const videoTiers = formatItems.filter((i) => !i.audioOnly && !i.isPreset);
    const exact = videoTiers.find((i) => i.res === `${quality.height}p`);
    if (exact) return exact;
    // Sin esa altura exacta: la mejor disponible que no la supere: si no hay
    // ninguna menor (el video es más chico que lo pedido), la más alta que haya.
    const sorted = [...videoTiers].sort((a, b) => parseInt(b.res, 10) - parseInt(a.res, 10));
    return sorted.find((i) => parseInt(i.res, 10) <= quality.height) || sorted[0] || null;
  }
  return null;
}

async function applyExtensionDownload(payload) {
  const { url, quality, extId } = payload || {};
  if (!url) return;
  const key = `${url}::${JSON.stringify(quality || {})}`;
  // Mismo motivo que 'lastAppliedExtensionUrl' en applyExtensionUrl(): evita
  // procesar dos veces el mismo pedido si main.js llegara a reenviarlo.
  if (key === lastAppliedExtensionDownloadKey) return;
  lastAppliedExtensionDownloadKey = key;
  // Si esto vino del link de protocolo en frío (main.js reintenta cada
  // ~400ms hasta por ~6s — ver startPendingUrlDelivery), confirmamos acá
  // para que deje de reenviarlo. Sin esto, un reenvío que llegara pasados
  // los 2s de abajo (dedupe local ya vencido) dispararía la misma descarga
  // dos veces.
  if (window.yoinksAPI.ackExtensionUrl) window.yoinksAPI.ackExtensionUrl();
  setTimeout(() => {
    if (lastAppliedExtensionDownloadKey === key) lastAppliedExtensionDownloadKey = null;
  }, 2000);

  goToHomeScreen();
  currentUrl = url;
  input.value = url;
  updateClearBtnVisibility();
  setStatus(window.i18n.t('searching_formats'), 'loading', 'home');

  try {
    const info = await withRetries(() => window.yoinksAPI.fetchFormats(url), {
      maxRetries: 2,
      delayMs: 1500,
      onRetry: (attempt, total) =>
        setStatus(window.i18n.t('no_response_retrying', { attempt, total }), 'loading', 'home'),
    });
    currentVideoInfo = info;
    await checkIfAlreadyDownloaded(info, url);
    resetTrimSection();
    buildDownloadOptions(info);

    const opt = pickFormatItemForQuality(quality);
    if (!opt) {
      // No se pudo resolver ninguna fila razonable (caso raro): mostramos el
      // picker igual que con un link pegado a mano, para que el usuario elija.
      renderVideoMeta(info);
      renderDownloadList();
      setStatus('', '', 'home');
      currentPickerStatusOwner = null;
      setStatus('', '', 'picker');
      goToPickerScreen();
      return;
    }

    setStatus('', '', 'home');
    // La descarga vino de la extensión con una calidad ya elegida (no del
    // picker): abrimos el panel de Actividad en "Descargas en curso" apenas
    // arranca (sin esperar a que termine, ver comentario abajo), para que
    // se vea entrar sin que el usuario tenga que ir a buscarlo.
    startDownload(opt, { extId });
    goToActivityScreen('downloads');
  } catch (err) {
    setStatus(window.i18n.t('could_not_read_link', { error: err.message }), 'error', 'home');
  }
}

window.yoinksAPI.onExtensionDownload((payload) => {
  applyExtensionDownload(payload);
});

// Si la app se acaba de abrir a partir de un link "ytdlpminimalist://..."
// (el usuario le dio "Descargar" en la extensión sin tener la app abierta),
// lo pedimos apenas terminamos de inicializar en vez de esperar a que
// main.js nos lo empuje justo a tiempo — así no importa si el renderer
// tarda un poco más en arrancar, el link no se pierde.
(async function checkPendingExtensionUrl() {
  try {
    const pending = await window.yoinksAPI.getPendingExtensionUrl();
    if (!pending) return;
    // Con calidad: mismo camino que un pedido de descarga directa (arranca
    // sola, sin picker). Sin calidad: el camino de siempre, pegar el link.
    if (pending.quality) {
      applyExtensionDownload({ url: pending.url, quality: pending.quality, extId: pending.extId });
    } else {
      applyExtensionUrl(pending.url);
    }
  } catch (e) {
    // No había link pendiente, o falló la consulta; no hacemos nada.
  }
})();

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
    await checkIfAlreadyDownloaded(info, url);
    renderVideoMeta(info);
    resetTrimSection();
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

// ================= "CORTAR VIDEO" (picker de un solo video) =================
// Convierte "hh:mm:ss" / "mm:ss" / "ss" a segundos. Devuelve null si el
// formato no matchea (dígitos y ":" nada más, 1 a 3 grupos).
function parseTimeToSeconds(value) {
  const str = (value || '').trim();
  if (!str) return null;
  if (!/^\d{1,}(:\d{1,2}){0,2}$/.test(str)) return null;
  const parts = str.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  // Los segundos/minutos "de más" (ej. "90" en mm:ss) son válidos para
  // yt-dlp, así que no los rechazamos, solo sumamos por posición.
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + p;
  return seconds;
}

// Formatea segundos a "hh:mm:ss" (el formato que espera --download-sections)
function secondsToTimestamp(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
}

function resetTrimSection() {
  trimEnabledCheckbox.checked = false;
  trimStartInput.value = '';
  trimEndInput.value = '';
  trimExactCheckbox.checked = true; // por defecto, corte exacto (comportamiento de siempre)
  updateTrimRowsVisibility();
  setTrimError('');
  resetTrimPreview(); // el video cambió: soltamos el <video> anterior y lo re-armamos recién si lo abren
}

function updateTrimRowsVisibility() {
  const enabled = trimEnabledCheckbox.checked;
  trimEditorEl.classList.toggle('hidden', !enabled);
  trimHintEl.classList.toggle('hidden', !enabled);
  if (!enabled) {
    setTrimError('');
    pauseTrimPreview();
  } else {
    initTrimPreview(); // carga perezosa: recién arma el preview la primera vez que se activa
  }
}

function setTrimError(message) {
  trimErrorEl.textContent = message || '';
  trimErrorEl.classList.toggle('hidden', !message);
}

trimEnabledCheckbox.addEventListener('change', updateTrimRowsVisibility);

// ---- Editor visual de corte: preview del video + barra de rango arrastrable ----
// (ver captura de referencia: video arriba, barra con dos manijas abajo, y
// los mismos inputs "Desde"/"Hasta" de siempre sincronizados con la barra)
let trimDuration = 0; // duración total del video en segundos (info.duration, o video.duration si el primero no vino)
let trimRangeStart = 0;
let trimRangeEnd = 0;
let trimActiveHandle = null; // 'start' | 'end' mientras se arrastra una manija
let trimPreviewInitialized = false; // evita re-armar el <video> cada vez que se destilda/tilda el checkbox

// yt-dlp trae, dentro de "formats", varios con "url" directa http/https que
// un <video>/<audio> nativo puede reproducir sin librerías extra (una fuente
// HLS/DASH tipo m3u8/mpd no serviría acá). El detalle es que la mayoría de
// los sitios (YouTube incluido) NO traen progresivo (video+audio en un solo
// archivo) arriba de 720p: todo lo de 1080p para arriba viene separado en
// un formato solo-video + uno solo-audio (DASH). Por eso hay dos funciones:
// una para el editor de "Cortar" (el <video> ahí va silenciado, así que
// no importa si el formato trae audio) y otra para el modal "▶
// Previsualizar" (necesita audio, así que arma la mejor combinación
// video-only + audio-only cuando eso da más calidad que el mejor progresivo).

const PREVIEW_MAX_HEIGHT = 720; // tope para no pedir un stream pesado solo para una vista previa

function isPlayableStreamProtocol(f) {
  return !!(f && f.url && (!f.protocol || f.protocol === 'https' || f.protocol === 'http'));
}
// avc1/h264, vp9 y av01 son los códecs de video que Chromium reproduce
// nativamente; mp4a/aac y opus, los de audio.
function isPlayableVideoCodec(vcodec) {
  return !!vcodec && /^(avc1|h264|vp0?9|av01)/i.test(vcodec);
}
function isPlayableAudioCodec(acodec) {
  return !!acodec && /^(mp4a|aac|opus)/i.test(acodec);
}

// Entre los formatos candidatos, el de mayor resolución sin pasarse del
// tope; si ninguno entra en el tope (ej. el video solo viene en 4K+), nos
// quedamos con el más liviano de los que hay en vez de pedir un stream
// gigante para una vista previa.
function pickBestByHeight(formats) {
  if (!formats.length) return null;
  const withinCap = formats.filter((f) => !f.height || f.height <= PREVIEW_MAX_HEIGHT);
  if (withinCap.length) return withinCap.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
  return formats.sort((a, b) => (a.height || 9e9) - (b.height || 9e9))[0];
}

function pickBestAudio(formats) {
  if (!formats.length) return null;
  return formats.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
}

// Le avisa al proceso principal qué headers exactos necesita el pedido HTTP
// de esta URL (ver 'preview:set-headers' en main.js). Algunos sitios
// (Bilibili es el caso típico) firman el link del video/audio, pero además
// el CDN exige un Referer/User-Agent puntual en el pedido o devuelve 403 —
// sin importar que la URL en sí sea válida y aunque haya cookies cargadas.
// yt-dlp ya sabe qué headers hacen falta para cada formato (los trae en
// "http_headers" dentro del JSON de "-J"), pero un <video>/<audio> nativo no
// tiene forma de mandar headers custom en su propio pedido: por eso el main
// process los inyecta por nosotros justo antes de que salga la petición.
function registerPreviewHeaders(url, httpHeaders) {
  if (!url || !httpHeaders || typeof httpHeaders !== 'object') return;
  const headers = {};
  Object.keys(httpHeaders).forEach((key) => {
    const value = httpHeaders[key];
    if (typeof value === 'string' && value) headers[key] = value;
  });
  if (!Object.keys(headers).length) return;
  if (window.yoinksAPI && window.yoinksAPI.setPreviewHeaders) {
    window.yoinksAPI.setPreviewHeaders([{ url, headers }]);
  }
}

// Editor de "Cortar": el <video> va silenciado (ver atributo "muted" en el
// HTML), así que da igual si el formato elegido trae audio o no; solo
// buscamos la mejor imagen disponible.
function pickPreviewFormatUrl(info) {
  if (!info || !Array.isArray(info.formats)) return null;
  const videoCandidates = info.formats.filter(
    (f) => isPlayableStreamProtocol(f) && f.vcodec && f.vcodec !== 'none' && isPlayableVideoCodec(f.vcodec)
  );
  const best = pickBestByHeight(videoCandidates);
  if (!best) return null;
  registerPreviewHeaders(best.url, best.http_headers);
  return best.url;
}

// Modal "▶ Previsualizar": acá sí hace falta escuchar el audio. Devuelve
// { videoUrl, audioUrl, height }. audioUrl viene null cuando el video
// elegido ya trae el audio incluido (formato progresivo).
function pickPreviewSource(info) {
  if (!info || !Array.isArray(info.formats)) return null;
  const hasVideo = (f) => f.vcodec && f.vcodec !== 'none' && isPlayableVideoCodec(f.vcodec);
  const hasAudio = (f) => f.acodec && f.acodec !== 'none' && isPlayableAudioCodec(f.acodec);
  const candidates = info.formats.filter(isPlayableStreamProtocol);

  const progressive = candidates.filter((f) => hasVideo(f) && hasAudio(f));
  const videoOnly = candidates.filter((f) => hasVideo(f) && !hasAudio(f));
  const audioOnly = candidates.filter((f) => !hasVideo(f) && hasAudio(f));

  const bestProgressive = pickBestByHeight(progressive);
  const bestVideoOnly = pickBestByHeight(videoOnly);
  const bestAudio = pickBestAudio(audioOnly);

  // Preferimos la combinación video-only + audio-only si nos da mejor
  // resolución que el mejor progresivo disponible (el caso típico: sin
  // esto, la vista previa quedaba pegada a los ~360-720p del progresivo).
  if (bestVideoOnly && bestAudio && (bestVideoOnly.height || 0) > (bestProgressive ? bestProgressive.height || 0 : 0)) {
    registerPreviewHeaders(bestVideoOnly.url, bestVideoOnly.http_headers);
    registerPreviewHeaders(bestAudio.url, bestAudio.http_headers);
    return { videoUrl: bestVideoOnly.url, audioUrl: bestAudio.url, height: bestVideoOnly.height || null };
  }
  if (bestProgressive) {
    registerPreviewHeaders(bestProgressive.url, bestProgressive.http_headers);
    return { videoUrl: bestProgressive.url, audioUrl: null, height: bestProgressive.height || null };
  }
  if (bestVideoOnly) {
    // No hay pista de audio disponible: mejor mostrar la imagen sin sonido
    // que no mostrar nada.
    registerPreviewHeaders(bestVideoOnly.url, bestVideoOnly.http_headers);
    return { videoUrl: bestVideoOnly.url, audioUrl: null, height: bestVideoOnly.height || null };
  }
  return null;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function initTrimPreview() {
  if (trimPreviewInitialized) return;
  trimPreviewInitialized = true;

  trimDuration = (currentVideoInfo && currentVideoInfo.duration) || 0;
  trimRangeStart = 0;
  trimRangeEnd = trimDuration || 0;

  const posterUrl = currentVideoInfo ? pickThumbnailUrl(currentVideoInfo) : null;
  if (posterUrl) {
    trimPosterEl.src = posterUrl;
    trimPosterEl.classList.remove('hidden');
  }

  const previewUrl = pickPreviewFormatUrl(currentVideoInfo);
  if (previewUrl) {
    trimVideoEl.src = previewUrl;
    trimVideoEl.classList.remove('hidden');
    trimPlayBtn.classList.remove('hidden');
    trimTimeLabelEl.classList.remove('hidden');
  }

  if (trimDuration) {
    renderTrimRange();
  }
  renderTrimChapterMarkers();
  updateTrimTimeLabel();
}

function resetTrimPreview() {
  trimPreviewInitialized = false;
  trimDuration = 0;
  trimRangeStart = 0;
  trimRangeEnd = 0;
  trimActiveHandle = null;
  pauseTrimPreview();
  trimVideoEl.removeAttribute('src');
  trimVideoEl.load();
  trimVideoEl.classList.add('hidden');
  trimPosterEl.removeAttribute('src');
  trimPosterEl.classList.add('hidden');
  trimPlayBtn.classList.add('hidden');
  trimTimeLabelEl.classList.add('hidden');
  trimPlayBtn.innerHTML = '&#9654;';
  trimHandleStartEl.style.left = '0%';
  trimHandleEndEl.style.left = '100%';
  trimRangeFillEl.style.left = '0%';
  trimRangeFillEl.style.width = '100%';
  trimRangeChaptersEl.innerHTML = '';
  trimTimeLabelEl.textContent = '0:00 / 0:00';
}

function pauseTrimPreview() {
  if (trimVideoEl && !trimVideoEl.paused) trimVideoEl.pause();
}

// Suelta la conexión de red de la preview (pausa + le saca el "src") sin
// tocar el tramo elegido (trimRangeStart/End) ni los inputs. La usamos al
// cerrar "Opciones avanzadas" y, sobre todo, justo antes de arrancar una
// descarga: mantener el <video> de la preview reproduciendo/buffereando el
// mismo link (a veces el mismo host/sesión que va a usar yt-dlp, ej.
// googlevideo) puede competir por la conexión y hacer que la descarga real
// quede pegada en 0%. Se re-arma solo, sin volver a consultar el video, la
// próxima vez que se abra el menú (initTrimPreview vuelve a poner el src).
function releaseTrimVideoStream() {
  pauseTrimPreview();
  if (trimVideoEl.hasAttribute('src')) {
    trimVideoEl.removeAttribute('src');
    trimVideoEl.load();
  }
  trimVideoEl.classList.add('hidden');
  trimPlayBtn.classList.add('hidden');
  trimTimeLabelEl.classList.add('hidden');
  trimPlayBtn.innerHTML = '&#9654;';
  trimPreviewInitialized = false;
}

// Si el link no se puede reproducir directo (CORS, geo, requiere cookies,
// etc.) nos quedamos solo con la miniatura estática y la barra de rango
// sigue funcionando igual, solo que sin "vista previa" del cuadro exacto.
trimVideoEl.addEventListener('error', () => {
  trimVideoEl.classList.add('hidden');
  trimPlayBtn.classList.add('hidden');
  trimTimeLabelEl.classList.add('hidden');
});

trimVideoEl.addEventListener('loadedmetadata', () => {
  if (!trimDuration && trimVideoEl.duration) {
    trimDuration = trimVideoEl.duration;
    trimRangeEnd = trimDuration;
    renderTrimRange();
    renderTrimChapterMarkers();
  }
  updateTrimTimeLabel();
});

trimVideoEl.addEventListener('timeupdate', () => {
  updateTrimTimeLabel();
  // Mientras reproduce la preview, la encerramos dentro del tramo elegido
  // (igual que un editor de recorte de verdad) en vez de seguir de largo.
  if (!trimVideoEl.paused && trimVideoEl.currentTime >= trimRangeEnd) {
    trimVideoEl.currentTime = trimRangeStart;
  }
});

trimVideoEl.addEventListener('play', () => {
  trimPlayBtn.innerHTML = '&#10074;&#10074;';
});
trimVideoEl.addEventListener('pause', () => {
  trimPlayBtn.innerHTML = '&#9654;';
});

function updateTrimTimeLabel() {
  const current = trimVideoEl && !trimVideoEl.paused ? trimVideoEl.currentTime : trimRangeStart;
  trimTimeLabelEl.textContent = `${formatClock(current)} / ${formatClock(trimDuration)}`;
}

trimPlayBtn.addEventListener('click', () => {
  if (trimVideoEl.classList.contains('hidden')) return;
  if (trimVideoEl.paused) {
    if (trimVideoEl.currentTime < trimRangeStart || trimVideoEl.currentTime >= trimRangeEnd) {
      trimVideoEl.currentTime = trimRangeStart;
    }
    trimVideoEl.play().catch(() => {});
  } else {
    trimVideoEl.pause();
  }
});

// Dibuja las manijas y el tramo resaltado según trimRangeStart/trimRangeEnd,
// y refleja los mismos valores en los inputs "Desde"/"Hasta" de toda la vida.
function renderTrimRange() {
  if (!trimDuration) return;
  const startPct = Math.min(100, Math.max(0, (trimRangeStart / trimDuration) * 100));
  const endPct = Math.min(100, Math.max(0, (trimRangeEnd / trimDuration) * 100));
  trimHandleStartEl.style.left = `${startPct}%`;
  trimHandleEndEl.style.left = `${endPct}%`;
  trimRangeFillEl.style.left = `${startPct}%`;
  trimRangeFillEl.style.width = `${Math.max(0, endPct - startPct)}%`;
  trimStartInput.value = secondsToTimestamp(trimRangeStart);
  trimEndInput.value = secondsToTimestamp(trimRangeEnd);
  setTrimError('');
}

// Dibuja una marquita por cada división entre capítulos (si el video los
// tiene, según "chapters" que viene en la info de yt-dlp), para ubicarse
// sin tener que ir tanteando con la barra.
function renderTrimChapterMarkers() {
  trimRangeChaptersEl.innerHTML = '';
  const chapters =
    currentVideoInfo && Array.isArray(currentVideoInfo.chapters) ? currentVideoInfo.chapters : [];
  if (!trimDuration || !chapters.length) return;

  chapters.forEach((chapter) => {
    const start = chapter && chapter.start_time;
    // El inicio del primer capítulo (0) y el final del video no se marcan,
    // solo las divisiones intermedias entre un capítulo y el siguiente.
    if (!Number.isFinite(start) || start <= 0 || start >= trimDuration) return;
    const mark = document.createElement('div');
    mark.className = 'trim-chapter-mark';
    mark.style.left = `${(start / trimDuration) * 100}%`;
    if (chapter.title) mark.title = chapter.title;
    trimRangeChaptersEl.appendChild(mark);
  });
}

function seekTrimPreview(seconds) {
  if (trimVideoEl.classList.contains('hidden')) return;
  pauseTrimPreview();
  trimVideoEl.currentTime = seconds;
}

function ratioFromPointerEvent(e) {
  const rect = trimRangeEl.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
}

function onTrimHandlePointerMove(e) {
  if (!trimActiveHandle || !trimDuration) return;
  const seconds = ratioFromPointerEvent(e) * trimDuration;
  if (trimActiveHandle === 'start') {
    trimRangeStart = Math.min(seconds, trimRangeEnd - 1);
    trimRangeStart = Math.max(0, trimRangeStart);
  } else {
    trimRangeEnd = Math.max(seconds, trimRangeStart + 1);
    trimRangeEnd = Math.min(trimDuration, trimRangeEnd);
  }
  renderTrimRange();
  seekTrimPreview(trimActiveHandle === 'start' ? trimRangeStart : trimRangeEnd);
}

function onTrimHandlePointerUp() {
  trimActiveHandle = null;
  document.removeEventListener('pointermove', onTrimHandlePointerMove);
  document.removeEventListener('pointerup', onTrimHandlePointerUp);
}

function beginTrimHandleDrag(handle) {
  if (!trimDuration) return;
  trimActiveHandle = handle;
  document.addEventListener('pointermove', onTrimHandlePointerMove);
  document.addEventListener('pointerup', onTrimHandlePointerUp);
}

trimHandleStartEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  beginTrimHandleDrag('start');
});
trimHandleEndEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  beginTrimHandleDrag('end');
});

// Click directo sobre la barra (fuera de las manijas): movemos la manija más cercana ahí.
trimRangeEl.addEventListener('pointerdown', (e) => {
  if (!trimDuration) return;
  if (e.target === trimHandleStartEl || e.target === trimHandleEndEl) return;
  const seconds = ratioFromPointerEvent(e) * trimDuration;
  const distStart = Math.abs(seconds - trimRangeStart);
  const distEnd = Math.abs(seconds - trimRangeEnd);
  if (distStart <= distEnd) {
    trimRangeStart = Math.min(seconds, trimRangeEnd - 1);
  } else {
    trimRangeEnd = Math.max(seconds, trimRangeStart + 1);
  }
  renderTrimRange();
  seekTrimPreview(seconds);
});

// Si el usuario escribe a mano en "Desde"/"Hasta", movemos las manijas para que calcen.
function syncTrimHandlesFromInputs() {
  if (!trimDuration) return;
  const startSeconds = parseTimeToSeconds(trimStartInput.value);
  const endSeconds = parseTimeToSeconds(trimEndInput.value);
  if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) return;
  trimRangeStart = Math.min(Math.max(0, startSeconds), trimDuration);
  trimRangeEnd = Math.min(Math.max(trimRangeStart + 1, endSeconds), trimDuration);
  renderTrimRange();
}

trimStartInput.addEventListener('change', syncTrimHandlesFromInputs);
trimEndInput.addEventListener('change', syncTrimHandlesFromInputs);

// Valida los campos "Desde"/"Hasta" y devuelve { start, end } en "hh:mm:ss"
// listos para mandar a main.js, o null si el corte está desactivado.
// Lanza un Error con el mensaje ya traducido si algo no es válido, para que
// el llamador lo muestre en el status en vez de arrancar una descarga rota.
function resolveTrimSection() {
  if (!trimEnabledCheckbox.checked) return null;

  const startStr = trimStartInput.value.trim();
  const endStr = trimEndInput.value.trim();
  if (!startStr || !endStr) {
    throw new Error(window.i18n.t('err_trim_required'));
  }

  const startSeconds = parseTimeToSeconds(startStr);
  const endSeconds = parseTimeToSeconds(endStr);
  if (startSeconds === null || endSeconds === null) {
    throw new Error(window.i18n.t('err_trim_invalid_format'));
  }
  if (endSeconds <= startSeconds) {
    throw new Error(window.i18n.t('err_trim_end_before_start'));
  }
  const totalDuration = currentVideoInfo && currentVideoInfo.duration;
  if (totalDuration && startSeconds >= totalDuration) {
    throw new Error(
      window.i18n.t('err_trim_beyond_duration', { duration: formatDuration(totalDuration) })
    );
  }

  return {
    start: secondsToTimestamp(startSeconds),
    end: secondsToTimestamp(endSeconds),
    exact: trimExactCheckbox.checked,
  };
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

// ================= "YA DESCARGADO" (detecta si el video pegado ya se bajó antes) =================

// Entrada del historial que coincide con el video actualmente cargado en el
// picker (o null si no se encontró ninguna). Se recalcula cada vez que se
// consulta un link nuevo y se vuelve a pintar si cambia el idioma.
let lastDownloadedMatch = null;

// Busca en el historial una descarga EXITOSA del mismo video. Primero
// compara por id + extractor (así reconoce el mismo video aunque el usuario
// haya pegado una URL distinta, ej. youtu.be/xxx vs youtube.com/watch?v=xxx).
// Si el video actual o alguna entrada vieja del historial no tienen esos
// datos (guardados antes de esta función), cae a comparar la URL tal cual.
async function checkIfAlreadyDownloaded(info, url) {
  lastDownloadedMatch = null;
  try {
    const history = (await window.yoinksAPI.listHistory()) || [];
    const videoId = info && info.id;
    const extractorKey = info && info.extractor_key;
    lastDownloadedMatch =
      history.find((h) => {
        if (!h || h.status !== 'success') return false;
        if (videoId && extractorKey && h.videoId && h.extractorKey) {
          return h.videoId === videoId && h.extractorKey === extractorKey;
        }
        return h.url === url;
      }) || null;
  } catch (e) {
    lastDownloadedMatch = null;
  }
}

// Pinta (o esconde) la etiqueta "Ya descargado" según lastDownloadedMatch.
// Separado de la búsqueda en el historial para poder re-traducir la fecha
// sin volver a pedirle el historial completo al proceso principal cada vez
// que cambia el idioma.
function renderAlreadyDownloadedBadge() {
  if (!alreadyDownloadedBadgeEl) return;
  // La visibilidad de la fila (.already-downloaded-row) ya no se decide acá:
  // ahora también puede contener el botón "▶ Previsualizar" en streaming
  // aunque el video no esté descargado, así que la resuelve
  // updatePreviewVideoButton() combinando ambas partes.
  if (!lastDownloadedMatch) {
    alreadyDownloadedBadgeEl.classList.add('hidden');
    alreadyDownloadedBadgeEl.classList.remove('clickable');
    alreadyDownloadedBadgeEl.textContent = '';
    alreadyDownloadedBadgeEl.removeAttribute('title');
    alreadyDownloadedBadgeEl.onclick = null;
    return;
  }
  let dateLabel = '';
  if (lastDownloadedMatch.date) {
    const d = new Date(lastDownloadedMatch.date);
    if (!isNaN(d.getTime())) {
      dateLabel = d.toLocaleDateString(window.i18n.getLanguage() === 'en' ? 'en-US' : 'es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    }
  }
  alreadyDownloadedBadgeEl.textContent = dateLabel
    ? `${window.i18n.t('already_downloaded')} · ${dateLabel}`
    : window.i18n.t('already_downloaded');
  alreadyDownloadedBadgeEl.classList.remove('hidden');

  // Si el historial guardó la ruta del archivo, la etiqueta se vuelve
  // clickeable y abre/selecciona ese archivo en el explorador (mismo
  // comportamiento que "Mostrar en carpeta" del resto de la app).
  const filePath = lastDownloadedMatch.path || null;
  if (filePath) {
    alreadyDownloadedBadgeEl.classList.add('clickable');
    alreadyDownloadedBadgeEl.title = window.i18n.t('already_downloaded_open_hint');
    alreadyDownloadedBadgeEl.onclick = () => window.yoinksAPI.showInFolder(filePath);
  } else {
    alreadyDownloadedBadgeEl.classList.remove('clickable');
    alreadyDownloadedBadgeEl.removeAttribute('title');
    alreadyDownloadedBadgeEl.onclick = null;
  }
}

// ---- Modal de previsualización: reproduce el video en streaming dentro de la app ----
// (mismo criterio que el editor de corte: usamos el link directo http/https
// que yt-dlp trae en "formats", así no hace falta tener el archivo descargado.
// La diferencia es que acá puede venir en dos partes -video-only + audio-only-
// cuando esa combinación da mejor calidad que el progresivo; ver pickPreviewSource).
function openVideoPreview(source, title) {
  previewVideoTitleEl.textContent = title || '';
  previewVideoErrorEl.classList.add('hidden');
  previewVideoElEl.classList.remove('hidden');
  previewVideoElEl.src = source.videoUrl;

  if (source.audioUrl) {
    previewAudioEl.src = source.audioUrl;
    previewAudioEl.currentTime = 0;
    previewAudioEl.volume = previewVideoElEl.volume;
    previewAudioEl.muted = previewVideoElEl.muted;
  } else {
    // Formato progresivo (o sin audio disponible): el audio ya viene
    // incluido en el <video> o no existe, así que no necesitamos el <audio>
    // en paralelo.
    previewAudioEl.removeAttribute('src');
    previewAudioEl.load();
  }

  previewVideoOverlayEl.classList.remove('hidden');
  previewVideoElEl.play().catch(() => {}); // autoplay puede rechazarse en algunos casos; no es un error real
}

function closeVideoPreview() {
  previewVideoOverlayEl.classList.add('hidden');
  // Soltar el <video>/<audio> (pausa + src vacío) para no dejar la conexión
  // abierta ni el audio sonando de fondo una vez cerrado el modal.
  previewVideoElEl.pause();
  previewVideoElEl.removeAttribute('src');
  previewVideoElEl.load();
  previewAudioEl.pause();
  previewAudioEl.removeAttribute('src');
  previewAudioEl.load();
}

previewVideoElEl.addEventListener('error', () => {
  // El link puede haber expirado, requerir cookies, o (si es el archivo
  // local de una versión anterior) haberse movido/borrado.
  previewVideoElEl.classList.add('hidden');
  previewVideoErrorEl.classList.remove('hidden');
});

// ---- Sincronización video (mudo si es video-only) + audio en paralelo ----
// Cuando pickPreviewSource() combinó un formato video-only con uno
// audio-only, el <video> no tiene pista de audio propia: todo el sonido
// real sale del <audio> oculto, así que hay que llevarlo de la mano en
// play/pausa/salto/volumen. Si el formato era progresivo (o sin audio),
// previewAudioEl.src queda vacío y estos handlers no hacen nada.
previewVideoElEl.addEventListener('play', () => {
  if (previewAudioEl.src) previewAudioEl.play().catch(() => {});
});
previewVideoElEl.addEventListener('pause', () => {
  if (previewAudioEl.src) previewAudioEl.pause();
});
previewVideoElEl.addEventListener('seeking', () => {
  if (previewAudioEl.src) previewAudioEl.currentTime = previewVideoElEl.currentTime;
});
previewVideoElEl.addEventListener('timeupdate', () => {
  // Corrección de deriva: si se desalinearon más de 300ms (buffering
  // distinto en cada stream), volvemos a alinear el audio al video.
  if (previewAudioEl.src && Math.abs(previewAudioEl.currentTime - previewVideoElEl.currentTime) > 0.3) {
    previewAudioEl.currentTime = previewVideoElEl.currentTime;
  }
});
previewVideoElEl.addEventListener('volumechange', () => {
  // El control de volumen/mute nativo del <video> no afecta al <audio>
  // oculto por sí solo (son elementos distintos), así que lo replicamos.
  if (previewAudioEl.src) {
    previewAudioEl.volume = previewVideoElEl.volume;
    previewAudioEl.muted = previewVideoElEl.muted;
  }
});
previewVideoElEl.addEventListener('ratechange', () => {
  if (previewAudioEl.src) previewAudioEl.playbackRate = previewVideoElEl.playbackRate;
});
previewVideoElEl.addEventListener('ended', () => {
  if (previewAudioEl.src) previewAudioEl.pause();
});

previewVideoCloseBtn.addEventListener('click', closeVideoPreview);
previewVideoOverlayEl.addEventListener('click', (e) => {
  if (e.target === previewVideoOverlayEl) closeVideoPreview(); // clic afuera del panel cierra, como el resto de los modales
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !previewVideoOverlayEl.classList.contains('hidden')) closeVideoPreview();
});

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
  renderAlreadyDownloadedBadge();
  updatePreviewVideoButton();
}

// "▶ Previsualizar" ya no depende de tener el archivo descargado: igual que
// en el editor de corte, usamos el link directo que yt-dlp trae en
// "formats" para reproducir el video en streaming dentro del modal, sin
// tener que descargarlo primero. Se recalcula cada vez que cambia
// currentVideoInfo (nueva consulta de link).
function updatePreviewVideoButton() {
  const source = pickPreviewSource(currentVideoInfo);
  if (source) {
    previewVideoBtn.classList.remove('hidden');
    previewVideoBtn.onclick = () =>
      openVideoPreview(source, (currentVideoInfo && currentVideoInfo.title) || videoTitleEl.textContent);
  } else {
    previewVideoBtn.classList.add('hidden');
    previewVideoBtn.onclick = null;
  }
  // La fila se muestra si hay algo que mostrar en ella (badge "Ya
  // descargado" y/o el botón de previsualizar), y se esconde solo si ambos
  // están vacíos.
  const rowEl = previewVideoBtn.parentElement; // .already-downloaded-row
  if (rowEl) {
    const showRow = !!source || !alreadyDownloadedBadgeEl.classList.contains('hidden');
    rowEl.classList.toggle('hidden', !showRow);
  }
}

// ================= INFORMACIÓN DEL VIDEO (sin descargar) =================
// (función conservada por si se vuelve a exponer desde otro lugar de la UI)

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
videoInfoDownloadBtn.addEventListener('click', async () => {
  if (!videoInfoContext) return;
  closeVideoInfoPanel();

  if (videoInfoContext.type === 'playlist') {
    renderPlaylist(videoInfoContext.result);
    goToPlaylistScreen();
    return;
  }

  currentUrl = videoInfoContext.url;
  currentVideoInfo = videoInfoContext.info;
  await checkIfAlreadyDownloaded(videoInfoContext.info, videoInfoContext.url);
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

// Formato de salida de audio que "corresponde" a la pista fuente detectada,
// igual criterio que containerExt para video: si la fuente ya viene en un
// formato que soportamos (AUDIO_FORMATS), se usa ese por defecto en vez de
// forzar siempre mp3 — evita una recodificación innecesaria cuando yt-dlp
// puede quedarse con el archivo original (ej. fuente ya es m4a u opus).
function normalizeAudioExt(f) {
  if (!f) return 'mp3';
  const ext = String(f.ext || '').toLowerCase();
  const acodec = String(f.acodec || '').toLowerCase();
  if (ext === 'm4a' || acodec.startsWith('mp4a')) return 'm4a';
  if (ext === 'opus' || acodec.startsWith('opus')) return 'opus';
  if (ext === 'mp3' || acodec.startsWith('mp3')) return 'mp3';
  return 'mp3';
}

// Nombre corto y reconocible del códec de video a partir del string crudo que
// reporta yt-dlp (ej. "avc1.640028" -> "H264", "av01.0.05M.08" -> "AV1").
function normalizeVideoCodec(vcodec) {  if (!vcodec || vcodec === 'none') return null;
  const v = String(vcodec).toLowerCase();
  if (v.startsWith('av01') || v.startsWith('av1')) return 'AV1';
  if (v.startsWith('vp09') || v.startsWith('vp9')) return 'VP9';
  if (v.startsWith('vp8')) return 'VP8';
  if (v.startsWith('hev1') || v.startsWith('hvc1') || v.startsWith('h265')) return 'H265';
  if (v.startsWith('avc1') || v.startsWith('h264')) return 'H264';
  const base = v.split('.')[0];
  return base ? base.toUpperCase() : null;
}

// Orden de preferencia al listar códecs en el select (compatibilidad primero).
const CODEC_DISPLAY_ORDER = ['H264', 'AV1', 'VP9', 'H265', 'VP8'];
function codecSortIndex(label) {
  const idx = CODEC_DISPLAY_ORDER.indexOf(label);
  return idx === -1 ? CODEC_DISPLAY_ORDER.length : idx;
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

  // ---- Variantes de códec disponibles por altura (para el selector de códec) ----
  // Mismo criterio de "mejor variante" que bestByHeight de arriba, pero agrupado
  // también por códec (H264/AV1/VP9/...), para no perder la de mayor calidad
  // real dentro de cada códec al ofrecer el cambio.
  const codecsByHeight = new Map(); // height -> Map(codecLabel -> { format, hasRealSize, qualityScore })
  for (const f of videoFormats) {
    const codecLabel = normalizeVideoCodec(f.vcodec);
    if (!codecLabel) continue;
    if (!codecsByHeight.has(f.height)) codecsByHeight.set(f.height, new Map());
    const m = codecsByHeight.get(f.height);
    const hasRealSize = !!(f.filesize || f.filesize_approx);
    const qualityScore = f.tbr || f.vbr || (f.filesize || f.filesize_approx || 0) / 1000;
    const current = m.get(codecLabel);
    const isBetter =
      !current ||
      (hasRealSize && !current.hasRealSize) ||
      (hasRealSize === current.hasRealSize && qualityScore > current.qualityScore);
    if (isBetter) m.set(codecLabel, { format: f, hasRealSize, qualityScore });
  }

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

    // Contenedor de salida: se usa el que realmente reporta la fuente para
    // ESE stream (ej. YouTube entrega webm en varias resoluciones, mp4 en
    // otras). Si el contenedor reportado no es uno de los que soportamos
    // (CONTAINER_FORMATS), se cae a mp4 por defecto. El usuario igual puede
    // cambiarlo con el select de la fila.
    const containerExt = CONTAINER_FORMATS.includes(f.ext) ? f.ext : 'mp4';

    // Variantes de códec disponibles para ESTA altura (ej. YouTube suele
    // ofrecer H264, VP9 y AV1 en la misma resolución). Si hay más de una,
    // se arma la lista para el select; si solo hay una, se muestra como
    // texto fijo (no hace falta elegir nada).
    const heightCodecs = codecsByHeight.get(f.height);
    let codecOptions = [];
    if (heightCodecs && heightCodecs.size > 1) {
      codecOptions = [...heightCodecs.entries()]
        .sort((a, b) => codecSortIndex(a[0]) - codecSortIndex(b[0]))
        .map(([label, v]) => {
          const vSizeInfo = combineSizeEstimates(estimateSizeBytes(v.format, info.duration), bestAudioSize);
          return {
            label,
            formatId: v.format.format_id,
            ext: CONTAINER_FORMATS.includes(v.format.ext) ? v.format.ext : 'mp4',
            size: formatSizeLabel(vSizeInfo),
          };
        });
    }

    formatItems.push({
      res: `${f.height}p`,
      ext: containerExt,
      size: sizeLabel,
      formatId: f.format_id,
      audioOnly: false,
      codec: normalizeVideoCodec(f.vcodec),
      codecOptions,
    });
  }

  // ---- Opciones de solo-audio: mismo audio fuente, distintos niveles de calidad ----
  // (bitrate objetivo al que se re-codifica el audio; el formato de salida
  // sigue siendo elegible con el select de la columna "Formato", por defecto MP3).
  // Solo se muestran los niveles que tengan sentido según el bitrate REAL de
  // la pista de audio fuente (bestAudioFormat, ya detectado más arriba): pedir
  // una tasa de bits mayor a la de la fuente no mejora nada, solo infla el
  // archivo sin diferencia audible. Si no se pudo detectar el bitrate fuente
  // (algún extractor no lo reporta), se muestran todos los niveles igual.
  const ALL_AUDIO_BITRATES = [320, 256, 128, 96, 64];
  const sourceAudioBitrateKbps = bestAudioFormat ? bestAudioFormat.abr || bestAudioFormat.tbr || null : null;
  let audioBitrates = ALL_AUDIO_BITRATES;
  if (sourceAudioBitrateKbps) {
    const filtered = ALL_AUDIO_BITRATES.filter((kbps) => kbps <= sourceAudioBitrateKbps);
    // Si la fuente es más baja que todos los niveles (ej. 48kbps), se deja
    // igual el más bajo (64) para no dejar la lista de audio vacía.
    audioBitrates = filtered.length ? filtered : [ALL_AUDIO_BITRATES[ALL_AUDIO_BITRATES.length - 1]];
  }
  const audioQualityOptions = audioBitrates.map((kbps) => ({
    res: `${kbps} kb/s`,
    bitrateKbps: kbps,
  }));
  // Formato por defecto: el que ya trae la fuente (mp3/m4a/opus), en vez de
  // forzar siempre mp3 — igual criterio que containerExt para video.
  const defaultAudioExt = normalizeAudioExt(bestAudioFormat);
  for (const aq of audioQualityOptions) {
    // Tamaño estimado a partir del bitrate objetivo de cada nivel (no del
    // bitrate original de la pista fuente), siempre aproximado.
    const estBytes = info.duration ? ((aq.bitrateKbps * 1000) / 8) * info.duration : null;
    const sizeInfo = estBytes ? { bytes: estBytes, approx: true } : null;
    formatItems.push({
      res: aq.res,
      ext: defaultAudioExt,
      size: formatSizeLabel(sizeInfo),
      formatId: null,
      audioOnly: true,
      audioFormat: defaultAudioExt,
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
      // Las dos entradas "builtin" (Mejor video y audio / Mejor audio) ya se
      // muestran siempre como las filas ★ incorporadas al inicio de la lista
      // (ver buildDownloadOptions); se excluyen acá para no duplicarlas.
      if (p.builtin) return false;
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
  
  // Filtrar preajustes por sitio del video actual (y excluir los "builtin":
  // ya están siempre visibles como las filas ★ del listado principal, no
  // hace falta duplicarlos acá).
  const currentSite = (currentVideoInfo?.extractor_key || '').trim().toLowerCase();
  const applicablePresets = presets.filter((p) => {
    if (p.builtin) return false;
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
    <span class="col-codec">${window.i18n.t('col_codec')}</span>
    <span class="col-size">${window.i18n.t('col_size')}</span>
  `;
  downloadListInner.appendChild(header);

  // Sub-separadores "Video" / "Audio" dentro de "Formatos detectados": marcan
  // dónde empieza cada bloque, para que no se lean como una lista continua.
  // Solo se muestran si hay AMBOS tipos de filas (si el link es solo-audio o
  // solo-video, no tiene sentido separar nada).
  const hasVideoRows = formatItems.some((opt) => !opt.isPreset && !opt.audioOnly);
  const hasAudioRows = formatItems.some((opt) => !opt.isPreset && opt.audioOnly);
  let videoSubdividerShown = false;
  let audioSubdividerShown = false;

  formatItems.forEach((opt, i) => {
    if (opt.isPreset) return;
    if (hasVideoRows && hasAudioRows && !opt.audioOnly && !videoSubdividerShown) {
      const videoDivider = document.createElement('div');
      videoDivider.className = 'download-subdivider glitch-text';
      videoDivider.textContent = window.i18n.t('video_only_divider');
      videoDivider.dataset.text = window.i18n.t('video_only_divider');
      downloadListInner.appendChild(videoDivider);
      videoSubdividerShown = true;
    }
    if (hasVideoRows && hasAudioRows && opt.audioOnly && !audioSubdividerShown) {
      const audioDivider = document.createElement('div');
      audioDivider.className = 'download-subdivider glitch-text';
      audioDivider.textContent = window.i18n.t('audio_only_divider');
      audioDivider.dataset.text = window.i18n.t('audio_only_divider');
      downloadListInner.appendChild(audioDivider);
      audioSubdividerShown = true;
    }
    appendOptionRow(opt, i);
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
    // Los dos preajustes incorporados ("Mejor video y audio" / "Mejor audio")
    // agrupan el select de formato + el peso estimado en un solo bloque para
    // que ambos se empujen juntos al extremo derecho de la fila (ver
    // .preset-best-trailing en styles.css). Los preajustes guardados por el
    // usuario siguen mostrando el tamaño suelto, como antes.
    const trailingHtml = opt.isBest
      ? `<span class="preset-best-trailing">
          ${formatSelectHtml}
          ${opt.size ? `<span class="size">${opt.size}</span>` : ''}
        </span>`
      : (opt.size ? `<span class="size">${opt.size}</span>` : '');
    row.innerHTML = `
      <span class="arrow">${i === selectedIndex ? '&gt;' : ''}</span>
      <span class="arrow">★</span>
      <span class="res">${opt.res}</span>
      ${showSummary ? `<span class="preset-summary">${opt.summary}</span>` : ''}
      ${!opt.isBest && !showSummary ? '<span class="tag">preset</span>' : ''}
      ${trailingHtml}
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
    // Celda de códec: solo las filas de video con más de una variante detectada
    // (ej. H264 + VP9 + AV1 en la misma resolución) muestran un select; el resto
    // muestra el nombre del códec como texto fijo, o un guion si no se detectó
    // (filas de audio, o el sitio no reportó vcodec).
    const codecCell =
      !opt.audioOnly && opt.codecOptions && opt.codecOptions.length > 1
        ? `<select class="codec-select" data-idx="${i}" title="${window.i18n.t('codec_tooltip')}">
            ${opt.codecOptions.map((c) => `<option value="${c.label}" ${opt.codec === c.label ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>`
        : `<span class="codec-static">${!opt.audioOnly && opt.codec ? opt.codec : '—'}</span>`;
    row.innerHTML = `
      <span class="arrow" data-text="${i === selectedIndex ? '>' : ''}">${i === selectedIndex ? '&gt;' : ''}</span>
      <span class="arrow" data-text="${icon}">${icon}</span>
      ${badge ? `<span class="quality-badge quality-badge-${badge.toLowerCase()}" data-text="${badge}">${badge}</span>` : '<span class="quality-badge-spacer"></span>'}
      <span class="res" data-text="${opt.res}">${opt.res}</span>
      ${extCell}
      ${codecCell}
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

  const codecSelect = row.querySelector('.codec-select');
  if (codecSelect) {
    codecSelect.addEventListener('click', (e) => e.stopPropagation());
    codecSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      // Cambiar de códec cambia el format_id real a descargar (es un stream
      // de video distinto), y arrastra consigo su propio contenedor nativo
      // y peso estimado, igual que hace containerExt al armar la lista.
      const chosen = opt.codecOptions.find((c) => c.label === e.target.value);
      if (chosen) {
        opt.codec = chosen.label;
        opt.formatId = chosen.formatId;
        opt.ext = chosen.ext;
        opt.size = chosen.size;
      }
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

async function startDownload(opt, extraOptions) {
  const { extId } = extraOptions || {};
  const label = opt.isPreset ? opt.res : `${opt.res}`;

  let trimSection;
  try {
    trimSection = resolveTrimSection();
  } catch (err) {
    setStatus(err.message, 'error', 'picker');
    return;
  }

  // Soltamos la preview de "Cortar video" (si estaba reproduciendo/buffereando)
  // antes de arrancar la descarga real, para que no compitan por la misma
  // conexión/host y la descarga no quede pegada en 0%.
  releaseTrimVideoStream();

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
    // Tramo a recortar (ver sección "Cortar video"), null si no está activado.
    trimSection,
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
    const result = await window.yoinksAPI.download({ ...payload, downloadId, extId: extId || null });
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
      // Si el usuario sigue viendo el picker de este mismo video, actualizamos
      // la etiqueta "Ya descargado" al toque, sin esperar a que vuelva a
      // pegar el link.
      if (isVisible && currentVideoInfo) {
        await checkIfAlreadyDownloaded(currentVideoInfo, currentUrl);
        renderAlreadyDownloadedBadge();
        updatePreviewVideoButton();
      }
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
    if (screenActivity.classList.contains('active') && HISTORY_TABS[activeActivityTab]) loadHistoryTab(activeActivityTab);
  }
}

// ================= PANTALLA DE CONFIGURACIÓN (pestañas, página propia como Tareas) =================

// Cada pestaña asocia su botón con la función que carga/muestra ese panel
// (las mismas funciones open*Panel que antes abrían un overlay flotante:
// siguen ocultando el resto de paneles ⚙/overlays y cargando sus datos,
// solo que ahora el panel vive embebido en la pantalla en vez de flotar).
const SETTINGS_TABS = {
  general: { tabBtn: settingsTabGeneral, panelEl: document.getElementById('general-overlay'), open: () => openGeneralPanel() },
  download: { tabBtn: settingsTabDownload, panelEl: document.getElementById('download-settings-overlay'), open: () => openDownloadSettingsPanel() },
  cookies: { tabBtn: settingsTabCookies, panelEl: document.getElementById('cookies-overlay'), open: () => openCookiesPanel() },
  presets: { tabBtn: settingsTabPresets, panelEl: document.getElementById('presets-overlay'), open: () => openPresetsPanel() },
  updates: { tabBtn: settingsTabUpdates, panelEl: document.getElementById('updates-overlay'), open: () => openUpdatesPanel() },
  about: { tabBtn: settingsTabAbout, panelEl: document.getElementById('about-overlay'), open: () => openAboutPanel() },
};

let activeSettingsTab = 'general';

function setSettingsTab(tab) {
  activeSettingsTab = tab;
  Object.entries(SETTINGS_TABS).forEach(([key, { tabBtn, panelEl }]) => {
    const isActive = key === tab;
    tabBtn.classList.toggle('active', isActive);
    panelEl.classList.toggle('hidden', !isActive);
  });
  // Carga/refresca los datos del panel activo (las mismas funciones que antes
  // abrían el overlay flotante; el "cerrar los demás overlays ⚙" que hacían
  // ya no aplica a estos 7 paneles, que ahora se ocultan arriba por pestaña).
  SETTINGS_TABS[tab].open();
}

// Configuración y Tareas comparten UNA sola "pantalla de retorno"
// (returnScreen): la última pantalla "de contenido real" (Inicio, selección
// de formato o Playlist) en la que estuvo el usuario. A propósito, Configuración
// y Tareas NUNCA se guardan como returnScreen entre sí: si no fuera así, saltar
// varias veces de Tareas a Configuración iría sobreescribiendo cuál era "la
// pantalla anterior" de la otra, y el botón de volver quedaba rebotando para
// siempre entre ambas sin llegar nunca a Inicio. Con una sola variable que
// solo se actualiza al salir de una pantalla de contenido real, volver desde
// Configuración o desde Tareas (sin importar cuántas veces se haya saltado
// entre ambas) manda directo a Inicio, o a selección de formato/Playlist si
// fue de ahí de donde se entró originalmente.
let returnScreen = 'home';

function getActiveScreenName() {
  if (screenPicker.classList.contains('active')) return 'picker';
  if (screenPlaylist.classList.contains('active')) return 'playlist';
  if (screenActivity.classList.contains('active')) return 'activity';
  if (screenSettings.classList.contains('active')) return 'settings';
  if (screenTerminal.classList.contains('active')) return 'terminal';
  return 'home';
}

// Guarda la pantalla actual como returnScreen, pero solo si es una pantalla
// de contenido real (no Configuración, Tareas ni Terminal rebotando entre sí).
function rememberReturnScreen() {
  const current = getActiveScreenName();
  if (current !== 'settings' && current !== 'activity' && current !== 'terminal') {
    returnScreen = current;
  }
}

// Va a la pantalla de Configuración. Por defecto muestra "General".
function goToSettingsScreen(tab = 'general') {
  rememberReturnScreen();
  deactivateAllScreens();
  screenSettings.classList.add('active');
  setSettingsTab(tab);
  updateSidebarActiveStates();
}

// Cierra Configuración volviendo a Inicio, selección de formato o Playlist
// (la última pantalla de contenido real), nunca a Tareas.
function closeSettingsScreen() {
  switch (returnScreen) {
    case 'picker':
      goToPickerScreen();
      break;
    case 'playlist':
      goToPlaylistScreen();
      break;
    default:
      goToHomeScreen();
  }
}

settingsBtn.addEventListener('click', () => goToSettingsScreen('general'));
settingsCloseBtn.addEventListener('click', closeSettingsScreen);

// Va a la pantalla de Terminal (pantalla propia, ya no vive dentro de Configuración).
// Usa la misma returnScreen que Configuración/Tareas (ver comentario junto a su
// declaración): volver siempre manda a Inicio o a selección de formato/Playlist.
function goToTerminalScreen() {
  rememberReturnScreen();
  closeAllOverlayPanels();
  deactivateAllScreens();
  screenTerminal.classList.add('active');
  openTerminalPanel();
  updateSidebarActiveStates();
}

function closeTerminalScreen() {
  switch (returnScreen) {
    case 'picker':
      goToPickerScreen();
      break;
    case 'playlist':
      goToPlaylistScreen();
      break;
    default:
      goToHomeScreen();
  }
}

// ---- Barra lateral: tarjeta "Terminal" (acceso directo, sin pasar por Configuración) ----
const sidebarTerminalBtn = document.getElementById('sidebar-terminal');
if (sidebarTerminalBtn) {
  sidebarTerminalBtn.addEventListener('click', () => goToTerminalScreen());
}
const terminalCloseBtn = document.getElementById('terminal-close-btn');
if (terminalCloseBtn) {
  terminalCloseBtn.addEventListener('click', closeTerminalScreen);
}

settingsTabGeneral.addEventListener('click', () => setSettingsTab('general'));
settingsTabDownload.addEventListener('click', () => setSettingsTab('download'));
settingsTabCookies.addEventListener('click', () => setSettingsTab('cookies'));
settingsTabPresets.addEventListener('click', () => setSettingsTab('presets'));
settingsTabUpdates.addEventListener('click', () => setSettingsTab('updates'));
settingsTabAbout.addEventListener('click', () => setSettingsTab('about'));

// ================= ACERCA DE (panel ⚙) =================

const aboutOverlay = document.getElementById('about-overlay');
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
    // Las dos entradas "builtin" muestran su nombre traducido según el
    // idioma activo (igual que las filas ★ del listado de descarga) en vez
    // del texto fijo guardado en disco.
    const displayName = p.builtin ? window.i18n.t(p.builtin) : p.name;
    // Las dos entradas "builtin" se pueden editar como cualquier otro
    // preajuste, pero no se pueden eliminar: en vez del botón "eliminar"
    // muestran una etiqueta fija indicando que están protegidas.
    const deleteCell = p.builtin
      ? `<span class="preset-locked" title="${window.i18n.t('preset_builtin_locked')}">${window.i18n.t('preset_builtin_locked')}</span>`
      : `<button class="preset-delete" data-index="${i}">${window.i18n.t('btn_delete')}</button>`;
    tr.innerHTML = `
      <td class="site">${escapeHtml(p.site)}</td>
      <td class="name">${escapeHtml(displayName)}</td>
      <td class="options">${escapeHtml(p.options)}</td>
      <td class="actions">
        <button class="preset-edit" data-index="${i}">${window.i18n.t('btn_edit')}</button>
        ${deleteCell}
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
  // Si es una de las dos entradas "builtin", precargamos el nombre traducido
  // (el que ve el usuario en la tabla) en vez del texto fijo guardado; al
  // guardar los cambios se pierde el marcador "builtin" y pasa a ser un
  // preajuste normal con ese nombre fijo, como cualquier otro.
  presetNameInput.value = preset.builtin ? window.i18n.t(preset.builtin) : (preset.name || '');
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

// ---- Panel de Terminal ----
// Corre en un solo proceso a la vez. terminalRunning refleja si hay un
// comando en curso, para deshabilitar "Ejecutar" y mostrar "Detener" en su
// lugar (mismo patrón que pausar/cancelar una descarga normal).
let terminalRunning = false;

// yt-dlp actualiza el progreso de descarga con "\r" (retorno de carro: vuelve
// al inicio de la línea y la reescribe), tal como lo haría cualquier
// terminal real. Antes tratábamos cada trozo de texto como una línea nueva,
// así que cada actualización de progreso (decenas por segundo) quedaba
// como una línea aparte y el panel se llenaba de texto. Ahora imitamos una
// terminal de verdad: mientras no llegue un salto de línea real ("\n"), la
// línea en curso se guarda en un único <span> que se va reescribiendo; el
// "\r" simplemente reinicia su contenido en vez de crear una línea nueva.
// El "\n" sí cierra esa línea de forma definitiva (queda fija en el
// historial) y empieza una línea en blanco para lo próximo que llegue.
let terminalLineBuf = '';
let terminalLineSpan = null;
let terminalLineClass = null;

function terminalEnsureLineSpan(cssClass) {
  if (!terminalLineSpan || terminalLineClass !== cssClass) {
    terminalLineSpan = document.createElement('span');
    if (cssClass) terminalLineSpan.className = cssClass;
    terminalLineClass = cssClass;
    terminalOutputEl.appendChild(terminalLineSpan);
  }
  return terminalLineSpan;
}

function terminalCommitLine() {
  terminalOutputEl.appendChild(document.createTextNode('\n'));
  terminalLineSpan = null;
  terminalLineBuf = '';
  terminalLineClass = null;
}

function terminalAppendLine(rawText, cssClass) {
  if (!rawText) return;
  const atBottom =
    terminalOutputEl.scrollTop + terminalOutputEl.clientHeight >= terminalOutputEl.scrollHeight - 4;
  const text = rawText.replace(/\r\n/g, '\n'); // normaliza CRLF antes de procesar
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    const cr = text.indexOf('\r', i);
    if (nl === -1 && cr === -1) {
      terminalLineBuf += text.slice(i);
      terminalEnsureLineSpan(cssClass).textContent = terminalLineBuf;
      break;
    }
    if (cr !== -1 && (nl === -1 || cr < nl)) {
      terminalLineBuf += text.slice(i, cr);
      terminalEnsureLineSpan(cssClass).textContent = terminalLineBuf;
      terminalLineBuf = ''; // "\r": el cursor vuelve al inicio, lo próximo reescribe la línea
      i = cr + 1;
    } else {
      terminalLineBuf += text.slice(i, nl);
      terminalEnsureLineSpan(cssClass).textContent = terminalLineBuf;
      terminalCommitLine(); // "\n": línea definitiva, empieza una nueva
      i = nl + 1;
    }
  }
  if (atBottom) terminalOutputEl.scrollTop = terminalOutputEl.scrollHeight;
}

// Borra todo el texto acumulado en el panel de salida (no afecta el
// comando en curso ni el input): resetea también el buffer de línea
// "en progreso" para que la próxima salida empiece de cero.
function clearTerminalOutput() {
  terminalOutputEl.textContent = '';
  terminalLineBuf = '';
  terminalLineSpan = null;
  terminalLineClass = null;
}

// Borra el comando escrito en el input de la Terminal (no toca la salida).
function clearTerminalInput() {
  if (terminalRunning) return;
  terminalCommandInput.value = '';
  terminalCommandInput.focus();
}

function setTerminalRunning(running) {
  terminalRunning = running;
  terminalCommandInput.disabled = running;
  if (terminalClearInputBtn) terminalClearInputBtn.disabled = running;
  // Un solo botón que alterna entre "Ejecutar" (estado normal) y
  // "Detener" (estado corriendo, en rojo), en vez de mostrar/ocultar
  // dos botones separados.
  terminalRunBtn.classList.toggle('stop-state', running);
  const key = running ? 'btn_terminal_stop' : 'btn_terminal_run';
  terminalRunBtn.setAttribute('data-i18n', key);
  terminalRunBtn.textContent = window.i18n.t(key);
}

function openTerminalPanel() {
  closeAllOverlayPanels();
  terminalOverlay.classList.remove('hidden');
  terminalCommandInput.focus();
}

function closeTerminalPanel() {
  terminalOverlay.classList.add('hidden');
}

async function runTerminalCommand() {
  const command = terminalCommandInput.value.trim();
  if (!command) {
    terminalAppendLine(window.i18n.t('terminal_empty_command') + '\n', 'terminal-line-system');
    return;
  }
  terminalAppendLine(`$ yt-dlp ${command}\n`, 'terminal-line-system');
  setTerminalRunning(true);
  try {
    const result = await window.yoinksAPI.runTerminalCommand(command);
    if (!result || !result.started) {
      setTerminalRunning(false);
    }
  } catch (e) {
    terminalAppendLine(`\n[error] ${e.message}\n`, 'terminal-line-stderr');
    setTerminalRunning(false);
  }
}

// Combina un nuevo fragmento de comando (de un chip rápido o del panel
// "+Comandos") con lo que ya hay escrito en el input de la Terminal, en
// vez de reemplazarlo: conserva las banderas ya puestas, agrega las
// nuevas al final, y mantiene la URL (si había una) siempre al final
// de todo.
function appendCommandToTerminalInput(current, addition) {
  const urlMatch = current.match(/https?:\/\/\S+/);
  const url = urlMatch ? urlMatch[0] : '';
  const flagsOnly = current.replace(/https?:\/\/\S+/, '').trim();
  const newFlags = flagsOnly ? `${flagsOnly} ${addition}` : addition;
  return url ? `${newFlags} ${url}` : `${newFlags} `;
}

// Botones de "comandos rápidos": agregan su plantilla a lo ya escrito en
// el input (sin borrar banderas previas). Si el usuario ya había escrito
// una URL, se conserva y queda siempre al final del comando.
terminalQuickCommandsEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.terminal-chip');
  if (!chip || terminalRunning) return;
  const template = chip.dataset.command || '';
  terminalCommandInput.value = appendCommandToTerminalInput(terminalCommandInput.value, template);
  terminalCommandInput.focus();
  terminalCommandInput.selectionStart = terminalCommandInput.selectionEnd = terminalCommandInput.value.length;
});

// ---- Panel de Referencia de comandos ----
// Lista completa (window.YTDLP_COMMANDS, ver terminal-commands-data.js)
// filtrable por texto; cada fila permite copiar el comando al portapapeles
// o insertarlo directamente en un input de destino. El panel es compartido
// entre la Terminal y el campo "Opciones" del panel de Preajustes; se abre
// desde cualquiera de los dos (terminalReferenceBtn / presetsReferenceBtn)
// y terminalReferenceTargetInput guarda a cuál de los dos inputs insertar.
let terminalReferenceTargetInput = null;
function renderTerminalReferenceList(filterText) {
  const lang = (window.i18n && window.i18n.getLanguage) ? window.i18n.getLanguage() : 'es';
  const commands = (lang === 'en' ? window.YTDLP_COMMANDS_EN : window.YTDLP_COMMANDS_ES) || window.YTDLP_COMMANDS || [];
  const query = (filterText || '').trim().toLowerCase();
  terminalReferenceListEl.innerHTML = '';

  let totalMatches = 0;

  commands.forEach((group) => {
    const items = query
      ? group.items.filter(
          (item) =>
            item.cmd.toLowerCase().includes(query) || item.desc.toLowerCase().includes(query)
        )
      : group.items;

    if (!items.length) return;
    totalMatches += items.length;

    const categoryEl = document.createElement('div');
    categoryEl.className = 'terminal-reference-category';
    categoryEl.textContent = group.category;
    terminalReferenceListEl.appendChild(categoryEl);

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'terminal-reference-row';
      row.title = window.i18n.t('terminal_reference_copy_hint');

      const main = document.createElement('div');
      main.className = 'terminal-reference-row-main';

      const cmdEl = document.createElement('code');
      cmdEl.className = 'terminal-reference-cmd';
      cmdEl.textContent = item.cmd;

      const descEl = document.createElement('span');
      descEl.className = 'terminal-reference-desc';
      descEl.textContent = item.desc;

      main.appendChild(cmdEl);
      main.appendChild(descEl);

      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'terminal-reference-use-btn';
      useBtn.textContent = window.i18n.t('terminal_reference_use_btn');

      // Clic en la fila (fuera del botón "Usar"): copia el comando.
      main.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.cmd);
          const original = cmdEl.textContent;
          cmdEl.classList.add('terminal-reference-copied');
          cmdEl.textContent = `${window.i18n.t('terminal_reference_copied')} ${original}`;
          setTimeout(() => {
            cmdEl.classList.remove('terminal-reference-copied');
            cmdEl.textContent = original;
          }, 1000);
        } catch (e) {
          // Si el portapapeles no está disponible, no hacemos nada más:
          // el texto igual es seleccionable manualmente.
        }
      });

      // Botón "Usar": inserta el comando en el input de destino (Terminal o
      // el campo "Opciones" de Preajustes, según desde dónde se abrió el
      // panel). En ambos casos se agrega al final de lo ya escrito, sin
      // reemplazarlo; en la Terminal, además, la URL (si había una) se
      // conserva siempre al final de todo.
      useBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetInput = terminalReferenceTargetInput || terminalCommandInput;
        if (targetInput === terminalCommandInput) {
          targetInput.value = appendCommandToTerminalInput(targetInput.value, item.cmd);
        } else {
          const current = targetInput.value.trim();
          targetInput.value = current ? `${current} ${item.cmd}` : item.cmd;
        }
        closeTerminalReferencePanel();
        targetInput.focus();
        targetInput.selectionStart = targetInput.selectionEnd = targetInput.value.length;
      });

      row.appendChild(main);
      row.appendChild(useBtn);
      terminalReferenceListEl.appendChild(row);
    });
  });

  if (!totalMatches) {
    const empty = document.createElement('div');
    empty.className = 'terminal-reference-empty';
    empty.textContent = window.i18n.t('terminal_reference_empty');
    terminalReferenceListEl.appendChild(empty);
  }
}

function openTerminalReferencePanel(targetInput) {
  terminalReferenceTargetInput = targetInput || terminalCommandInput;
  terminalReferenceOverlay.classList.remove('hidden');
  terminalReferenceSearchEl.value = '';
  renderTerminalReferenceList('');
  terminalReferenceSearchEl.focus();
}

function closeTerminalReferencePanel() {
  terminalReferenceOverlay.classList.add('hidden');
}

terminalReferenceBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openTerminalReferencePanel(terminalCommandInput);
});
presetsReferenceBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openTerminalReferencePanel(presetOptionsInput);
});
terminalReferenceCloseBtn.addEventListener('click', closeTerminalReferencePanel);
terminalReferenceOverlay.addEventListener('click', (e) => {
  if (e.target === terminalReferenceOverlay) closeTerminalReferencePanel();
});
terminalReferenceSearchEl.addEventListener('input', () => {
  renderTerminalReferenceList(terminalReferenceSearchEl.value);
});

terminalRunBtn.addEventListener('click', () => {
  if (terminalRunning) {
    window.yoinksAPI.stopTerminalCommand();
  } else {
    runTerminalCommand();
  }
});
terminalCommandInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !terminalRunning) runTerminalCommand();
});
if (terminalClearInputBtn) {
  terminalClearInputBtn.addEventListener('click', clearTerminalInput);
}
if (terminalClearOutputBtn) {
  terminalClearOutputBtn.addEventListener('click', clearTerminalOutput);
}
window.yoinksAPI.onTerminalOutput(({ stream, text }) => {
  terminalAppendLine(text, stream === 'stderr' ? 'terminal-line-stderr' : null);
});

window.yoinksAPI.onTerminalDone(({ code }) => {
  setTerminalRunning(false);
  const msg = code === 0
    ? window.i18n.t('terminal_finished_ok')
    : window.i18n.t('terminal_finished_error', { code });
  terminalAppendLine(`\n${msg}\n\n`, 'terminal-line-system');
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!terminalReferenceOverlay.classList.contains('hidden')) {
    closeTerminalReferencePanel();
  } else if (screenSettings.classList.contains('active')) {
    closeSettingsScreen();
  } else if (screenActivity.classList.contains('active')) {
    closeActivityScreen();
  } else if (screenTerminal.classList.contains('active')) {
    closeTerminalScreen();
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
        ${entry.status === 'success' ? `<button class="history-open">${window.i18n.t('btn_open')}</button>` : ''}
        ${entry.url ? `<button class="history-redownload">${window.i18n.t('btn_redownload')}</button>` : ''}
        ${entry.status === 'success' ? `<button class="history-open-folder">${window.i18n.t('btn_open_folder')}</button>` : ''}
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
      row.querySelector('.history-open-folder').addEventListener('click', () => {
        window.yoinksAPI.openHistoryFolder(entry.path);
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
    speed: null,
    eta: null,
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
function setActiveDownloadProgress(id, percent, speed, eta, indeterminate, indeterminateLabelKey) {
  const d = activeDownloads.find((x) => x.id === id);
  if (!d) return;
  const wasQueued = d.status === 'queued';
  // "indeterminate" llega true al arrancar una descarga con recorte (exacto o
  // no), mientras no haya llegado un % real (ver main.js); llega false en
  // cuanto aparece uno, así que no se pisa un valor previo sin querer.
  if (indeterminate !== undefined) d.indeterminate = indeterminate;
  if (indeterminateLabelKey) d.indeterminateLabelKey = indeterminateLabelKey;
  d.percent = percent;
  d.speed = speed || null;
  d.eta = eta || null;
  d.status = 'downloading';

  const row = downloadsListEl.querySelector(`[data-download-id="${id}"]`);
  if (row) {
    const fill = row.querySelector('.update-progress-fill');
    const text = row.querySelector('.update-progress-text');
    if (fill) fill.classList.toggle('indeterminate', !!d.indeterminate);
    if (d.indeterminate) {
      if (fill) fill.style.width = '';
      if (text) text.textContent = window.i18n.t(d.indeterminateLabelKey || 'status_trimming');
    } else {
      if (fill) fill.style.width = percent + '%';
      if (text) text.textContent = percent.toFixed(0) + '%';
    }

    const speedText = row.querySelector('.active-dl-speed-text');
    if (speedText) {
      speedText.textContent = formatDownloadSpeedEta(speed, eta);
      speedText.classList.toggle('hidden', d.indeterminate || (!speed && !eta));
    }

    updateDownloadsSpeedSummary();

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

// Arma el texto "1.23 MiB/s · ETA 00:07" a partir de lo que reportó yt-dlp.
// Ambos campos son opcionales (yt-dlp no siempre los tiene disponibles,
// sobre todo al principio de la descarga); se omite lo que falte.
function formatDownloadSpeedEta(speed, eta) {
  const parts = [];
  if (speed) parts.push(speed);
  if (eta) parts.push(`ETA ${eta}`);
  return parts.join(' · ');
}

// Convierte un string de velocidad de yt-dlp (ej. "1.23MiB/s", "512.00KiB/s")
// a bytes/segundo, para poder sumar la velocidad de varias descargas
// simultáneas. Soporta tanto unidades binarias (KiB/MiB/GiB) como
// decimales (KB/MB/GB), por si el binario reporta alguna variante.
function parseSpeedToBytesPerSec(speedStr) {
  if (!speedStr) return 0;
  const m = speedStr.match(/^([\d.]+)\s*([KMGT]?i?)B\/s$/i);
  if (!m) return 0;
  const value = parseFloat(m[1]);
  const prefix = m[2].toUpperCase();
  const multipliers = { '': 1, K: 1000, KI: 1024, M: 1e6, MI: 1024 ** 2, G: 1e9, GI: 1024 ** 3, T: 1e12, TI: 1024 ** 4 };
  return value * (multipliers[prefix] !== undefined ? multipliers[prefix] : 1);
}

// Inversa de la anterior: bytes/segundo a un string legible en unidades
// binarias, para mostrar el total combinado.
function formatBytesPerSec(bytes) {
  if (!bytes || bytes <= 0) return null;
  const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s', 'TiB/s'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(2)}${units[i]}`;
}

// Barra resumen que se muestra arriba de la lista de "Descargas en curso"
// cuando hay una o más descargas activas: junta la velocidad de todas
// (parseando lo que reportó cada una) y muestra el total combinado, para
// no tener que sumar a ojo cada fila individual.
function updateDownloadsSpeedSummary() {
  if (!downloadsSpeedSummaryEl) return;
  const downloading = activeDownloads.filter((d) => d.status === 'downloading');

  if (!downloading.length) {
    // Antes se ocultaba del todo; ahora queda siempre visible (permanente)
    // para que la barra no aparezca/desaparezca y el resto del panel no
    // salte de posición cada vez que arranca o termina una descarga.
    downloadsSpeedSummaryTextEl.textContent = window.i18n.t('downloads_speed_summary_none');
    downloadsSpeedSummaryEl.classList.remove('hidden');
    return;
  }

  const totalBytes = downloading.reduce((sum, d) => sum + parseSpeedToBytesPerSec(d.speed), 0);
  const totalSpeedText = formatBytesPerSec(totalBytes);

  const countLabel =
    downloading.length === 1
      ? window.i18n.t('downloads_speed_summary_one')
      : window.i18n.t('downloads_speed_summary_many', { n: downloading.length });

  downloadsSpeedSummaryTextEl.innerHTML = totalSpeedText
    ? `${countLabel} · <strong>${escapeHtml(totalSpeedText)}</strong>`
    : countLabel;

  downloadsSpeedSummaryEl.classList.remove('hidden');
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
// Mismo sonido "campanita" (dos notas ascendentes, sin archivos externos)
// que usa el conversor de PDF Creator: se genera con la Web Audio API en
// vez del pitido genérico del sistema (shell.beep) que se usaba antes.
let notificationAudioContext = null;
function playSuccessChime() {
  if (!notificationAudioContext) {
    notificationAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  const now = notificationAudioContext.currentTime;
  const notes = [{ freq: 880, start: 0 }, { freq: 1318.51, start: 0.1 }];
  notes.forEach(({ freq, start }) => {
    const oscillator = notificationAudioContext.createOscillator();
    const gain = notificationAudioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + start);
    gain.gain.linearRampToValueAtTime(0.22, now + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.35);
    oscillator.connect(gain);
    gain.connect(notificationAudioContext.destination);
    oscillator.start(now + start);
    oscillator.stop(now + start + 0.35);
  });
}

async function playNotificationSoundIfEnabled() {
  try {
    const settings = await window.yoinksAPI.getSettings();
    if (!settings || settings.soundEnabled === false) return;
    if (settings.soundStyle === 'windows') {
      // Sonido del sistema de Windows (el pitido genérico que ya traía
      // Electron/el sistema operativo antes de agregar la campanita).
      await window.yoinksAPI.playNotificationSound();
      return;
    }
    playSuccessChime();
  } catch (e) {
    // Si la Web Audio API falla por lo que sea (poco probable en un
    // renderer de Electron), como último recurso caemos al pitido del
    // sistema que se usaba antes, para no quedarnos sin sonido del todo.
    try {
      await window.yoinksAPI.playNotificationSound();
    } catch (e2) {
      // sin sonido disponible: no es crítico, se ignora
    }
  }
}

// Despachador único de progreso: yt-dlp reporta el % por descarga (identificada por
// downloadId) para que, con varias descargas simultáneas, cada barra de progreso
// del panel de Actividad se actualice de forma independiente. Se registra una sola
// vez (no en cada clic) para no acumular listeners duplicados.
const progressCallbacks = new Map(); // downloadId -> function(percent)
window.yoinksAPI.onProgress((data) => {
  if (!data || data.id === undefined) return;
  setActiveDownloadProgress(data.id, data.percent, data.speed, data.eta, data.indeterminate, data.indeterminateLabelKey);
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

  updateDownloadsSpeedSummary();

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
                 <div class="update-progress-bar"><div class="update-progress-fill${d.indeterminate ? ' indeterminate' : ''}" style="${d.indeterminate ? '' : `width:${d.percent}%`}"></div></div>
                 <span class="update-progress-text">${d.indeterminate ? escapeHtml(window.i18n.t(d.indeterminateLabelKey || 'status_trimming')) : d.percent.toFixed(0) + '%'}</span>
                 <span class="active-dl-speed-text ${!d.indeterminate && (d.speed || d.eta) ? '' : 'hidden'}">${escapeHtml(formatDownloadSpeedEta(d.speed, d.eta))}</span>
               </div>`
            : ''
        }
      </div>
      <div class="active-dl-trailing">
        <span class="history-badge ${badgeClass}">${statusLabel}</span>
        ${actionButtons.length ? `<div class="history-item-actions">${actionButtons.join('')}</div>` : ''}
      </div>
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

// Va a la pantalla de Actividad (Tareas). Por defecto muestra "Descargas en curso".
// Usa la misma returnScreen que Configuración (ver comentario junto a su
// declaración): así, sin importar cuántas veces se salte entre Tareas y
// Configuración, volver siempre manda a Inicio o a selección de formato/Playlist.
function goToActivityScreen(tab = 'downloads') {
  rememberReturnScreen();
  closeAllOverlayPanels();
  deactivateAllScreens();
  screenActivity.classList.add('active');
  setActivityTab(tab);
  updateSidebarActiveStates();
}

// Cierra Tareas volviendo a Inicio, selección de formato o Playlist
// (la última pantalla de contenido real), nunca a Configuración.
function closeActivityScreen() {
  switch (returnScreen) {
    case 'picker':
      goToPickerScreen();
      break;
    case 'playlist':
      goToPlaylistScreen();
      break;
    default:
      goToHomeScreen();
  }
}

btnActivity.addEventListener('click', () => goToActivityScreen('downloads'));
activityCloseBtn.addEventListener('click', closeActivityScreen);

// ---- Barra lateral: tarjeta "Nueva tarea" ----
// Si está en Configuración o en Tareas, primero vuelve a la pantalla desde
// la que se entró (selección de formato, Playlist, etc.), igual que
// "volver"/Esc; un segundo clic desde ahí ya lleva a la pantalla de pegar
// el link.
const sidebarNewTaskBtn = document.getElementById('sidebar-new-task');
if (sidebarNewTaskBtn) {
  sidebarNewTaskBtn.addEventListener('click', () => {
    closeAllOverlayPanels();
    if (screenSettings.classList.contains('active')) {
      closeSettingsScreen();
    } else if (screenActivity.classList.contains('active')) {
      closeActivityScreen();
    } else if (screenTerminal.classList.contains('active')) {
      closeTerminalScreen();
    } else {
      goToHomeScreen();
    }
  });
  updateSidebarActiveStates();
}

// ---- Barra lateral: botón ☰ para expandir/colapsar (como en FluentFlyout) ----
const appSidebarEl = document.getElementById('app-sidebar');
const sidebarToggleBtn = document.getElementById('sidebar-toggle');
const SIDEBAR_EXPANDED_KEY = 'ytdlp-sidebar-expanded';

if (appSidebarEl && sidebarToggleBtn) {
  // Recuerda el estado elegido entre reinicios de la app.
  if (localStorage.getItem(SIDEBAR_EXPANDED_KEY) === '1') {
    appSidebarEl.classList.add('expanded');
  }
  sidebarToggleBtn.addEventListener('click', () => {
    const expanded = appSidebarEl.classList.toggle('expanded');
    localStorage.setItem(SIDEBAR_EXPANDED_KEY, expanded ? '1' : '0');
  });
}
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

// Sitios que el propio usuario agregó (Configuración → Cookies → "Agregar sitio").
// Se cargan/guardan junto con el resto de la configuración; cada uno tiene
// { id, name, hostname, url }. Sus <option> se agregan dinámicamente al final
// del selector.
let customCookieSites = [];

function rebuildCustomSiteOptions() {
  settingCookiesSiteSelect.querySelectorAll('option[data-custom-site]').forEach((opt) => opt.remove());
  for (const site of customCookieSites) {
    const opt = document.createElement('option');
    opt.value = site.id;
    opt.textContent = site.name;
    opt.dataset.customSite = '1';
    settingCookiesSiteSelect.appendChild(opt);
  }
}

function updateRemoveSiteButtonVisibility() {
  const isCustom = customCookieSites.some((s) => s.id === settingCookiesSiteSelect.value);
  settingCookiesRemoveSiteBtn.classList.toggle('hidden', !isCustom);
}

// Si el sitio elegido es uno personalizado, precarga su nombre/URL en el
// formulario de "Agregar sitio" y cambia el botón a modo edición; si no,
// deja el formulario vacío en modo "agregar nuevo".
function updateAddSiteFormForSelection() {
  const site = settingCookiesSiteSelect.value;
  const custom = customCookieSites.find((s) => s.id === site);
  settingAddSiteError.textContent = '';
  settingAddSiteError.classList.add('hidden');
  if (custom) {
    settingNewSiteNameInput.value = custom.name;
    settingNewSiteUrlInput.value = custom.url || custom.hostname || '';
    settingAddSiteBtn.setAttribute('data-i18n', 'btn_save_site_changes');
    settingAddSiteBtn.textContent = window.i18n.t('btn_save_site_changes');
    settingAddSiteBtn.dataset.editingId = custom.id;
  } else {
    settingNewSiteNameInput.value = '';
    settingNewSiteUrlInput.value = '';
    settingAddSiteBtn.setAttribute('data-i18n', 'btn_add_site');
    settingAddSiteBtn.textContent = window.i18n.t('btn_add_site');
    delete settingAddSiteBtn.dataset.editingId;
  }
}

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

// "Otros sitios" y los sitios agregados por el usuario no tienen ventana de
// login propia, así que se oculta esa opción del desplegable de modo en esos casos.
function updateApploginOptionAvailability() {
  const applyOption = settingCookiesModeSelect.querySelector('option[value="applogin"]');
  if (!applyOption) return;
  const site = settingCookiesSiteSelect.value;
  const noAppLogin = site === 'other' || customCookieSites.some((s) => s.id === site);
  applyOption.disabled = noAppLogin;
  if (noAppLogin && settingCookiesModeSelect.value === 'applogin') {
    settingCookiesModeSelect.value = 'none';
  }
}

settingCookiesSiteSelect.addEventListener('change', (e) => {
  // Antes de mostrar el nuevo sitio, guardamos lo que había quedado del anterior.
  // dataset.prevSite guarda cuál era el sitio mostrado hasta este cambio.
  commitCookiesFormToDraft(settingCookiesSiteSelect.dataset.prevSite);
  updateApploginOptionAvailability();
  updateRemoveSiteButtonVisibility();
  updateAddSiteFormForSelection();
  loadCookiesFormFromDraft(e.target.value);
  settingCookiesSiteSelect.dataset.prevSite = e.target.value;
});

// Agrega un sitio nuevo, o guarda los cambios de nombre/URL de uno ya
// existente (según lo que haya cargado updateAddSiteFormForSelection).
settingAddSiteBtn.addEventListener('click', async () => {
  const name = settingNewSiteNameInput.value.trim();
  const url = settingNewSiteUrlInput.value.trim();
  settingAddSiteError.textContent = '';
  settingAddSiteError.classList.add('hidden');
  if (!name || !url) {
    settingAddSiteError.textContent = window.i18n.t('err_new_site_required');
    settingAddSiteError.classList.remove('hidden');
    return;
  }

  const editingId = settingAddSiteBtn.dataset.editingId;
  settingAddSiteBtn.disabled = true;
  try {
    // Antes de agregar/editar, guardamos el borrador del sitio visible para no perderlo.
    commitCookiesFormToDraft(settingCookiesSiteSelect.value);

    let site;
    if (editingId) {
      site = await window.yoinksAPI.updateCustomCookieSite({ id: editingId, name, url });
      const idx = customCookieSites.findIndex((s) => s.id === editingId);
      if (idx !== -1) customCookieSites[idx] = site;
    } else {
      site = await window.yoinksAPI.addCustomCookieSite({ name, url });
      customCookieSites.push(site);
      cookiesDraft[site.id] = { mode: 'none', browser: 'firefox', file: '' };
    }

    rebuildCustomSiteOptions();
    settingCookiesSiteSelect.value = site.id;
    settingCookiesSiteSelect.dataset.prevSite = site.id;
    updateApploginOptionAvailability();
    updateRemoveSiteButtonVisibility();
    updateAddSiteFormForSelection();
    loadCookiesFormFromDraft(site.id);
  } catch (e) {
    settingAddSiteError.textContent = e.message || window.i18n.t('err_new_site_required');
    settingAddSiteError.classList.remove('hidden');
  } finally {
    settingAddSiteBtn.disabled = false;
  }
});

// Quita el sitio personalizado actualmente elegido, junto con su configuración
// de cookies guardada.
settingCookiesRemoveSiteBtn.addEventListener('click', async () => {
  const site = settingCookiesSiteSelect.value;
  if (!customCookieSites.some((s) => s.id === site)) return;

  settingCookiesRemoveSiteBtn.disabled = true;
  try {
    await window.yoinksAPI.removeCustomCookieSite(site);
    customCookieSites = customCookieSites.filter((s) => s.id !== site);
    delete cookiesDraft[site];
    rebuildCustomSiteOptions();
    settingCookiesSiteSelect.value = 'youtube';
    settingCookiesSiteSelect.dataset.prevSite = 'youtube';
    updateApploginOptionAvailability();
    updateRemoveSiteButtonVisibility();
    updateAddSiteFormForSelection();
    loadCookiesFormFromDraft('youtube');
  } catch (e) {
    // no crítico: si falla, el sitio simplemente sigue en la lista
  } finally {
    settingCookiesRemoveSiteBtn.disabled = false;
  }
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
  settingOrganizeBySiteCheckbox.checked = settings.organizeBySite === true;

  settingRateLimitInput.value = settings.rateLimit || '';
  settingRateLimitModeSelect.value = settings.rateLimitMode === 'total' ? 'total' : 'perFile';
  settingConcurrentDownloadsSelect.value = String(settings.concurrentDownloads || 1);
  settingConcurrentFragmentsInput.value = String(settings.concurrentFragments || 1);

  // Subtítulos/capítulos son opt-in (default apagado); miniaturas mantiene el
  // comportamiento histórico de la app (default prendido).
  settingSubtitlesEnabledCheckbox.checked = settings.subtitlesEnabled === true;
  settingSubtitleLangsInput.value = settings.subtitleLangs || '';
  settingSubtitleModeSelect.value = ['embed', 'file', 'both'].includes(settings.subtitleMode) ? settings.subtitleMode : 'embed';
  updateSubtitleRowsVisibility();
  settingThumbnailsEnabledCheckbox.checked = settings.thumbnailsEnabled !== false;
  settingChaptersEnabledCheckbox.checked = settings.chaptersEnabled === true;
}

function updateSubtitleRowsVisibility() {
  const enabled = settingSubtitlesEnabledCheckbox.checked;
  settingSubtitlesOptionsRow.classList.toggle('hidden', !enabled);
  settingSubtitleModeRow.classList.toggle('hidden', !enabled);
}

settingSubtitlesEnabledCheckbox.addEventListener('change', updateSubtitleRowsVisibility);

function openDownloadSettingsPanel() {
  closeAllOverlayPanels();
  loadDownloadSettings();
  downloadSettingsOverlay.classList.remove('hidden');
}

function closeDownloadSettingsPanel() {
  downloadSettingsOverlay.classList.add('hidden');
}

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
    organizeBySite: settingOrganizeBySiteCheckbox.checked,
    cookiesPerSite: current.cookiesPerSite,
    rateLimit: settingRateLimitInput.value.trim(),
    rateLimitMode: settingRateLimitModeSelect.value === 'total' ? 'total' : 'perFile',
    concurrentDownloads: parseInt(settingConcurrentDownloadsSelect.value, 10) || 1,
    concurrentFragments: Math.min(16, Math.max(1, parseInt(settingConcurrentFragmentsInput.value, 10) || 1)),
    subtitlesEnabled: settingSubtitlesEnabledCheckbox.checked,
    subtitleLangs: settingSubtitleLangsInput.value.trim(),
    subtitleMode: settingSubtitleModeSelect.value === 'file' || settingSubtitleModeSelect.value === 'both'
      ? settingSubtitleModeSelect.value
      : 'embed',
    thumbnailsEnabled: settingThumbnailsEnabledCheckbox.checked,
    chaptersEnabled: settingChaptersEnabledCheckbox.checked,
    soundEnabled: current.soundEnabled,
    closeBehavior: current.closeBehavior,
  };

  try {
    const saved = await window.yoinksAPI.saveSettings(settings);
    applyDownloadSettingsToForm(saved);
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
  settingSoundStyleSelect.value = settings.soundStyle === 'windows' ? 'windows' : 'chime';
  settingCloseBehaviorSelect.value = ['ask', 'minimize', 'close'].includes(settings.closeBehavior) ? settings.closeBehavior : 'ask';
  settingLanguageSelect.value = settings.language === 'en' ? 'en' : 'es';
  settingExtensionKeepInBackgroundCheckbox.checked = settings.extensionKeepInBackground === true;
}

function openGeneralPanel() {
  closeAllOverlayPanels();
  loadGeneralSettings();
  generalOverlay.classList.remove('hidden');
}

function closeGeneralPanel() {
  generalOverlay.classList.add('hidden');
}

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
      soundStyle: settingSoundStyleSelect.value === 'windows' ? 'windows' : 'chime',
      closeBehavior: settingCloseBehaviorSelect.value,
      language: settingLanguageSelect.value,
      extensionKeepInBackground: settingExtensionKeepInBackgroundCheckbox.checked,
    });
    applyGeneralSettingsToForm(saved);
    applyLanguage(saved.language === 'en' ? 'en' : 'es');
    if (window.yoinksAPI.setLanguage) window.yoinksAPI.setLanguage(saved.language === 'en' ? 'en' : 'es');
  } catch (e) {
    // si falla el guardado, dejamos el panel abierto para que el usuario reintente
  }
});

generalResetBtn.addEventListener('click', () => {
  // Restablece solo el formulario en pantalla a los valores por defecto;
  // hay que presionar "Guardar" para que quede persistido.
  applyGeneralSettingsToForm({ soundEnabled: true, soundStyle: 'chime', closeBehavior: 'ask', language: 'es', extensionKeepInBackground: false });
});

// El toggle "Mantener en segundo plano" cambió desde las Opciones de la
// extensión del navegador: actualizamos SOLO ese checkbox (no todo el
// formulario, para no pisar otros cambios sin guardar que el usuario pueda
// tener abiertos en este mismo panel) sin importar si el panel General está
// visible en este momento o no — si está cerrado, no se nota nada, y la
// próxima vez que se abra ya carga el valor correcto desde disco igual.
if (window.yoinksAPI.onExtensionSettingsUpdated) {
  window.yoinksAPI.onExtensionSettingsUpdated((data) => {
    if (data && typeof data.extensionKeepInBackground === 'boolean') {
      settingExtensionKeepInBackgroundCheckbox.checked = data.extensionKeepInBackground;
    }
  });
}

// ================= PANEL DE COOKIES (panel ⚙ → Cookies) =================

async function loadCookiesSettings() {
  let settings;
  try {
    settings = await window.yoinksAPI.getSettings();
  } catch (e) {
    settings = null;
  }
  customCookieSites = (settings && Array.isArray(settings.customCookieSites)) ? settings.customCookieSites : [];
  rebuildCustomSiteOptions();
  applyCookiesSettingsToForm((settings && settings.cookiesPerSite) || null);
}

function applyCookiesSettingsToForm(cookiesPerSite) {
  cookiesDraft = defaultCookiesDraft();
  const allKeys = [...COOKIE_SITE_KEYS, ...customCookieSites.map((s) => s.id)];
  if (cookiesPerSite) {
    for (const key of allKeys) {
      const entry = cookiesPerSite[key];
      if (entry) cookiesDraft[key] = { mode: entry.mode || 'none', browser: entry.browser || 'firefox', file: entry.file || '' };
    }
  }
  const currentSite = allKeys.includes(settingCookiesSiteSelect.value) ? settingCookiesSiteSelect.value : 'youtube';
  settingCookiesSiteSelect.value = currentSite;
  settingCookiesSiteSelect.dataset.prevSite = currentSite;
  updateApploginOptionAvailability();
  updateRemoveSiteButtonVisibility();
  updateAddSiteFormForSelection();
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
  } catch (e) {
    // si falla el guardado, dejamos el panel abierto para que el usuario reintente
  }
});

cookiesResetBtn.addEventListener('click', () => {
  // Restablece solo el borrador en pantalla (a "Ninguna" en todos los sitios);
  // hay que presionar "Guardar" para que quede persistido.
  applyCookiesSettingsToForm(null);
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
    settingYtdlpChannelSelect.value = (settings && settings.ytdlpChannel) || 'stable';
  } catch (e) {
    settingYtdlpChannelSelect.value = 'stable';
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
// directamente la pestaña de Actualizaciones (dentro de Configuración),
// donde ya se ven las barras de progreso de yt-dlp/FFmpeg/Deno en vivo
// aunque la instalación haya arrancado en segundo plano antes de abrirla.
startupToast.addEventListener('click', () => {
  hideStartupToast();
  goToSettingsScreen('updates');
});
startupToast.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    hideStartupToast();
    goToSettingsScreen('updates');
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
