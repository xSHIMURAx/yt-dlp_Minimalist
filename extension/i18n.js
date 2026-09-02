// Traducciones compartidas por popup.html, options.html, sidepanel.html y
// content-overlay.js. El idioma elegido se guarda en chrome.storage.sync
// (clave I18N_LANG_KEY) para que quede sincronizado en todos los lugares de
// la extensión, igual que overlayMode/overlayEnabled.
const I18N_LANG_KEY = 'language';
const I18N_DEFAULT_LANG = 'es';

const I18N_STRINGS = {
  es: {
    // ---- Ajustes generales (options.html + panel del popup) ----
    options_subtitle: 'Elegí cómo se ve el botón flotante que aparece sobre los videos.',
    settings_overlay_legend: 'Botón flotante',
    overlay_icon_title: 'Solo ícono (compacto)',
    overlay_icon_desc: '50×20px, pegado a la esquina del video.',
    overlay_text_title: 'Ícono + texto "Descargar"',
    overlay_text_desc: 'Más visible, con el texto al lado del ícono.',
    disable_site_title: 'Desactivar botón flotante en este sitio',
    disable_extension_site_title: 'Desactivar la extensión en este sitio',
    extension_disabled_site: 'La extensión está desactivada en este sitio.',
    settings_downloads_legend: 'Descargas desde la extensión',
    keep_app_in_background_title: 'Mantener la app en segundo plano',
    keep_app_in_background_desc: 'Si ya elegiste la calidad acá (popup o botón flotante), la descarga arranca sin traer la ventana de la app al frente. Es el mismo ajuste que hay en la app (Configuración → General): cambiarlo de cualquiera de los dos lados actualiza el otro.',
    sync_hint: 'No se pudo sincronizar con la app — abrila para que este ajuste quede igual en los dos lados.',
    saved_label: 'Guardado ✓',
    settings_language_legend: 'Idioma',
    language_es: 'Español',
    language_en: 'English',

    // ---- popup.html ----
    open_app_title: 'Abrir el programa',
    toggle_floating_label: 'Flotante',
    toggle_floating_title: 'Mostrar/ocultar el botón flotante sobre los videos',
    toggle_autoopen_label: 'Auto-abrir',
    toggle_autoopen_title: 'Abrir este popup automáticamente al agregar una descarga',
    options_link_title: 'Ajustes del botón flotante',
    tab_download: 'Descargar',
    tab_progress: 'Progreso',
    tab_history: 'Historial',
    loading_tab: 'Cargando pestaña…',
    quality_label: 'Calidad',
    send_button: 'Enviar a YT-DLP Minimalist',
    progress_empty_title: 'No hay descargas en curso.',
    progress_empty_subtext: 'Mandá un video desde la pestaña "Descargar" para verlo acá.',
    filter_all: 'Todos',
    filter_completed: 'Completados',
    filter_error: 'Error',
    clear_history_title: 'Borrar historial',
    history_empty: 'Todavía no enviaste ningún video.',
    clear_btn: 'Borrar',

    // ---- Opciones de calidad (select del popup + menú del botón flotante) ----
    quality_opt_best: 'Mejor calidad (video+audio)',
    quality_opt_2160: '2160p 4K',
    quality_opt_1440: '1440p QHD',
    quality_opt_1080: '1080p HD',
    quality_opt_720: '720p HD',
    quality_opt_480: '480p',
    quality_opt_360: '360p',
    quality_opt_240: '240p',
    quality_opt_144: '144p',
    quality_opt_audio_mp3: 'Solo audio (MP3)',
    quality_opt_audio_m4a: 'Solo audio (M4A)',
    quality_opt_audio_opus: 'Solo audio (OPUS)',

    // ---- Etiquetas de calidad para el historial (guardado como objeto, no texto) ----
    quality_best: 'Mejor calidad',
    quality_audio: 'Solo audio',
    quality_audio_fmt: 'Solo audio ({format})',
    quality_video_height: '{height}p',

    // ---- popup.js (dinámico) ----
    tab_read_error1: 'No se pudo leer esta pestaña.',
    tab_read_error2: 'Error leyendo la pestaña.',
    sending_ellipsis: 'Enviando…',
    pause_btn: 'Pausar',
    resume_btn: 'Reanudar',
    cancel_btn: 'Cancelar',
    pause_failed: 'No se pudo pausar.',
    resume_failed: 'No se pudo reanudar.',
    cancel_failed: 'No se pudo cancelar.',
    resuming_ellipsis: 'Reanudando…',
    completed_check: '✓ Completado',
    error_label: 'Error',
    download_failed_generic: 'No se pudo completar la descarga.',
    cancelled_label: 'Cancelado',
    paused_label: 'En pausa',
    paused_meta: 'Podés reanudarla o cancelarla.',
    no_connection: 'Sin conexión con la app…',
    check_app_open: 'Verificá que YT-DLP Minimalist esté abierta.',
    starting_ellipsis: 'Iniciando…',
    downloading_percent: 'Descargando {percent}%',
    eta_label: 'ETA {eta}',
    page_not_sendable: 'Esta página no se puede enviar.',
    sent_check_review: 'Enviado ✓ — revisá YT-DLP Minimalist',
    opening_app: 'Abriendo la app…',
    connect_failed: 'No se pudo conectar. ¿Está abierta la app?',
    history_status_sent: 'Enviado',
    history_status_protocol: 'Abierto vía app',
    history_status_completed: 'Completado',
    history_status_error: 'Error',
    history_no_filter_results: 'No hay entradas con ese filtro.',
    open_file_btn: 'Abrir archivo',
    open_folder_btn: 'Abrir carpeta',
    open_file_not_found: 'No encontrado',
    open_folder_not_found: 'No encontrada',
    dismiss_card_title: 'Quitar de la lista',

    // ---- content-overlay.js ----
    overlay_btn_title: 'Descargar con YT-DLP Minimalist (clic derecho: elegir calidad)',
    overlay_download_label: 'Descargar',
    overlay_close_aria: 'Cerrar',
    overlay_sent_check: 'Enviado ✓',
    overlay_opening_app_label: 'Abriendo app…',
    overlay_open_app_retry_title: '¿Abriste la app? — Reintentar',
    overlay_open_app_retry_label: '¿Abriste la app?',
  },
  en: {
    options_subtitle: 'Choose how the floating button that appears over videos looks.',
    settings_overlay_legend: 'Floating button',
    overlay_icon_title: 'Icon only (compact)',
    overlay_icon_desc: '50×20px, pinned to the corner of the video.',
    overlay_text_title: 'Icon + "Download" text',
    overlay_text_desc: 'More visible, with the text next to the icon.',
    disable_site_title: 'Disable floating button on this site',
    disable_extension_site_title: 'Disable the extension on this site',
    extension_disabled_site: 'The extension is disabled on this site.',
    settings_downloads_legend: 'Downloads from the extension',
    keep_app_in_background_title: 'Keep the app in the background',
    keep_app_in_background_desc: "If you already picked the quality here (popup or floating button), the download starts without bringing the app's window to the front. Same setting as in the app (Settings → General): changing it on either side updates the other.",
    sync_hint: "Couldn't sync with the app — open it so this setting matches on both sides.",
    saved_label: 'Saved ✓',
    settings_language_legend: 'Language',
    language_es: 'Español',
    language_en: 'English',

    open_app_title: 'Open the app',
    toggle_floating_label: 'Floating',
    toggle_floating_title: 'Show/hide the floating button over videos',
    toggle_autoopen_label: 'Auto-open',
    toggle_autoopen_title: 'Automatically open this popup when a download is added',
    options_link_title: 'Floating button settings',
    tab_download: 'Download',
    tab_progress: 'Progress',
    tab_history: 'History',
    loading_tab: 'Loading tab…',
    quality_label: 'Quality',
    send_button: 'Send to YT-DLP Minimalist',
    progress_empty_title: 'No downloads in progress.',
    progress_empty_subtext: 'Send a video from the "Download" tab to see it here.',
    filter_all: 'All',
    filter_completed: 'Completed',
    filter_error: 'Error',
    clear_history_title: 'Clear history',
    history_empty: "You haven't sent any video yet.",
    clear_btn: 'Clear',

    quality_opt_best: 'Best quality (video+audio)',
    quality_opt_2160: '2160p 4K',
    quality_opt_1440: '1440p QHD',
    quality_opt_1080: '1080p HD',
    quality_opt_720: '720p HD',
    quality_opt_480: '480p',
    quality_opt_360: '360p',
    quality_opt_240: '240p',
    quality_opt_144: '144p',
    quality_opt_audio_mp3: 'Audio only (MP3)',
    quality_opt_audio_m4a: 'Audio only (M4A)',
    quality_opt_audio_opus: 'Audio only (OPUS)',

    quality_best: 'Best quality',
    quality_audio: 'Audio only',
    quality_audio_fmt: 'Audio only ({format})',
    quality_video_height: '{height}p',

    tab_read_error1: "Couldn't read this tab.",
    tab_read_error2: 'Error reading the tab.',
    sending_ellipsis: 'Sending…',
    pause_btn: 'Pause',
    resume_btn: 'Resume',
    cancel_btn: 'Cancel',
    pause_failed: "Couldn't pause.",
    resume_failed: "Couldn't resume.",
    cancel_failed: "Couldn't cancel.",
    resuming_ellipsis: 'Resuming…',
    completed_check: '✓ Completed',
    error_label: 'Error',
    download_failed_generic: "The download couldn't be completed.",
    cancelled_label: 'Cancelled',
    paused_label: 'Paused',
    paused_meta: 'You can resume or cancel it.',
    no_connection: 'No connection to the app…',
    check_app_open: 'Check that YT-DLP Minimalist is open.',
    starting_ellipsis: 'Starting…',
    downloading_percent: 'Downloading {percent}%',
    eta_label: 'ETA {eta}',
    page_not_sendable: "This page can't be sent.",
    sent_check_review: 'Sent ✓ — check YT-DLP Minimalist',
    opening_app: 'Opening the app…',
    connect_failed: "Couldn't connect. Is the app open?",
    history_status_sent: 'Sent',
    history_status_protocol: 'Opened via app',
    history_status_completed: 'Completed',
    history_status_error: 'Error',
    history_no_filter_results: 'No entries match that filter.',
    open_file_btn: 'Open file',
    open_folder_btn: 'Open folder',
    open_file_not_found: 'Not found',
    open_folder_not_found: 'Not found',
    dismiss_card_title: 'Remove from list',

    overlay_btn_title: 'Download with YT-DLP Minimalist (right-click: choose quality)',
    overlay_download_label: 'Download',
    overlay_close_aria: 'Close',
    overlay_sent_check: 'Sent ✓',
    overlay_opening_app_label: 'Opening app…',
    overlay_open_app_retry_title: 'Did you open the app? — Retry',
    overlay_open_app_retry_label: 'Open the app?',
  },
};

