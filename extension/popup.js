// ---- Elementos: pantalla de "enviar" ----
const sendScreen = document.getElementById('sendScreen');
const pageTitleEl = document.getElementById('pageTitle');
const sendBtn = document.getElementById('sendBtn');
const sendAppBtn = document.getElementById('sendAppBtn');
// Los dos botones de envío (con calidad / solo al programa) se bloquean juntos.
function setSendDisabled(v) {
  sendBtn.disabled = v;
  if (sendAppBtn) sendAppBtn.disabled = v;
}
const statusEl = document.getElementById('status');
const qualitySelect = document.getElementById('qualitySelect');

// ---- Elementos: pantalla de progreso / resultado ----
// Ya no hay una única pantalla con IDs fijos: puede haber varias descargas
// en curso a la vez, así que #progressList se llena dinámicamente con una
// tarjeta <li class="progress-card"> por cada una (ver createCard más abajo).
const progressListEl = document.getElementById('progressList');
const progressEmptyState = document.getElementById('progressEmptyState');

// Clave en chrome.storage.local donde guardamos las descargas "activas" (las
// que se mandaron desde este popup, o desde el botón flotante, y todavía no
// llegaron a un estado final). Gracias a esto, si el usuario cierra el popup
// (Chrome lo cierra solo apenas pierde el foco) y lo vuelve a abrir, retoma
// exactamente las tarjetas que había — ahora como lista, no como una sola
// descarga "activa" que las demás pisaban.
const ACTIVE_DOWNLOADS_KEY = 'activeDownloads';
// 'unknown' se agrega acá (además de completed/error/cancelled): es el
// estado que le ponemos a una tarjeta cuando la app ya no tiene registrada
// esa descarga (ver 'notFound' en pollOnce) — no hay nada más que sondear.
const TERMINAL_STATUSES = ['completed', 'error', 'cancelled', 'unknown'];
// Cuánto se deja la tarjeta mostrando su resultado final antes de desvanecerse
// sola (ver scheduleFinalRemoval). Antes eran 1,4 s para todo, muy poco para
// leer un error o llegar a tocar "Abrir carpeta".
//   completed / unknown: tiempo para leer el resultado y abrir archivo/carpeta
//   cancelled:           lo cancelaste vos, no hace falta retenerla
//   error:               null = se queda hasta que la cierres con la "×"
// El resultado queda guardado en storage junto con finishedAt, así sobrevive
// si Chrome cierra el popup mientras tanto (y los errores, hasta que los cierres).
const FINAL_LINGER_MS = { completed: 12000, unknown: 12000, cancelled: 2500, error: null };
// Una descarga enviada SIN calidad ("Enviar al programa", o el botón flotante
// sin calidad elegida) la registra la app recién cuando el usuario elige la
// calidad en su propio selector; hasta entonces /progress contesta "no
// existe". Durante esta ventana eso se muestra como "Esperando en la app…" en
// vez de "Seguimiento perdido".
const AWAITING_APP_MS = 5 * 60 * 1000;
// Si la app se cierra mientras una descarga sigue esperando que elijas la
// calidad, esa elección se pierde (vive solo en la memoria de la app). Pasado
// este tiempo sin conexión, la tarjeta se saca sola en vez de quedar colgada.
const AWAITING_OFFLINE_GRACE_MS = 8000;

// ---- Idioma actual de la interfaz ----
// Se lee de chrome.storage.sync (ver i18n.js) y se aplica tanto al HTML
// estático (data-i18n en popup.html) como a todo el texto generado acá por
// JS (tarjetas de progreso, historial, mensajes de estado).
let currentLang = I18N_DEFAULT_LANG;

let activeTab = null;
let pollTimer = null;
// id -> entry (los mismos campos que antes vivían en el "currentEntry" de
// pollOnce, pero ahora uno por cada descarga en curso en vez de uno solo).
const entriesById = new Map();
// id -> referencias a los elementos DOM de esa tarjeta, para no tener que
// volver a buscarlos con querySelector en cada tick del sondeo.
const cardsById = new Map();

// ---- Pestañas: Descargar / Progreso / Historial ----
// Se define acá arriba (antes de usarse) porque tanto el flujo de "retomar
// estado al abrir el popup" como el de "enviar" necesitan poder cambiar de
// pestaña automáticamente (ej. saltar a "Progreso" apenas arranca una
// descarga), no solo el click manual del usuario en la barra de pestañas.
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = {
  download: document.getElementById('downloadTab'),
  progress: document.getElementById('progressTab'),
  history: document.getElementById('historyTab'),
};

function setActiveUiTab(target) {
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === target));
  Object.entries(tabPanels).forEach(([key, panel]) => {
    panel.classList.toggle('active', key === target);
  });
  if (target === 'history') loadHistory();
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => setActiveUiTab(btn.dataset.tab));
});

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = kind || '';
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// En sitios como X/Twitter, la URL de la pestaña (activeTab.url) no
// necesariamente es la del video que se está viendo — ver el comentario
// grande sobre "isXOrTwitter" en content-overlay.js. Ese content script sí
// tiene acceso al DOM de la página y sabe encontrar el link real, así que
// se lo preguntamos por mensaje en vez de usar tab.url a ciegas. effectiveUrl
/// effectiveTitle quedan guardados junto a activeTab y son lo que
// realmente se manda a descargar (ver sendBtn más abajo).
let effectiveUrl = null;
let effectiveTitle = null;
let effectiveThumb = null;

async function resolveEffectiveUrlAndTitle(tab) {
  if (!tab || !tab.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    return { url: tab && tab.url, title: tab && tab.title };
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'get-effective-url' });
    if (response && response.url) return response;
  } catch (err) {
    // El content script puede no estar inyectado en esta pestaña (recién
    // abierta, página especial, etc.) — seguimos con el fallback de abajo
    // en vez de romper el popup.
  }
  return { url: tab.url, title: tab.title };
}

(async () => {
  try {
    activeTab = await getActiveTab();
    if (activeTab && activeTab.url) {
      const resolved = await resolveEffectiveUrlAndTitle(activeTab);
      effectiveUrl = resolved.url;
      effectiveTitle = resolved.title;
      effectiveThumb = resolved.thumbnail || null;
      pageTitleEl.textContent = effectiveTitle || effectiveUrl;
    } else {
      pageTitleEl.textContent = t('tab_read_error1', currentLang);
      setSendDisabled(true);
    }
  } catch (err) {
    pageTitleEl.textContent = t('tab_read_error2', currentLang);
    setSendDisabled(true);
  }
})();

// ---- Aplicar el idioma guardado apenas se abre el popup ----
i18nGetLang((lang) => {
  currentLang = lang;
  applyTranslations(currentLang);
  const current = document.querySelector(`input[name="language"][value="${currentLang}"]`);
  if (current) current.checked = true;
});

// Recordamos la última calidad elegida para que el select ya venga
// preseleccionado la próxima vez (igual que el modo del botón flotante).
chrome.storage.sync.get({ [QUALITY_STORAGE_KEY]: 'best' }, (data) => {
  // El popup siempre abre en Video: si lo último fue audio se ignora y queda
  // la opción por defecto (mejor calidad de video).
  const saved = String(data[QUALITY_STORAGE_KEY] || '');
  // Tampoco se restaura un contenedor distinto de MP4: el video por defecto es MP4.
  const savedContainer = saved.split(':')[saved.startsWith('video') ? 2 : 1];
  const isMp4OrLegacy = !savedContainer || savedContainer === 'mp4';
  if (!saved.startsWith('audio') && isMp4OrLegacy && [...qualitySelect.options].some((o) => o.value === saved)) {
    qualitySelect.value = data[QUALITY_STORAGE_KEY];
    // Avisa a skin.js (interfaz visual de calidad) para que se redibuje.
    qualitySelect.dispatchEvent(new Event('qualitysync'));
  }
});

