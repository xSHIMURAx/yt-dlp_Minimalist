const radios = document.querySelectorAll('input[name="mode"]');
const savedEl = document.getElementById('saved');

chrome.storage.sync.get({ overlayMode: 'icon' }, (data) => {
  const current = document.querySelector(`input[value="${data.overlayMode}"]`);
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
