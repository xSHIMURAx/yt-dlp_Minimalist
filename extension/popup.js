const pageTitleEl = document.getElementById('pageTitle');
const sendBtn = document.getElementById('sendBtn');
const statusEl = document.getElementById('status');

let activeTab = null;

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = kind || '';
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

(async () => {
  try {
    activeTab = await getActiveTab();
    if (activeTab && activeTab.url) {
      pageTitleEl.textContent = activeTab.title || activeTab.url;
    } else {
      pageTitleEl.textContent = 'No se pudo leer esta pestaña.';
      sendBtn.disabled = true;
    }
  } catch (err) {
    pageTitleEl.textContent = 'Error leyendo la pestaña.';
    sendBtn.disabled = true;
  }
})();

sendBtn.addEventListener('click', async () => {
  if (!activeTab || !activeTab.url) return;

  // No tiene sentido mandar páginas internas del navegador.
  if (!/^https?:\/\//i.test(activeTab.url)) {
    setStatus('Esta página no se puede enviar.', 'error');
    return;
  }

  sendBtn.disabled = true;
  setStatus('Enviando…');

  chrome.runtime.sendMessage(
    { type: 'send-url', url: cleanDownloadUrl(activeTab.url), title: activeTab.title || '' },
    (response) => {
      if (response && response.ok) {
        setStatus('Enviado ✓ — revisá YT-DLP Minimalist', 'success');
        setTimeout(() => window.close(), 900);
      } else if (response && response.needsProtocol) {
        const a = document.createElement('a');
        a.href = buildProtocolUrl(response.url);
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setStatus('Abriendo la app…', 'success');
      } else {
        setStatus('No se pudo conectar. ¿Está abierta la app?', 'error');
        sendBtn.disabled = false;
      }
    }
  );
});

document.getElementById('optionsLink').addEventListener('click', () => {
  const link = document.getElementById('optionsLink');
  const panel = document.getElementById('settingsPanel');
  const isOpen = panel.classList.toggle('open');
  link.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});

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

modeRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    chrome.storage.sync.set({ overlayMode: radio.value }, showSaved);
  });
});