// Lista de calidades compartida por el <select> del popup (ver data-i18n en
// cada <option> de popup.html) y por el menú de calidad del botón flotante
// (content-overlay.js), así ambos lados siempre muestran el mismo texto.
const QUALITY_OPTION_DEFS = [
  { value: 'best', key: 'quality_opt_best' },
  { value: 'video:2160', key: 'quality_opt_2160' },
  { value: 'video:1440', key: 'quality_opt_1440' },
  { value: 'video:1080', key: 'quality_opt_1080' },
  { value: 'video:720', key: 'quality_opt_720' },
  { value: 'video:480', key: 'quality_opt_480' },
  { value: 'video:360', key: 'quality_opt_360' },
  { value: 'video:240', key: 'quality_opt_240' },
  { value: 'video:144', key: 'quality_opt_144' },
  { value: 'audio', key: 'quality_opt_audio_mp3' },
  { value: 'audio:m4a', key: 'quality_opt_audio_m4a' },
  { value: 'audio:opus', key: 'quality_opt_audio_opus' },
];

function i18nNormalizeLang(lang) {
  return lang === 'en' ? 'en' : I18N_DEFAULT_LANG;
}

// Lee el idioma guardado (o el default) desde chrome.storage.sync.
function i18nGetLang(callback) {
  chrome.storage.sync.get({ [I18N_LANG_KEY]: I18N_DEFAULT_LANG }, (data) => {
    callback(i18nNormalizeLang(data[I18N_LANG_KEY]));
  });
}