qualitySelect.addEventListener('change', () => {
  chrome.storage.sync.set({ [QUALITY_STORAGE_KEY]: qualitySelect.value });
});

// Asigna texto solo si cambió. El sondeo corre cada 800 ms y reasignar el
// mismo string reemplaza el nodo de texto, lo que hace que algunos lectores de
// pantalla vuelvan a anunciar un aria-live sin que haya cambiado nada.
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

// ---- Mostrar/ocultar el estado vacío según haya o no tarjetas ----
function updateEmptyState() {
  const hasCards = progressListEl.children.length > 0;
  progressEmptyState.classList.toggle('show', !hasCards);
  updateProgressBadge();
}

// ---- Contador en la pestaña "Progreso" ----
// Número de descargas vivas; si no queda ninguna pero hay un error esperando
// que lo cierres, un "!" en rojo. Sin nada pendiente, no se muestra.
const progressBadgeEl = document.getElementById('progressBadge');
const progressToolbarEl = document.getElementById('progressToolbar');
const progressSummaryEl = document.getElementById('progressSummary');
const clearFinishedBtn = document.getElementById('clearFinishedBtn');

// ---- Resumen arriba de la lista + botón "Limpiar finalizadas" ----
// Una sola línea con lo que hay en este momento, solo las partes con valor
// ("2 descargando · 1 en pausa"). Clasificación de cada tarjeta:
//   estado final (completed/cancelled/unknown) -> finalizada
//   error                                      -> con error (también limpiable)
//   paused                                     -> en pausa
//   notConnected                               -> sin conexión
//   awaitingApp                                -> esperando en la app
//   cualquier otro                             -> descargando
function updateProgressSummary() {
  if (!progressToolbarEl || !progressSummaryEl) return;
  const c = { downloading: 0, paused: 0, awaiting: 0, offline: 0, error: 0, done: 0 };
  for (const e of entriesById.values()) {
    if (e.status === 'error') c.error++;
    else if (TERMINAL_STATUSES.includes(e.status)) c.done++;
    else if (e.status === 'paused') c.paused++;
    else if (e.notConnected) c.offline++;
    else if (e.awaitingApp) c.awaiting++;
    else c.downloading++;
  }
  const plural = (n, base) => t(`${base}_${n === 1 ? 'one' : 'other'}`, currentLang, { n });
  const parts = [];
  if (c.downloading) parts.push({ cls: 'live', text: t('progress_sum_downloading', currentLang, { n: c.downloading }) });
  if (c.paused)      parts.push({ cls: '',     text: t('progress_sum_paused', currentLang, { n: c.paused }) });
  if (c.awaiting)    parts.push({ cls: '',     text: t('progress_sum_awaiting', currentLang, { n: c.awaiting }) });
  if (c.offline)     parts.push({ cls: 'warn', text: t('progress_sum_offline', currentLang, { n: c.offline }) });
  if (c.error)       parts.push({ cls: 'err',  text: plural(c.error, 'progress_sum_error') });
  if (c.done)        parts.push({ cls: '',     text: plural(c.done, 'progress_sum_done') });

  // Se arma con nodos (no innerHTML) y solo si el texto cambió, para no
  // provocar re-anuncios del aria-live en cada sondeo.
  const key = parts.map((p) => `${p.cls}:${p.text}`).join('|');
  if (progressSummaryEl.dataset.key !== key) {
    progressSummaryEl.dataset.key = key;
    progressSummaryEl.textContent = '';
    parts.forEach((p, i) => {
      if (i) {
        const sep = document.createElement('span');
        sep.className = 'sum-sep';
        sep.textContent = ' · ';
        progressSummaryEl.appendChild(sep);
      }
      const span = document.createElement('span');
      span.className = 'sum-part' + (p.cls ? ` ${p.cls}` : '');
      span.textContent = p.text;
      progressSummaryEl.appendChild(span);
    });
  }
  progressToolbarEl.hidden = parts.length === 0;
  if (clearFinishedBtn) clearFinishedBtn.hidden = c.done + c.error + c.awaiting + c.offline === 0;
}

// Saca de la lista todas las tarjetas que ya llegaron a un estado final
// (incluidos los errores, que de otro modo esperan a que los cierres uno por
// uno). No toca las descargas vivas ni cancela nada en la app. Se guarda una
// sola vez al final (varias escrituras get→set en paralelo se pisarían).
if (clearFinishedBtn) {
  clearFinishedBtn.addEventListener('click', () => {
    // También se quitan las que esperan en la app o están sin conexión (las
    // que muestran la "×"); las descargas vivas no se tocan.
    for (const [id, e] of [...entriesById]) {
      if (TERMINAL_STATUSES.includes(e.status) || e.awaitingApp || e.notConnected) removeCard(id);
    }
    saveActiveDownloads();
    stopPollingIfIdle();
  });
}

function updateProgressBadge() {
  updateProgressSummary();
  if (!progressBadgeEl) return;
  const entries = [...entriesById.values()];
  const live = entries.filter((e) => !TERMINAL_STATUSES.includes(e.status)).length;
  const hasError = entries.some((e) => e.status === 'error');
  progressBadgeEl.classList.toggle('error', live === 0 && hasError);
  if (live > 0) {
    progressBadgeEl.textContent = String(live);
    progressBadgeEl.title = t('progress_badge_live', currentLang, { n: live });
    progressBadgeEl.hidden = false;
  } else if (hasError) {
    progressBadgeEl.textContent = '!';
    progressBadgeEl.title = t('progress_badge_error', currentLang);
    progressBadgeEl.hidden = false;
  } else {
    progressBadgeEl.hidden = true;
  }
}

// Botón del estado vacío: va directo a la pestaña de envío.
const progressGoDownloadBtn = document.getElementById('progressGoDownload');
if (progressGoDownloadBtn) {
  progressGoDownloadBtn.addEventListener('click', () => setActiveUiTab('download'));
}

