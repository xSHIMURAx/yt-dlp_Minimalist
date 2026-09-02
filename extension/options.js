const radios = document.querySelectorAll('input[name="mode"]');
const languageRadios = document.querySelectorAll('input[name="language"]');
const keepInBackgroundCheckbox = document.getElementById('keep-in-background');
const savedEl = document.getElementById('saved');
const syncHintEl = document.getElementById('sync-hint');

chrome.storage.sync.get({ overlayMode: 'icon', extensionKeepInBackground: false }, (data) => {
  const current = document.querySelector(`input[name="mode"][value="${data.overlayMode}"]`);
  if (current) current.checked = true;
  // Valor de arranque: el último que quedó guardado localmente. Se
  // sobreescribe enseguida (ver abajo) con el valor real de la app si esta
  // está abierta, que es la fuente de verdad.
  keepInBackgroundCheckbox.checked = data.extensionKeepInBackground === true;
});

// Apenas se abre esta página le preguntamos a la app cuál es el valor REAL
// del toggle ahora mismo: así, si se cambió desde el panel General de la
// app, acá aparece ya al día sin que el usuario tenga que tocar nada. Si la
// app no está abierta, nos quedamos con el último valor conocido (arriba) y
// avisamos que no se pudo sincronizar.
chrome.runtime.sendMessage({ type: 'get-app-settings' }, (response) => {
  if (response && response.ok) {
    keepInBackgroundCheckbox.checked = response.extensionKeepInBackground === true;
    chrome.storage.sync.set({ extensionKeepInBackground: response.extensionKeepInBackground === true });
  } else if (syncHintEl) {
    syncHintEl.classList.add('show');
  }
});

function applyPageTitle(lang) {
  document.title = lang === 'en' ? 'Settings — YT-DLP Minimalist' : 'Ajustes — YT-DLP Minimalist';
}

i18nGetLang((lang) => {
  applyTranslations(lang);
  applyPageTitle(lang);
  const current = document.querySelector(`input[name="language"][value="${lang}"]`);
  if (current) current.checked = true;
});

function showSaved() {
  savedEl.classList.add('show');
  setTimeout(() => savedEl.classList.remove('show'), 1200);
}

radios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    chrome.storage.sync.set({ overlayMode: radio.value }, showSaved);
  });
});

// Guardamos siempre en chrome.storage.sync (para que la extensión lo
// recuerde aunque la app esté cerrada) y en paralelo se lo mandamos a la
// app para que quede igual ahí. Si la app no responde, avisamos en vez de
// fingir que quedó sincronizado en los dos lados.
keepInBackgroundCheckbox.addEventListener('change', () => {
  const value = keepInBackgroundCheckbox.checked;
  chrome.storage.sync.set({ extensionKeepInBackground: value }, showSaved);
  chrome.runtime.sendMessage({ type: 'set-app-settings', extensionKeepInBackground: value }, (response) => {
    if (syncHintEl) syncHintEl.classList.toggle('show', !(response && response.ok));
  });
});

languageRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    chrome.storage.sync.set({ [I18N_LANG_KEY]: radio.value }, () => {
      applyTranslations(radio.value);
      applyPageTitle(radio.value);
      showSaved();
    });
  });
});

// Si el idioma se cambia desde otro lugar (ej. el panel del popup) mientras
// esta página de ajustes está abierta, la reflejamos sin recargar.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[I18N_LANG_KEY]) {
    const lang = changes[I18N_LANG_KEY].newValue || I18N_DEFAULT_LANG;
    applyTranslations(lang);
    applyPageTitle(lang);
    const current = document.querySelector(`input[name="language"][value="${lang}"]`);
    if (current) current.checked = true;
  }
});
