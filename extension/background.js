// Centraliza la comunicación con YT-DLP Minimalist. Tanto el popup como el
// botón flotante (content-overlay.js) le mandan un mensaje a este service
// worker en vez de hacer fetch cada uno por su cuenta: así el fetch corre
// siempre en el contexto de la extensión (nunca sujeto al CSP de la página
// que se esté viendo, que en varios sitios bloquearía la conexión directa).
importScripts('url-utils.js');

const APP_ENDPOINT = 'http://127.0.0.1:14370/add-url';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'send-url') return;

  fetch(APP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: message.url, title: message.title || '' }),
  })
    .then((res) => {
      if (!res.ok) throw new Error('bad status');
      sendResponse({ ok: true });
    })
    .catch(() => {
      // La app no estaba abierta (o no responde). No la lanzamos desde acá:
      // le avisamos a quien nos mandó el mensaje (el botón sobre el video,
      // o el popup) para que dispare el link de protocolo ella misma, desde
      // esa misma pestaña — así el diálogo "¿Abrir YT-DLP Minimalist?" del
      // navegador aparece anclado a esa página en vez de en una ventana
      // aparte, y el navegador puede ofrecer la opción de "permitir
      // siempre" para ese sitio.
      sendResponse({ ok: false, needsProtocol: true, url: message.url });
    });

  return true; // respuesta asíncrona
});