// ---- Crear la tarjeta (DOM) de una descarga nueva ----
// Devuelve las referencias a sus elementos internos para no tener que
// volver a buscarlas con querySelector cada vez que se actualiza (ver
// updateCard). Los botones quedan atados al "id" de ESTA tarjeta desde el
// momento en que se crean, así que funcionan igual sin importar cuántas
// otras descargas haya en curso al mismo tiempo.
function createCard(entry) {
  const li = document.createElement('li');
  li.className = 'progress-card';
  li.dataset.id = entry.id;
  li.innerHTML = `
    <button type="button" class="progress-card-close" title="${t('dismiss_card_title', currentLang)}" data-i18n-title="dismiss_card_title">&times;</button>
    <div class="progress-head">
      <img class="progress-thumb" alt="" hidden>
      <div class="progress-title"></div>
    </div>
    <div class="progress-bar-wrap" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar-fill"></div></div>
    <div class="progress-status-row">
      <span class="progress-status-text" aria-live="polite">${t('sending_ellipsis', currentLang)}</span>
      <span class="progress-percent"></span>
    </div>
    <div class="progress-meta"></div>
    <div class="entry-actions progress-actions" hidden>
      <button type="button" class="entry-action-btn open-file-btn">${t('open_file_btn', currentLang)}</button>
      <button type="button" class="entry-action-btn open-folder-btn">${t('open_folder_btn', currentLang)}</button>
    </div>
    <div class="download-controls">
      <button type="button" class="pause-btn">${t('pause_btn', currentLang)}</button>
      <button type="button" class="resume-btn">${t('resume_btn', currentLang)}</button>
      <button type="button" class="cancel-btn">${t('cancel_btn', currentLang)}</button>
    </div>
  `;

  const refs = {
    el: li,
    closeBtn: li.querySelector('.progress-card-close'),
    title: li.querySelector('.progress-title'),
    barFill: li.querySelector('.progress-bar-fill'),
    statusText: li.querySelector('.progress-status-text'),
    meta: li.querySelector('.progress-meta'),
    bar: li.querySelector('.progress-bar-wrap'),
    thumb: li.querySelector('.progress-thumb'),
    percent: li.querySelector('.progress-percent'),
    actions: li.querySelector('.progress-actions'),
    openFileBtn: li.querySelector('.open-file-btn'),
    openFolderBtn: li.querySelector('.open-folder-btn'),
    controls: li.querySelector('.download-controls'),
    pauseBtn: li.querySelector('.pause-btn'),
    resumeBtn: li.querySelector('.resume-btn'),
    cancelBtn: li.querySelector('.cancel-btn'),
  };

  // Sacar la tarjeta a mano (ver CSS .progress-card-close): no depende de
  // que la app responda, así que sirve tanto para descargas ya terminadas
  // que el usuario no quiere seguir viendo como para las que se quedaron
  // en "Sin conexión con la app…" y nunca más se van a resolver solas.
  // No cancela nada del lado de la app — si la descarga seguía corriendo
  // ahí, sigue corriendo; esto solo deja de mostrarla/seguirla acá.
  refs.closeBtn.addEventListener('click', () => {
    removeActiveDownloadFromStorage(entry.id);
    removeCard(entry.id);
    stopPollingIfIdle();
  });

  refs.pauseBtn.addEventListener('click', () => {
    refs.pauseBtn.disabled = true;
    refs.cancelBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'pause-download', id: entry.id }, (response) => {
      if (!response || !response.ok) {
        refs.meta.textContent = t('pause_failed', currentLang);
        refs.pauseBtn.disabled = false;
        refs.cancelBtn.disabled = false;
      }
    });
  });

  refs.resumeBtn.addEventListener('click', () => {
    refs.resumeBtn.disabled = true;
    refs.cancelBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'resume-download', id: entry.id }, (response) => {
      if (!response || !response.ok) {
        refs.meta.textContent = t('resume_failed', currentLang);
        refs.resumeBtn.disabled = false;
        refs.cancelBtn.disabled = false;
      } else {
        setText(refs.statusText, t('resuming_ellipsis', currentLang));
        refs.meta.textContent = '';
      }
    });
  });

  refs.cancelBtn.addEventListener('click', () => {
    refs.pauseBtn.disabled = true;
    refs.cancelBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'cancel-download', id: entry.id }, (response) => {
      if (!response || !response.ok) {
        refs.meta.textContent = t('cancel_failed', currentLang);
        refs.pauseBtn.disabled = false;
        refs.cancelBtn.disabled = false;
      }
    });
  });

  // Abrir archivo / carpeta al terminar (mismos mensajes que usa el historial;
  // la ruta se lee de la entrada vigente porque se actualiza en cada sondeo).
  refs.openFileBtn.addEventListener('click', () => {
    const cur = entriesById.get(entry.id) || entry;
    if (!cur.path) return;
    refs.openFileBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'open-file-by-path', path: cur.path }, (response) => {
      refs.openFileBtn.disabled = false;
      if (!response || !response.ok) {
        flashActionError(refs.openFileBtn, t('open_file_not_found', currentLang));
      }
    });
  });

  refs.openFolderBtn.addEventListener('click', () => {
    const cur = entriesById.get(entry.id) || entry;
    if (!cur.path && !cur.folder) return;
    refs.openFolderBtn.disabled = true;
    chrome.runtime.sendMessage(
      { type: 'open-folder-by-path', path: cur.path, folder: cur.folder },
      (response) => {
        refs.openFolderBtn.disabled = false;
        if (!response || !response.ok) {
          flashActionError(refs.openFolderBtn, t('open_folder_not_found', currentLang));
        }
      }
    );
  });

  cardsById.set(entry.id, refs);
  // Va arriba de todo (no al final): así la descarga más reciente queda
  // siempre visible sin tener que scrollear, y las anteriores se van
  // corriendo hacia abajo a medida que se agregan nuevas. Esto también hace
  // que, al reabrir el popup (ver el bloque que retoma "activeDownloads" más
  // abajo), las tarjetas terminen ordenadas de más nueva a más vieja, ya que
  // ese bloque llama a createCard en orden cronológico (la más vieja
  // primero) y cada una va empujando a la anterior hacia abajo.
  progressListEl.insertBefore(li, progressListEl.firstChild);
  updateEmptyState();
  return refs;
}

// Miniatura de la tarjeta: YouTube por URL, el resto con la que resolvió
// resolveEffectiveUrlAndTitle() al enviar (entry.thumbnail). Se resuelve una sola vez.
function ensureCardThumb(refs, entry) {
  if (refs.thumbResolved) return;
  const src = (entry.url && youtubeThumbnailUrl(entry.url)) || entry.thumbnail || null;
  if (!src) return;
  refs.thumbResolved = true;
  refs.thumb.addEventListener('error', () => { refs.thumb.hidden = true; }, { once: true });
  refs.thumb.referrerPolicy = 'no-referrer';
  refs.thumb.src = src;
  refs.thumb.hidden = false;
}

