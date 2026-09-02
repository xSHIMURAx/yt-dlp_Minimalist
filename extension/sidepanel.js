const HISTORY_KEY = 'sendHistory';

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const clearBtn = document.getElementById('clearBtn');

let currentLang = I18N_DEFAULT_LANG;

function formatTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const locale = i18nDateLocale(currentLang);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const date = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  return `${date} ${time}`;
}

let lastList = [];

function render(list) {
  lastList = list;
  listEl.innerHTML = '';
  clearBtn.disabled = list.length === 0;
  emptyEl.style.display = list.length === 0 ? 'block' : 'none';

  for (const entry of list) {
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
      ? `${formatTime(entry.timestamp)} · ${formatQualityLabel(entry.quality, currentLang)}`
      : formatTime(entry.timestamp);

    const status = document.createElement('span');
    status.className = `entry-status ${entry.status || 'sent'}`;
    status.textContent = t(`history_status_${entry.status || 'sent'}`, currentLang);

    meta.appendChild(time);
    meta.appendChild(status);

    li.appendChild(title);
    li.appendChild(url);
    li.appendChild(meta);
    listEl.appendChild(li);
  }
}

async function load() {
  const data = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  render(data[HISTORY_KEY]);
}

// El panel se mantiene al día solo: si el popup o el botón flotante mandan
// otro video mientras el panel está abierto, background.js escribe en
// storage.local y este listener reacciona sin recargar nada.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[HISTORY_KEY]) {
    render(changes[HISTORY_KEY].newValue || []);
  }
  if (area === 'sync' && changes[I18N_LANG_KEY]) {
    currentLang = changes[I18N_LANG_KEY].newValue || I18N_DEFAULT_LANG;
    applyTranslations(currentLang);
    applyPageTitle(currentLang);
    render(lastList);
  }
});

clearBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clear-history' });
});

function applyPageTitle(lang) {
  document.title = lang === 'en' ? 'History — YT-DLP Minimalist' : 'Historial — YT-DLP Minimalist';
}

i18nGetLang((lang) => {
  currentLang = lang;
  applyTranslations(currentLang);
  applyPageTitle(currentLang);
  load();
});