// Traduce "key" al idioma pedido, reemplazando {variables} si se pasan.
// Si falta la clave en el idioma pedido, cae a español antes que mostrar
// la clave cruda.
function t(key, lang, vars) {
  const dict = I18N_STRINGS[i18nNormalizeLang(lang)] || I18N_STRINGS.es;
  let str = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : I18N_STRINGS.es[key];
  if (str == null) return key;
  if (vars) {
    for (const k in vars) {
      str = str.replace(`{${k}}`, vars[k]);
    }
  }
  return str;
}

// Convierte el objeto "quality" guardado en el historial (ver
// parseQualityValue en url-utils.js) en una etiqueta legible en el idioma
// actual. Soporta también entradas viejas donde "quality" ya era un string
// (guardado antes de este cambio), mostrándolo tal cual.
function formatQualityLabel(quality, lang) {
  if (!quality) return t('quality_best', lang);
  if (typeof quality === 'string') return quality; // entrada vieja, ya traducida en su momento
  if (quality.type === 'audio') {
    if (quality.format && quality.format !== 'mp3') {
      return t('quality_audio_fmt', lang, { format: quality.format.toUpperCase() });
    }
    return t('quality_audio', lang);
  }
  if (quality.type === 'video' && quality.height) {
    return t('quality_video_height', lang, { height: quality.height });
  }
  return t('quality_best', lang);
}

// Aplica las traducciones a todos los elementos marcados con data-i18n /
// data-i18n-title / data-i18n-placeholder en el documento actual. Pensado
// para popup.html, options.html y sidepanel.html.
function applyTranslations(lang) {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'), lang);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'), lang);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'), lang);
  });
}

// Locale usado para formatear fechas/horas (historial), acorde al idioma
// elegido en la extensión.
function i18nDateLocale(lang) {
  return lang === 'en' ? 'en-US' : 'es-ES';
}