// ---- Pintar el estado actual de UNA tarjeta puntual ----
function updateCard(id) {
  const entry = entriesById.get(id);
  const refs = cardsById.get(id);
  if (!entry || !refs) return;

  refs.title.textContent = entry.title || entry.url || '';
  ensureCardThumb(refs, entry);

  const percent = typeof entry.percent === 'number' ? Math.max(0, Math.min(100, entry.percent)) : null;
  const percentLabel = percent !== null ? `${percent.toFixed(0)}%` : '';
  const isFinal = TERMINAL_STATUSES.includes(entry.status);

  refs.barFill.classList.remove('indeterminate', 'done', 'error');
  refs.controls.classList.remove('show');
  refs.actions.hidden = true;
  refs.percent.textContent = '';
  // La "×" solo oculta la tarjeta (no cancela nada en la app), así que
  // se ofrece únicamente cuando ya no hay una descarga viva que controlar:
  // estados finales o "Sin conexión". Mientras descarga, mandan Pausar/Cancelar.
  refs.closeBtn.hidden = !(isFinal || entry.notConnected || entry.awaitingApp);

  if (entry.status === 'completed') {
    refs.barFill.style.width = '100%';
    refs.barFill.classList.add('done');
    setText(refs.statusText, t('completed_check', currentLang));
    refs.statusText.className = 'progress-status-text success';
    refs.percent.textContent = '100%';
    refs.meta.textContent = entry.folder || entry.path || '';
    refs.actions.hidden = !entry.path;
  } else if (entry.status === 'error') {
    refs.barFill.style.width = percent !== null ? `${percent}%` : '100%';
    refs.barFill.classList.add('error');
    setText(refs.statusText, t('error_label', currentLang));
    refs.statusText.className = 'progress-status-text error';
    refs.percent.textContent = percentLabel;
    refs.meta.textContent = entry.error || t('download_failed_generic', currentLang);
  } else if (entry.status === 'cancelled') {
    refs.barFill.style.width = percent !== null ? `${percent}%` : '0%';
    setText(refs.statusText, t('cancelled_label', currentLang));
    refs.statusText.className = 'progress-status-text';
    refs.meta.textContent = '';
  } else if (entry.status === 'unknown') {
    refs.barFill.style.width = percent !== null ? `${percent}%` : '0%';
    setText(refs.statusText, t('progress_lost_label', currentLang));
    refs.statusText.className = 'progress-status-text';
    refs.meta.textContent = t('progress_lost_meta', currentLang);
  } else if (entry.status === 'paused') {
    refs.barFill.style.width = percent !== null ? `${percent}%` : '0%';
    setText(refs.statusText, t('paused_label', currentLang));
    refs.statusText.className = 'progress-status-text';
    refs.percent.textContent = percentLabel;
    refs.meta.textContent = t('paused_meta', currentLang);
    // En pausa se ofrece reanudar (en vez de pausar) + cancelar.
    refs.pauseBtn.classList.add('hide');
    refs.resumeBtn.classList.add('show');
    refs.resumeBtn.disabled = false;
    refs.cancelBtn.disabled = false;
    refs.controls.classList.add('show');
  } else if (entry.notConnected) {
    // No pudimos consultar el estado (la app no responde). No sabemos si
    // sigue corriendo o no, así que dejamos la barra como estaba y solo
    // avisamos en el texto de estado.
    if (percent !== null) refs.barFill.style.width = `${percent}%`;
    setText(refs.statusText, t('no_connection', currentLang));
    refs.statusText.className = 'progress-status-text offline';
    refs.percent.textContent = percentLabel;
    refs.meta.textContent = t('check_app_open', currentLang);
  } else if (entry.awaitingApp) {
    // Todavía no hay descarga que pausar/cancelar: solo se avisa dónde falta
    // actuar. La "×" queda disponible por si el usuario cierra el selector.
    refs.barFill.style.width = '40%';
    refs.barFill.classList.add('indeterminate');
    setText(refs.statusText, t('awaiting_app_label', currentLang));
    refs.statusText.className = 'progress-status-text';
    refs.meta.textContent = t('awaiting_app_meta', currentLang);
  } else {
    // 'starting' | 'downloading' | sin dato de % todavía
    refs.controls.classList.add('show');
    // Estado "descargando": se ve pausar + cancelar (por si venía de un
    // "reanudar" previo, se restaura pauseBtn y se oculta resumeBtn).
    refs.pauseBtn.classList.remove('hide');
    refs.resumeBtn.classList.remove('show');
    refs.pauseBtn.disabled = false;
    refs.cancelBtn.disabled = false;
    if (percent === null) {
      refs.barFill.style.width = '40%';
      refs.barFill.classList.add('indeterminate');
      setText(refs.statusText, t('starting_ellipsis', currentLang));
    } else {
      refs.barFill.style.width = `${percent}%`;
      setText(refs.statusText, t('downloading_label', currentLang));
      refs.percent.textContent = percentLabel;
    }
    refs.statusText.className = 'progress-status-text';
    const metaParts = [];
    if (entry.speed) metaParts.push(entry.speed);
    if (entry.eta) metaParts.push(t('eta_label', currentLang, { eta: entry.eta }));
    refs.meta.textContent = metaParts.join(' · ');
  }

  // Accesibilidad: nombre de la barra (qué descarga es), valor actual (sin
  // valor mientras es indeterminada) y un texto legible con estado + porcentaje
  // ("Descargando 45%"), que los lectores de pantalla leen en vez del número solo.
  refs.bar.setAttribute('aria-label', t('progressbar_label', currentLang, { title: refs.title.textContent }));
  if (refs.barFill.classList.contains('indeterminate')) {
    refs.bar.removeAttribute('aria-valuenow');
  } else {
    refs.bar.setAttribute('aria-valuenow', String(Math.round(parseFloat(refs.barFill.style.width) || 0)));
  }
  refs.bar.setAttribute('aria-valuetext', [refs.statusText.textContent, refs.percent.textContent].filter(Boolean).join(' '));

  updateProgressBadge();
}

// ---- Sacar una tarjeta de la lista (con una animación corta de salida) ----
function removeCard(id) {
  const refs = cardsById.get(id);
  cardsById.delete(id);
  entriesById.delete(id);
  updateProgressBadge();
  if (refs && refs.el) {
    refs.el.classList.add('removing');
    setTimeout(() => {
      refs.el.remove();
      updateEmptyState();
    }, 320);
  } else {
    updateEmptyState();
  }
}

// ---- Sacar sola una tarjeta que llegó a un estado final ----
// Respeta FINAL_LINGER_MS desde finishedAt (así, si el popup se cerró y se
// reabrió, solo queda el tiempo que faltaba). Los errores no se programan:
// quedan hasta que el usuario los cierre. Si el mouse está encima de la
// tarjeta (leyendo, o por tocar "Abrir carpeta") se espera un poco más.
function scheduleFinalRemoval(id) {
  const entry = entriesById.get(id);
  if (!entry) return;
  const linger = FINAL_LINGER_MS[entry.status];
  if (linger == null) return;
  const elapsed = Date.now() - (entry.finishedAt || Date.now());
  const attempt = (wait) => setTimeout(() => {
    const refs = cardsById.get(id);
    if (!entriesById.has(id)) return;
    if (refs && refs.el.matches(':hover')) {
      attempt(2000);
      return;
    }
    removeActiveDownloadFromStorage(id);
    removeCard(id);
    stopPollingIfIdle();
  }, wait);
  attempt(Math.max(0, linger - elapsed));
}

// ---- Guardar/leer la lista de descargas activas ----
// A diferencia de antes (una sola clave que cada descarga nueva pisaba),
// ahora es una lista: cada descarga ocupa su propio lugar por "id" y no
// afecta a las demás que sigan en curso al mismo tiempo.
function getActiveDownloads() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [ACTIVE_DOWNLOADS_KEY]: [] }, (data) => {
      resolve(data[ACTIVE_DOWNLOADS_KEY] || []);
    });
  });
}

function saveActiveDownloads() {
  const list = [...entriesById.values()];
  chrome.storage.local.set({ [ACTIVE_DOWNLOADS_KEY]: list });
}

function removeActiveDownloadFromStorage(id) {
  chrome.storage.local.get({ [ACTIVE_DOWNLOADS_KEY]: [] }, (data) => {
    const list = (data[ACTIVE_DOWNLOADS_KEY] || []).filter((e) => e.id !== id);
    chrome.storage.local.set({ [ACTIVE_DOWNLOADS_KEY]: list });
  });
}

// ---- Agregar una descarga nueva a la lista (crea su tarjeta y la sondea) ----
function addDownload(entry) {
  entriesById.set(entry.id, entry);
  createCard(entry);
  updateCard(entry.id);
  saveActiveDownloads();
  ensurePolling();
}

// ---- Sondeo del progreso mientras el popup está abierto ----
// Un único intervalo compartido que, en cada vuelta, consulta el progreso
// de TODAS las descargas activas (no solo la última) — así una tarjeta no
// tiene que esperar a que la anterior termine para empezar a actualizarse.
function ensurePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollTick, 800);
}

