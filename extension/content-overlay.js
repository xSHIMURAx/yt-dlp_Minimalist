// Muestra un botón flotante "Descargar" arriba a la derecha de la página,
// como el aviso de Ghost Downloader. Un clic manda la URL actual a
// YT-DLP Minimalist; la X lo cierra (vuelve a aparecer al recargar la página).
(function () {
  // Evita duplicarlo si el content script se vuelve a inyectar (ej. YouTube
  // navega entre videos sin recargar la página completa).
  if (window.__ytdlpMinimalistOverlayInjected) return;
  window.__ytdlpMinimalistOverlayInjected = true;

  function findVideoEl() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (!videos.length) return null;
    // Si hay varios <video> en la página, nos quedamos con el más grande
    // visible (evita banners o previews chiquitos).
    let best = null;
    let bestArea = 0;
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea && rect.width > 0 && rect.height > 0) {
        bestArea = area;
        best = rect;
      }
    }
    return best;
  }

  let userPositioned = false;

  function positionOverlay(wrap) {
    if (userPositioned) return; // el usuario ya lo movió a mano: no lo pisamos
    const videoRect = findVideoEl();
    if (videoRect) {
      wrap.style.position = 'fixed';
      wrap.style.top = Math.max(4, videoRect.top + 4) + 'px';
      wrap.style.right = Math.max(4, window.innerWidth - videoRect.right + 4) + 'px';
      wrap.style.left = 'auto';
    } else {
      // Sin <video> visible todavía: lo dejamos arriba a la derecha de la página.
      wrap.style.position = 'fixed';
      wrap.style.top = '8px';
      wrap.style.right = '10px';
      wrap.style.left = 'auto';
    }
  }

  // Hace que "wrap" se pueda arrastrar con el mouse. Un simple click (sin
  // mover el mouse) sigue disparando la acción del botón que se haya
  // tocado; solo se trata como arrastre si el mouse se movió más de unos
  // pocos píxeles entre el mousedown y el mouseup.
  function makeDraggable(wrap) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;
    let suppressNextClick = false;

    wrap.addEventListener('mousedown', (e) => {
      dragging = true;
      moved = false;
      const rect = wrap.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // Umbral de movimiento para distinguir un clic de un arrastre. Antes
      // eran 3px, pero eso es tan chico que casi cualquier clic real (mano
      // no perfectamente quieta, trackpad sensible) ya lo superaba, y el
      // código lo trataba como un arrastre y descartaba el clic sin avisar
      // — de ahí que hiciera falta un segundo clic (más quieto) para que
      // "Descargar" o "Cerrar" funcionaran. 8px es el estándar típico en
      // librerías de drag-and-drop y da mucho más margen.
      if (!moved && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) moved = true;
      if (!moved) return;

      userPositioned = true;
      wrap.classList.add('is-dragging');
      const maxLeft = window.innerWidth - wrap.offsetWidth;
      const maxTop = window.innerHeight - wrap.offsetHeight;
      wrap.style.left = Math.min(Math.max(0, origLeft + dx), maxLeft) + 'px';
      wrap.style.top = Math.min(Math.max(0, origTop + dy), maxTop) + 'px';
      wrap.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (dragging && moved) {
        suppressNextClick = true;
        setTimeout(() => {
          suppressNextClick = false;
        }, 0);
      }
      dragging = false;
      wrap.classList.remove('is-dragging');
    });

    // Captura el click antes de que llegue a los botones internos, para
    // que un arrastre no dispare "Descargar" o "Cerrar" sin querer.
    wrap.addEventListener(
      'click',
      (e) => {
        if (suppressNextClick) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true
    );
  }

  // Dispara el link "ytdlpminimalist://..." con un clic real dentro de la
  // propia página (en vez de abrir otra pestaña/ventana desde la
  // extensión). Así el diálogo "¿Abrir YT-DLP Minimalist?" del navegador
  // aparece anclado a esta pestaña, y el navegador puede ofrecer la opción
  // de "permitir siempre" para este sitio.
  function triggerProtocolOpen(url) {
    const a = document.createElement('a');
    a.href = buildProtocolUrl(url);
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
  }

  function buildOverlay(mode) {
    const wrap = document.createElement('div');
    wrap.id = 'ytdlp-minimalist-overlay';
    wrap.className = mode === 'text' ? 'mode-text' : 'mode-icon';

    const btn = document.createElement('button');
    btn.id = 'ytdlp-minimalist-btn';
    btn.type = 'button';
    btn.title = 'Descargar con YT-DLP Minimalist';
    const iconSvg =
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M8 1.5V10M8 10L4.5 6.5M8 10L11.5 6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M2.5 12.5V13.5C2.5 14.0523 2.94772 14.5 3.5 14.5H12.5C13.0523 14.5 13.5 14.0523 13.5 13.5V12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
    btn.innerHTML = mode === 'text' ? iconSvg + '<span>Descargar</span>' : iconSvg;

    const closeBtn = document.createElement('button');
    closeBtn.id = 'ytdlp-minimalist-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Cerrar');
    closeBtn.textContent = '\u00d7';

    wrap.appendChild(btn);
    wrap.appendChild(closeBtn);
    document.documentElement.appendChild(wrap);

    positionOverlay(wrap);
    makeDraggable(wrap);

    // El reproductor puede aparecer después (YouTube tarda en montarlo) o
    // cambiar de tamaño/posición (scroll, resize, cambio de video en SPA),
    // así que reubicamos el botón de forma periódica en vez de depender de
    // un único evento.
    const reposition = () => positionOverlay(wrap);
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition);
    const intervalId = setInterval(reposition, 500);

    closeBtn.addEventListener('click', () => {
      dismissedByUser = true;
      clearInterval(intervalId);
      window.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
      wrap.remove();
    });

    btn.addEventListener('click', () => {
      const label = btn.querySelector('span');
      btn.disabled = true;
      btn.classList.add('is-sending');
      btn.title = 'Enviando…';
      if (label) label.textContent = 'Enviando…';

      chrome.runtime.sendMessage(
        { type: 'send-url', url: cleanDownloadUrl(location.href), title: document.title },
        (response) => {
          btn.classList.remove('is-sending');
          if (response && response.ok) {
            btn.classList.add('is-success');
            btn.title = 'Enviado ✓';
            if (label) label.textContent = 'Enviado ✓';
            setTimeout(() => wrap.remove(), 1000);
          } else if (response && response.needsProtocol) {
            triggerProtocolOpen(response.url);
            btn.classList.add('is-success');
            btn.title = 'Abriendo la app…';
            if (label) label.textContent = 'Abriendo app…';
            setTimeout(() => wrap.remove(), 1000);
          } else {
            btn.classList.add('is-error');
            btn.title = '¿Abriste la app? — Reintentar';
            if (label) label.textContent = '¿Abriste la app?';
            setTimeout(() => {
              btn.classList.remove('is-error');
              btn.title = 'Descargar con YT-DLP Minimalist';
              if (label) label.textContent = 'Descargar';
              btn.disabled = false;
            }, 1800);
          }
        }
      );
    });

    return wrap;
  }

  // --- Solo mostramos el botón si la página realmente tiene un <video>. ---
  // Esto evita que aparezca en cualquier página (Google, Wikipedia, blogs,
  // etc.) y hace que funcione automáticamente en cualquier sitio que
  // yt-dlp soporte, sin tener que mantener una lista fija de dominios.
  let currentMode = 'icon';
  let overlayEl = null;
  let dismissedByUser = false;

  function hasVisibleVideo() {
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    }
    return false;
  }

  function syncOverlay() {
    if (dismissedByUser) return;

    if (hasVisibleVideo()) {
      if (!overlayEl || !overlayEl.isConnected) {
        overlayEl = buildOverlay(currentMode);
      }
    } else if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function init() {
    chrome.storage.sync.get({ overlayMode: 'icon' }, (data) => {
      currentMode = data.overlayMode === 'text' ? 'text' : 'icon';
      syncOverlay();

      // Muchos sitios (YouTube, X/Twitter, Instagram, etc.) son SPA y montan
      // el <video> unos instantes después de cargar la página, o lo
      // reemplazan al navegar entre videos sin recargar. Por eso vigilamos
      // el DOM en vez de chequear una sola vez.
      const observer = new MutationObserver(() => syncOverlay());
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      // Respaldo por si algún cambio no dispara el MutationObserver
      // (p. ej. un <video> que solo cambia de tamaño/visibilidad).
      setInterval(syncOverlay, 1000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Si el usuario cambia el modo en los ajustes mientras esta página sigue
  // abierta, reconstruimos el botón con el nuevo estilo al toque.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.overlayMode) return;
    currentMode = changes.overlayMode.newValue === 'text' ? 'text' : 'icon';
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    syncOverlay();
  });
})();