function stopPollingIfIdle() {
  // Las tarjetas en estado final (p. ej. un error esperando que lo cierres)
  // ya no se sondean, así que el intervalo solo hace falta mientras quede
  // alguna descarga viva.
  const hasLive = [...entriesById.values()].some((e) => !TERMINAL_STATUSES.includes(e.status));
  if (!hasLive && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function pollTick() {
  for (const [id, currentEntry] of entriesById) {
    // Los estados finales ya no se re-consultan: la tarjeta correspondiente
    // está en camino a desvanecerse (ver removeCard, agendado la primera
    // vez que se detectó ese estado final más abajo).
    if (TERMINAL_STATUSES.includes(currentEntry.status)) continue;
    pollOnce(id, currentEntry);
  }
}

function pollOnce(id, currentEntry) {
  chrome.runtime.sendMessage({ type: 'get-progress', id }, (response) => {
    // La tarjeta pudo haberse sacado de la lista mientras esperábamos la
    // respuesta (ej. el usuario canceló y ya se procesó el estado final).
    if (!entriesById.has(id)) return;

    if (response && response.notFound) {
      // La app está corriendo y respondió, pero ya no tiene registrada esta
      // descarga (pasaron más de 30 min sin novedades, o se reinició desde
      // entonces — ver EXTENSION_DOWNLOAD_TTL_MS en main.js). A diferencia
      // de "sin conexión" (donde sí tiene sentido seguir reintentando por si
      // vuelve), acá reintentar para siempre no sirve de nada: este id no va
      // a volver a existir. Lo tratamos como un final "desconocido" para que
      // la tarjeta se saque sola, igual que completed/error/cancelled, y así
      // la lista de Progreso deje de acumular tarjetas fantasma.
      // Sin calidad elegida todavía: la app aún no registró esta descarga porque
      // espera que el usuario elija en su selector. No es un seguimiento
      // perdido: se espera (hasta AWAITING_APP_MS) y se sigue sondeando.
      const startedAt = currentEntry.startedAt || Date.now();
      if (!currentEntry.quality && Date.now() - startedAt < AWAITING_APP_MS) {
        entriesById.set(id, { ...currentEntry, startedAt, awaitingApp: true, notConnected: false, offlineSince: undefined });
        updateCard(id);
        saveActiveDownloads();
        return;
      }
      const merged = { ...currentEntry, status: 'unknown', awaitingApp: false, notConnected: false, finishedAt: Date.now() };
      entriesById.set(id, merged);
      updateCard(id);
      saveActiveDownloads();
      scheduleFinalRemoval(id);
      stopPollingIfIdle();
      return;
    }

    if (!response || !response.ok) {
      // La app puede no estar corriendo. No borramos el estado guardado por
      // las dudas de que sea un corte momentáneo; seguimos reintentando.
      // Si todavía no había empezado (sin calidad elegida, nunca llegó a
      // descargar) y la app lleva unos segundos sin responder, la app se cerró
      // y esta descarga ya no existe: se saca la tarjeta sola.
      // (Solo si la app ya había respondido antes: al abrirla en frío puede tardar en arrancar.)
      const neverStarted = !currentEntry.quality && currentEntry.awaitingApp;
      if (neverStarted) {
        const offlineSince = currentEntry.offlineSince || Date.now();
        if (Date.now() - offlineSince >= AWAITING_OFFLINE_GRACE_MS) {
          removeCard(id);
          saveActiveDownloads();
          stopPollingIfIdle();
          return;
        }
        entriesById.set(id, { ...currentEntry, notConnected: true, offlineSince });
        updateCard(id);
        return;
      }
      const merged = { ...currentEntry, notConnected: true };
      entriesById.set(id, merged);
      updateCard(id);
      return;
    }
    const merged = {
      ...currentEntry,
      status: response.status,
      percent: response.percent,
      speed: response.speed,
      eta: response.eta,
      path: response.path,
      folder: response.folder,
      error: response.error,
      title: response.title || currentEntry.title,
      notConnected: false,
      awaitingApp: false,
      offlineSince: undefined,
      finishedAt: TERMINAL_STATUSES.includes(response.status) ? (currentEntry.finishedAt || Date.now()) : undefined,
    };
    entriesById.set(id, merged);
    updateCard(id);
    saveActiveDownloads();
    if (TERMINAL_STATUSES.includes(response.status)) {
      // Reflejamos el resultado final en la entrada del historial (que hasta
      // ahora solo decía "Enviado") para que los filtros de la pestaña
      // Historial (Completados / Error) tengan datos reales con los que
      // trabajar.
      const historyStatus = response.status === 'cancelled' ? 'error' : response.status;
      chrome.runtime.sendMessage({
        type: 'update-history-status',
        downloadId: id,
        status: historyStatus,
        extra: { path: response.path, folder: response.folder, error: response.error },
      });
      // La tarjeta queda guardada con su resultado (ya con finishedAt, ver
      // saveActiveDownloads más arriba) y se saca sola pasado FINAL_LINGER_MS;
      // los errores se quedan hasta que se cierren a mano.
      scheduleFinalRemoval(id);
      stopPollingIfIdle();
    }
  });
}

// ---- Retomar el estado al abrir el popup ----
// Recrea una tarjeta por cada descarga que seguía en curso la última vez
// que se cerró el popup (pueden ser varias a la vez).
(async () => {
  const list = await getActiveDownloads();
  if (!list.length) return;

  const now = Date.now();
  const expired = new Set();
  let jumpToProgress = false;
  let hasLive = false;

  for (const entry of list) {
    if (!entry || !entry.id) continue;
    const isFinal = TERMINAL_STATUSES.includes(entry.status);

    // Resultado final que ya cumplió su tiempo mientras el popup estaba
    // cerrado: se descarta. Los errores se conservan hasta que se cierren.
    if (isFinal && entry.status !== 'error') {
      const linger = FINAL_LINGER_MS[entry.status] ?? 0;
      if (now - (entry.finishedAt || 0) >= linger) {
        expired.add(entry.id);
        continue;
      }
    }

    entriesById.set(entry.id, entry);
    createCard(entry);
    updateCard(entry.id);

    if (isFinal) {
      scheduleFinalRemoval(entry.id);
      // Un error pendiente es lo único final que justifica mover al usuario
      // a Progreso al abrir el popup; un "completado" viejo no.
      if (entry.status === 'error') jumpToProgress = true;
    } else {
      hasLive = true;
      jumpToProgress = true;
    }
  }

  // Una sola escritura (varias get→set en paralelo se pisarían entre sí).
  if (expired.size) {
    chrome.storage.local.set({ [ACTIVE_DOWNLOADS_KEY]: list.filter((e) => e && !expired.has(e.id)) });
  }
  if (jumpToProgress) setActiveUiTab('progress');
  if (hasLive) ensurePolling();
})();

// ---- Enviar la URL actual ----
async function sendCurrent(withoutQuality) {
  if (!activeTab || !activeTab.url) return;
  if (currentSiteExtensionDisabled) return;

  // No tiene sentido mandar páginas internas del navegador.
  if (!/^https?:\/\//i.test(activeTab.url)) {
    setStatus(t('page_not_sendable', currentLang), 'error');
    return;
  }

  // Recorte opcional (lo maneja skin.js). Se valida ANTES de bloquear el botón
  // para poder mostrar el error y dejar corregir los tiempos.
  const trimResult = !withoutQuality && typeof window.skinGetTrim === 'function' ? window.skinGetTrim() : { trim: null };
  if (trimResult.error) {
    setStatus(trimResult.error, 'error');
    return;
  }

  setSendDisabled(true);
  setStatus(t('sending_ellipsis', currentLang));

  // Sin calidad: la app abre su propio selector (igual que el clic en el botón flotante).
  const quality = withoutQuality ? null : parseQualityValue(qualitySelect.value);
  if (quality && trimResult.trim) quality.trim = trimResult.trim;
  // Usamos lo que resolvió resolveEffectiveUrlAndTitle() (el link real del
  // tweet en X/Twitter, o tab.url/tab.title en cualquier otro sitio) en vez
  // de activeTab.title/activeTab.url directamente.
  const title = effectiveTitle || activeTab.title || '';
  const url = cleanDownloadUrl(effectiveUrl || activeTab.url);

  chrome.runtime.sendMessage(
    { type: 'send-url', url, title, quality, thumbnail: youtubeThumbnailUrl(url) ? null : effectiveThumb },
    (response) => {
      if (response && response.ok) {
        if (response.id) {
          // background.js ya guardó el snapshot inicial en
          // chrome.storage.local (ver ACTIVE_DOWNLOADS_KEY en background.js);
          // acá solo agregamos su tarjeta y arrancamos el sondeo, sin tocar
          // las tarjetas de otras descargas que ya estuvieran en curso.
          const entry = {
            id: response.id,
            url,
            title,
            quality,
            status: 'starting',
            percent: null,
            speed: null,
            eta: null,
            thumbnail: effectiveThumb || null,
            startedAt: Date.now(),
          };
          addDownload(entry);
          // Ya se envió: liberamos el botón y limpiamos "Enviando…" para poder
          // elegir otra calidad y descargar de nuevo sin cerrar el popup.
          setSendDisabled(!!currentSiteExtensionDisabled);
          setStatus('');
          setActiveUiTab('progress');
        } else {
          // La app respondió sin id (versión vieja del servidor, poco
          // probable pero por las dudas no rompemos el flujo): avisamos
          // como antes y cerramos.
          setStatus(t('sent_check_review', currentLang), 'success');
          setTimeout(() => window.close(), 900);
        }
      } else if (response && response.needsProtocol) {
        const a = document.createElement('a');
        a.href = buildProtocolUrl(response.url, quality, response.id);
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setSendDisabled(false);

        if (response.id) {
          // Aunque la app recién se está abriendo, ya podemos arrancar a
          // sondear el progreso con el id que generamos nosotros mismos
          // (ver generateClientDownloadId en background.js) y que viaja
          // también en el link de protocolo de arriba (ver extId en
          // buildProtocolUrl): apenas la app termine de abrir y registre
          // esta descarga, /progress empieza a responder con datos reales.
          // Hasta entonces, pollOnce ya maneja con gracia el "sin conexión"
          // (ver notConnected en updateCard) reintentando solo.
          const entry = {
            id: response.id,
            url,
            title,
            quality,
            status: 'starting',
            percent: null,
            speed: null,
            eta: null,
            thumbnail: effectiveThumb || null,
            startedAt: Date.now(),
          };
          addDownload(entry);
          setStatus('');
          setActiveUiTab('progress');
        } else {
          setStatus(t('opening_app', currentLang), 'success');
        }
      } else {
        setStatus(t('connect_failed', currentLang), 'error');
        setSendDisabled(false);
      }
    }
  );
}

sendBtn.addEventListener('click', () => sendCurrent(false));
if (sendAppBtn) sendAppBtn.addEventListener('click', () => sendCurrent(true));

// Nota: "Abrir archivo/carpeta", "Pausar/Reanudar/Cancelar" y el reinicio de
// pantalla al terminar ya no son listeners únicos acá — cada tarjeta trae
// los suyos, atados a su propio id, desde el momento en que se crea (ver
// createCard más arriba). Con varias descargas en curso a la vez, cada una
// controla solo la suya sin pisar a las demás. Tampoco hace falta un botón
// "Nueva descarga": la tarjeta se saca sola de la lista al terminar (ver
// removeCard), y la pestaña "Descargar" ya está siempre disponible aparte.

// ---- Historial (dentro del popup, ya no en panel lateral aparte) ----
const HISTORY_KEY = 'sendHistory';
const historyListEl = document.getElementById('historyList');
const historyEmptyEl = document.getElementById('historyEmpty');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const filterButtons = document.querySelectorAll('.filter-btn');
let historyFilter = 'all';
let fullHistory = [];

function historyStatusLabel(status) {
  return t(`history_status_${status || 'sent'}`, currentLang);
}

function formatHistoryTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const locale = i18nDateLocale(currentLang);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const date = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  return `${date} ${time}`;
}

function renderHistory() {
  const filtered =
    historyFilter === 'all' ? fullHistory : fullHistory.filter((e) => e.status === historyFilter);

  historyListEl.innerHTML = '';
  clearHistoryBtn.disabled = fullHistory.length === 0;
  historyEmptyEl.style.display = filtered.length === 0 ? 'block' : 'none';
  historyEmptyEl.textContent =
    fullHistory.length === 0
      ? t('history_empty', currentLang)
      : t('history_no_filter_results', currentLang);

  for (const entry of filtered) {
    const li = document.createElement('li');
    li.className = 'entry';

    const title = document.createElement('div');
    title.className = 'entry-title';
    title.textContent = entry.title || entry.url;
    title.title = entry.title || entry.url;

    const url = document.createElement('div');
    url.className = 'entry-url';
    url.textContent = entry.url;
    url.title = entry.url;

    const meta = document.createElement('div');
    meta.className = 'entry-meta';

    const time = document.createElement('span');
    time.className = 'entry-time';
    time.textContent = entry.quality
      ? `${formatHistoryTime(entry.timestamp)} · ${formatQualityLabel(entry.quality, currentLang)}`
      : formatHistoryTime(entry.timestamp);

    const status = document.createElement('span');
    status.className = `entry-status ${entry.status || 'sent'}`;
    status.textContent = historyStatusLabel(entry.status);

    meta.appendChild(time);
    meta.appendChild(status);

    // Miniatura a la izquierda (solo YouTube) y el resto del contenido en una
    // columna a la derecha.
    const body = document.createElement('div');
    body.className = 'entry-body';
    body.appendChild(title);
    body.appendChild(url);
    body.appendChild(meta);

    const thumbUrl = youtubeThumbnailUrl(entry.url) || entry.thumbnail || null;
    if (thumbUrl) {
      li.classList.add('has-thumb');
      const img = document.createElement('img');
      img.className = 'entry-thumb';
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.src = thumbUrl;
      img.addEventListener('error', () => { img.remove(); li.classList.remove('has-thumb'); });
      li.appendChild(img);
    }
    li.appendChild(body);

    // "Abrir archivo"/"Abrir carpeta" solo tienen sentido si esta entrada
    // llegó a completarse Y el popup estaba abierto (con el sondeo corriendo)
    // en ese momento para guardarle la ruta final — ver el "extra: { path,
    // folder }" que manda pollOnce a 'update-history-status'. Entradas viejas
    // de antes de este cambio, o completadas sin el popup abierto, no van a
    // tener path y por eso no muestran estos botones.
    if (entry.status === 'completed' && entry.path) {
      const actions = document.createElement('div');
      actions.className = 'entry-actions';

      const openFileButton = document.createElement('button');
      openFileButton.type = 'button';
      openFileButton.className = 'entry-action-btn';
      openFileButton.textContent = t('open_file_btn', currentLang);
      openFileButton.addEventListener('click', () => {
        openFileButton.disabled = true;
        chrome.runtime.sendMessage({ type: 'open-file-by-path', path: entry.path }, (response) => {
          openFileButton.disabled = false;
          if (!response || !response.ok) {
            flashActionError(openFileButton, t('open_file_not_found', currentLang));
          }
        });
      });

      const openFolderButton = document.createElement('button');
      openFolderButton.type = 'button';
      openFolderButton.className = 'entry-action-btn';
      openFolderButton.textContent = t('open_folder_btn', currentLang);
      openFolderButton.addEventListener('click', () => {
        openFolderButton.disabled = true;
        chrome.runtime.sendMessage(
          { type: 'open-folder-by-path', path: entry.path, folder: entry.folder },
          (response) => {
            openFolderButton.disabled = false;
            if (!response || !response.ok) {
              flashActionError(openFolderButton, t('open_folder_not_found', currentLang));
            }
          }
        );
      });

      actions.appendChild(openFileButton);
      actions.appendChild(openFolderButton);
      body.appendChild(actions);
    }

    historyListEl.appendChild(li);
  }
}

// Muestra brevemente un motivo de error en el propio botón (en vez de un
// mensaje aparte) y a los ~1.6s vuelve a su texto normal.
function flashActionError(button, message) {
  const original = button.textContent;
  button.textContent = message;
  button.classList.add('error');
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('error');
  }, 1600);
}

async function loadHistory() {
  const data = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  fullHistory = data[HISTORY_KEY];
  renderHistory();
}

// Si el historial cambia mientras el popup está abierto (por ejemplo, una
// descarga que arrancó desde el botón flotante termina), lo reflejamos sin
// que el usuario tenga que cerrar y reabrir el popup.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[HISTORY_KEY]) {
    fullHistory = changes[HISTORY_KEY].newValue || [];
    renderHistory();
  }
});

filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    historyFilter = btn.dataset.filter;
    filterButtons.forEach((b) => b.classList.toggle('active', b === btn));
    renderHistory();
  });
});

clearHistoryBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clear-history' });
});

const optionsLinkEl = document.getElementById('optionsLink');
const settingsPanelEl = document.getElementById('settingsPanel');

function closeSettingsPanel() {
  settingsPanelEl.classList.remove('open');
  optionsLinkEl.setAttribute('aria-expanded', 'false');
}

optionsLinkEl.addEventListener('click', (e) => {
  // Sin esto, el mismo click que abre el panel llegaría también al
  // listener de "afuera" de abajo (los eventos de click burbujean hasta
  // document) y lo cerraría en el acto.
  e.stopPropagation();
  const isOpen = settingsPanelEl.classList.toggle('open');
  optionsLinkEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  if (isOpen) positionSettingsPanel(optionsLinkEl, settingsPanelEl);
});

// Cerrar el panel al clickear afuera (del panel y del propio engranaje).
document.addEventListener('click', (e) => {
  if (!settingsPanelEl.classList.contains('open')) return;
  if (settingsPanelEl.contains(e.target) || optionsLinkEl.contains(e.target)) return;
  closeSettingsPanel();
});

// Ubica el panel de ajustes con position:fixed, pegado a la esquina
// inferior derecha del engranaje (en vez de coordenadas fijas en CSS), y le
// pone un max-height acorde al espacio que realmente queda debajo dentro
// del popup. Así el panel nunca empuja el alto del documento — si su
// contenido no entra, scrollea internamente (overflow-y: auto en el CSS)
// en vez de agrandar el popup completo. Ver el comentario sobre "overflow:
// hidden" en el <style> de popup.html para el porqué de todo esto.
function positionSettingsPanel(link, panel) {
  const rect = link.getBoundingClientRect();
  const margin = 8;
  panel.style.top = Math.round(rect.bottom + 6) + 'px';
  panel.style.right = Math.round(window.innerWidth - rect.right) + 'px';
  panel.style.left = 'auto';
  panel.style.maxHeight = Math.max(120, window.innerHeight - rect.bottom - 6 - margin) + 'px';
  panel.style.overflowY = 'auto';
}

// --- Ajustes del botón flotante (inline, sin abrir otra ventana) ---
const modeRadios = document.querySelectorAll('input[name="mode"]');
const savedEl = document.getElementById('saved');

chrome.storage.sync.get({ overlayMode: 'icon' }, (data) => {
  const current = document.querySelector(`input[name="mode"][value="${data.overlayMode}"]`);
  if (current) current.checked = true;
});

function showSaved() {
  savedEl.classList.add('show');
  setTimeout(() => savedEl.classList.remove('show'), 1200);
}

// Tema del botón flotante (claro / oscuro).
const themeRadios = document.querySelectorAll('input[name="theme"]');
chrome.storage.sync.get({ overlayTheme: 'light' }, (data) => {
  const cur = document.querySelector(`input[name="theme"][value="${data.overlayTheme === 'dark' ? 'dark' : 'light'}"]`);
  if (cur) cur.checked = true;
});
themeRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    chrome.storage.sync.set({ overlayTheme: radio.value }, showSaved);
  });
});

modeRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    chrome.storage.sync.set({ overlayMode: radio.value }, showSaved);
  });
});

// --- Barra rápida junto al engranaje: abrir programa / botón flotante / auto-abrir popup ---

// "Abrir programa": dispara el link de protocolo sin URL (ver
// buildOpenProtocolUrl en url-utils.js). El sistema operativo abre la app
// si estaba cerrada, o la trae al frente si ya estaba corriendo (ver
// focusMainWindow en src/main.js). Igual que con las descargas, se hace con
// un clic real sobre un <a> en vez de chrome.tabs.create, para que el
// navegador maneje el diálogo "¿Abrir YT-DLP Minimalist?" en el contexto
// del propio popup en vez de abrir una pestaña nueva de por medio.
document.getElementById('openAppBtn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = buildOpenProtocolUrl();
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// "Botón flotante": muestra/oculta el botón que aparece sobre los videos
// (content-overlay.js). Se guarda aparte del "overlayMode" (ícono/texto)
// para no perder la preferencia de estilo elegida cuando se apaga y
// se vuelve a prender.
const overlayEnabledToggle = document.getElementById('overlayEnabledToggle');
// "Auto-abrir": si está activo, cada vez que se manda una descarga (desde
// este popup o desde el botón flotante) se intenta abrir este popup solo.
// Ver chrome.action.openPopup() en background.js — depende de que el
// navegador lo permita en ese momento (gesto de usuario reciente), así que
// puede no funcionar en todos los casos/versiones de Chrome.
const autoOpenPopupToggle = document.getElementById('autoOpenPopupToggle');

chrome.storage.sync.get({ overlayEnabled: true, openPopupOnDownload: false }, (data) => {
  overlayEnabledToggle.checked = data.overlayEnabled !== false;
  autoOpenPopupToggle.checked = !!data.openPopupOnDownload;
});

overlayEnabledToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ overlayEnabled: overlayEnabledToggle.checked }, showSaved);
});

// --- Desactivar el botón flotante solo en el sitio actual ---
// Guardamos una lista de hostnames en chrome.storage.sync (aparte del
// interruptor general "overlayEnabled") y content-overlay.js la consulta
// para saber si debe ocultarse en la página donde está inyectado, sin
// importar el estado del interruptor general.
const DISABLED_SITES_KEY = 'overlayDisabledSites';
const disableSiteOption = document.getElementById('disableSiteOption');
const disableSiteToggle = document.getElementById('disableSiteToggle');
const disableSiteDesc = document.getElementById('disableSiteDesc');

// --- Desactivar TODA la extensión (botón flotante + envío desde el popup)
// en el sitio actual --- Lista aparte de la de arriba: un sitio puede estar
// en ninguna, una, o ambas listas. content-overlay.js también la consulta
// (se suma a overlayDisabledSites para decidir si mostrarse), y acá mismo
// deshabilitamos el botón de enviar cuando el sitio de la pestaña activa
// está en esta lista.
const EXTENSION_DISABLED_SITES_KEY = 'extensionDisabledSites';
const disableExtensionSiteOption = document.getElementById('disableExtensionSiteOption');
const disableExtensionSiteToggle = document.getElementById('disableExtensionSiteToggle');
const disableExtensionSiteDesc = document.getElementById('disableExtensionSiteDesc');
let currentSiteExtensionDisabled = false;

// Misma normalización que isXOrTwitter en content-overlay.js usa para
// x.com/twitter.com: acá la aplicamos a cualquier hostname para que
// "www.ejemplo.com" y "ejemplo.com" cuenten como el mismo sitio.
function normalizeHostname(hostname) {
  return (hostname || '').replace(/^www\./, '');
}

let currentSiteHost = null;

function getSiteHostFromTab(tab) {
  if (!tab || !tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (!/^https?:$/.test(url.protocol)) return null;
    return normalizeHostname(url.hostname);
  } catch (e) {
    return null;
  }
}

function renderDisableSiteOption(disabledSites) {
  if (!currentSiteHost) {
    // Páginas especiales (chrome://, about:, etc.) no tienen sitio al que
    // aplicarle esto: escondemos la opción en vez de mostrar un toggle que
    // no haría nada.
    disableSiteOption.style.display = 'none';
    return;
  }
  disableSiteOption.style.display = '';
  disableSiteToggle.checked = disabledSites.includes(currentSiteHost);
  disableSiteDesc.textContent = currentSiteHost;
}

// Refleja el estado del toggle "Desactivar la extensión en este sitio" y,
// además, aplica el efecto real: deshabilita el botón de enviar y el
// selector de calidad, con un mensaje de estado explicando por qué (en vez
// de dejarlos activos y que el usuario descubra recién al hacer clic que no
// pasa nada).
function renderDisableExtensionSiteOption(extensionDisabledSites) {
  if (!currentSiteHost) {
    disableExtensionSiteOption.style.display = 'none';
    return;
  }
  disableExtensionSiteOption.style.display = '';
  currentSiteExtensionDisabled = extensionDisabledSites.includes(currentSiteHost);
  disableExtensionSiteToggle.checked = currentSiteExtensionDisabled;
  disableExtensionSiteDesc.textContent = currentSiteHost;
  applyExtensionDisabledState();
}

function applyExtensionDisabledState() {
  qualitySelect.disabled = currentSiteExtensionDisabled;
  document.body.classList.toggle('ext-disabled', currentSiteExtensionDisabled);
  if (currentSiteExtensionDisabled) {
    setSendDisabled(true);
    setStatus(t('extension_disabled_site', currentLang), 'error');
  } else {
    setSendDisabled(false);
    // Si el status todavía mostraba el aviso de "desactivada en este
    // sitio" (por ejemplo, el usuario la reactivó desde acá mismo sin
    // cerrar el popup), lo limpiamos para no dejar un mensaje viejo.
    if (statusEl.textContent === t('extension_disabled_site', currentLang)) {
      setStatus('');
    }
  }
}

// Pedimos la pestaña activa acá mismo (en vez de esperar a que la IIFE de
// arriba termine de resolver `activeTab`) para no depender del orden en el
// que se resuelvan las promesas.
(async () => {
  const tab = await getActiveTab();
  currentSiteHost = getSiteHostFromTab(tab);
  chrome.storage.sync.get(
    { [DISABLED_SITES_KEY]: [], [EXTENSION_DISABLED_SITES_KEY]: [] },
    (data) => {
      renderDisableSiteOption(data[DISABLED_SITES_KEY] || []);
      renderDisableExtensionSiteOption(data[EXTENSION_DISABLED_SITES_KEY] || []);
    }
  );
})();

disableSiteToggle.addEventListener('change', () => {
  if (!currentSiteHost) return;
  chrome.storage.sync.get({ [DISABLED_SITES_KEY]: [] }, (data) => {
    const sites = new Set(data[DISABLED_SITES_KEY] || []);
    if (disableSiteToggle.checked) {
      sites.add(currentSiteHost);
    } else {
      sites.delete(currentSiteHost);
    }
    chrome.storage.sync.set({ [DISABLED_SITES_KEY]: Array.from(sites) }, showSaved);
  });
});

disableExtensionSiteToggle.addEventListener('change', () => {
  if (!currentSiteHost) return;
  chrome.storage.sync.get({ [EXTENSION_DISABLED_SITES_KEY]: [] }, (data) => {
    const sites = new Set(data[EXTENSION_DISABLED_SITES_KEY] || []);
    if (disableExtensionSiteToggle.checked) {
      sites.add(currentSiteHost);
    } else {
      sites.delete(currentSiteHost);
    }
    chrome.storage.sync.set({ [EXTENSION_DISABLED_SITES_KEY]: Array.from(sites) }, () => {
      currentSiteExtensionDisabled = disableExtensionSiteToggle.checked;
      applyExtensionDisabledState();
      showSaved();
    });
  });
});

autoOpenPopupToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ openPopupOnDownload: autoOpenPopupToggle.checked }, showSaved);
});

// --- "Mantener la app en segundo plano" al descargar con calidad ya
// elegida --- Es el MISMO ajuste que "Configuración → General" en la app
// (extensionKeepInBackground, ver main.js): la app es la fuente de verdad,
// así que acá solo lo leemos/escribimos contra ella vía HTTP (a través de
// background.js, ver 'get-app-settings'/'set-app-settings'), usando
// chrome.storage.sync como caché local para cuando la app está cerrada.
const keepAppInBackgroundToggle = document.getElementById('keepAppInBackgroundToggle');
const keepAppInBackgroundSyncHint = document.getElementById('keepAppInBackgroundSyncHint');

chrome.storage.sync.get({ extensionKeepInBackground: false }, (data) => {
  keepAppInBackgroundToggle.checked = data.extensionKeepInBackground === true;
});

// Apenas se abre el popup le preguntamos a la app cuál es el valor REAL:
// así, si se cambió desde su panel General, acá aparece ya al día sin que
// el usuario tenga que hacer nada. Si la app no está abierta, nos quedamos
// con el último valor cacheado arriba (sin mostrar el aviso: recién avisamos
// si el usuario intenta CAMBIARLO y no se pudo mandar, ver más abajo).
chrome.runtime.sendMessage({ type: 'get-app-settings' }, (response) => {
  if (response && response.ok) {
    keepAppInBackgroundToggle.checked = response.extensionKeepInBackground === true;
    chrome.storage.sync.set({ extensionKeepInBackground: response.extensionKeepInBackground === true });
  }
});

keepAppInBackgroundToggle.addEventListener('change', () => {
  const value = keepAppInBackgroundToggle.checked;
  chrome.storage.sync.set({ extensionKeepInBackground: value }, showSaved);
  chrome.runtime.sendMessage({ type: 'set-app-settings', extensionKeepInBackground: value }, (response) => {
    if (keepAppInBackgroundSyncHint) {
      keepAppInBackgroundSyncHint.style.display = (response && response.ok) ? 'none' : 'block';
    }
  });
});

// --- Selector de idioma (dentro del mismo panel de ajustes) ---
const languageRadios = document.querySelectorAll('input[name="language"]');

// Re-traduce todo lo que ya está pintado en pantalla (estático + dinámico)
// sin tener que cerrar y reabrir el popup.
function refreshDynamicTranslations() {
  applyTranslations(currentLang);
  for (const id of entriesById.keys()) updateCard(id);
  renderHistory();
}

languageRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    currentLang = radio.value;
    chrome.storage.sync.set({ [I18N_LANG_KEY]: currentLang }, () => {
      refreshDynamicTranslations();
      showSaved();
    });
  });
});

// Si el idioma se cambia desde options.html (u otra ventana) mientras este
// popup está abierto, lo reflejamos igual.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[I18N_LANG_KEY]) {
    currentLang = changes[I18N_LANG_KEY].newValue || I18N_DEFAULT_LANG;
    const current = document.querySelector(`input[name="language"][value="${currentLang}"]`);
    if (current) current.checked = true;
    refreshDynamicTranslations();
  }
});
