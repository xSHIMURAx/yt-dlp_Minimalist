// Muestra un botón flotante "Descargar" arriba a la derecha de CADA video
// visible en la página (como el aviso de Ghost Downloader, pero uno por
// video). Un clic manda la URL de ESE video a YT-DLP Minimalist; la X lo
// cierra (vuelve a aparecer al recargar la página, o si ese video deja de
// estar visible y luego vuelve a aparecer).
(function () {
  // Evita duplicarlo si el content script se vuelve a inyectar (ej. YouTube
  // navega entre videos sin recargar la página completa).
  if (window.__ytdlpMinimalistOverlayInjected) return;
  window.__ytdlpMinimalistOverlayInjected = true;

  // Mismas opciones que el <select> del popup — ver parseQualityValue en
  // url-utils.js para cómo se traduce cada value a lo que espera la app.
  // Las etiquetas se traducen en el momento (ver getQualityOptions) según
  // el idioma elegido en los ajustes de la extensión (ver i18n.js).
  function getQualityOptions(lang) {
    return QUALITY_OPTION_DEFS.map((def) => ({ value: def.value, label: t(def.key, lang) }));
  }

  // Idioma actual de la interfaz del botón flotante. Se lee al iniciar (ver
  // init más abajo) y se actualiza en caliente si cambia desde el popup o
  // desde los ajustes, sin necesidad de recargar la página.
  let currentLang = I18N_DEFAULT_LANG;

  // Tamaño mínimo para considerar un <video> "real" y no un thumbnail,
  // avatar animado o adorno de la UI (ej. previews chiquitos en sidebars).
  const MIN_VIDEO_WIDTH = 120;
  const MIN_VIDEO_HEIGHT = 80;
  // Techo de botones simultáneos en pantalla, para no llenar la página de
  // overlays en sitios con muchísimos videos a la vez (ej. un feed con
  // varios GIFs). Se muestran los más grandes primero.
  const MAX_OVERLAYS = 6;

  function isInViewport(rect) {
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
      rect.left < (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  // Todos los <video> que ahora mismo valen la pena mostrar con su propio
  // botón: visibles en el viewport y de un tamaño mínimo razonable. Orden
  // de más grande a más chico (así, si hay que recortar por MAX_OVERLAYS,
  // se priorizan los videos principales por sobre thumbnails secundarios).
  function getEligibleVideos() {
    const videos = Array.from(document.querySelectorAll('video'));
    const eligible = [];
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) continue;
      if (!isInViewport(rect)) continue;
      eligible.push({ video: v, rect, area: rect.width * rect.height });
    }
    eligible.sort((a, b) => b.area - a.area);
    return eligible.slice(0, MAX_OVERLAYS).map((e) => e.video);
  }

  // El <video> más grande visible ahora mismo — lo sigue usando el mensaje
  // 'get-effective-url' que le manda el popup (ver más abajo), ya que ahí
  // no hay un botón puntual al que atarse: se toma el principal, igual que
  // antes de este cambio.
  function findBestVideoEl() {
    const [first] = getEligibleVideos();
    return first || null;
  }

  // ---- X / Twitter: la URL de la pestaña no sirve ----
  // En x.com/twitter.com, el feed ("Para ti", "Siguiendo", perfil, etc.) es
  // una SPA: cuando un video se reproduce dentro de una tarjeta del timeline
  // (sin haber entrado al tweet), la barra de direcciones se queda en
  // /home (o el feed que sea) y NO cambia al permalink del tweet
  // (x.com/usuario/status/12345...). Si mandáramos location.href tal cual,
  // siempre se descargaría "https://x.com/home" en vez del video real — por
  // eso hace falta buscar el link permanente del tweet que contiene el
  // video que se está reproduciendo.
  function isXOrTwitter(hostname) {
    const host = hostname.replace(/^www\./, '').replace(/^mobile\./, '');
    return host === 'x.com' || host === 'twitter.com';
  }

  // A partir de un <video> puntual, sube hasta el <article> del tweet
  // (cada tweet del timeline es un <article> separado) y busca dentro el
  // link con "/status/", que es el permalink del tweet — casi siempre es
  // el que envuelve la fecha/hora de publicación.
  function extractTweetUrlFromVideo(videoEl) {
    if (!videoEl) return null;
    const article = videoEl.closest('article');
    if (!article) return null;
    const statusLinks = Array.from(article.querySelectorAll('a[href*="/status/"]')).filter((a) =>
      /\/status\/\d+/.test(a.getAttribute('href') || '')
    );
    if (!statusLinks.length) return null;
    // Preferimos el link que envuelve un <time> (la fecha del tweet): es el
    // permalink real. Si no aparece (cambios de markup de X), nos quedamos
    // con el primer link a /status/ que haya, que en la gran mayoría de los
    // casos también apunta al mismo tweet.
    const timeLink = statusLinks.find((a) => a.querySelector('time'));
    const chosen = timeLink || statusLinks[0];
    try {
      return new URL(chosen.getAttribute('href'), location.origin).toString();
    } catch (e) {
      return null;
    }
  }

  // URL que realmente hay que mandar a descargar para "videoEl": en
  // X/Twitter, el permalink del tweet que lo contiene (si se puede
  // encontrar); en cualquier otro sitio, la URL de la pestaña de siempre.
  // Si no se pasa un video puntual, se usa el principal (findBestVideoEl).
  function getEffectiveDownloadUrl(videoEl) {
    const target = videoEl || findBestVideoEl();
    if (isXOrTwitter(location.hostname)) {
      const tweetUrl = extractTweetUrlFromVideo(target);
      if (tweetUrl) return tweetUrl;
    }
    return location.href;
  }

  // Mismo problema con el título: document.title en el feed es genérico
  // ("Inicio / X") en vez del tweet puntual. Si podemos, usamos el texto
  // del tweet (o el nombre de quien lo publicó) como título más útil.
  function getEffectiveTitle(videoEl) {
    if (isXOrTwitter(location.hostname)) {
      const article = videoEl ? videoEl.closest('article') : null;
      if (article) {
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const authorEl = article.querySelector('[data-testid="User-Name"]');
        const text = textEl ? textEl.textContent.trim() : '';
        const author = authorEl ? authorEl.textContent.trim() : '';
        const combined = [author, text].filter(Boolean).join(' — ');
        if (combined) return combined.slice(0, 200);
      }
    }
    return document.title;
  }

  function positionOverlay(wrap, videoEl, userPositioned) {
    if (userPositioned.value) return; // el usuario ya lo movió a mano: no lo pisamos
    const videoRect = videoEl && videoEl.isConnected ? videoEl.getBoundingClientRect() : null;
    if (videoRect) {
      wrap.style.position = 'fixed';
      wrap.style.top = Math.max(4, videoRect.top + 4) + 'px';
      wrap.style.right = Math.max(4, window.innerWidth - videoRect.right + 4) + 'px';
      wrap.style.left = 'auto';
    } else {
      // El video de este overlay ya no está (SPA lo reemplazó, se navegó,
      // etc.): lo dejamos arriba a la derecha de la página como respaldo,
      // aunque en la práctica syncOverlay() lo va a limpiar enseguida.
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
  function makeDraggable(wrap, userPositioned) {
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

      userPositioned.value = true;
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
  function triggerProtocolOpen(url, quality, extId) {
    const a = document.createElement('a');
    a.href = buildProtocolUrl(url, quality, extId);
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
  }

  // Construye UN botón flotante atado a "videoEl" puntual. onDismiss se
  // llama cuando el usuario lo cierra con la X, para que syncOverlay() no
  // lo vuelva a crear mientras ese mismo <video> siga en pantalla.
  function buildOverlay(mode, videoEl, onDismiss) {
    const wrap = document.createElement('div');
    wrap.className = 'ytdlp-minimalist-overlay ' + (mode === 'text' ? 'mode-text' : 'mode-icon');

    const btn = document.createElement('button');
    btn.className = 'ytdlp-minimalist-btn';
    btn.type = 'button';
    btn.title = t('overlay_btn_title', currentLang);
    const iconSvg =
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M8 1.5V10M8 10L4.5 6.5M8 10L11.5 6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M2.5 12.5V13.5C2.5 14.0523 2.94772 14.5 3.5 14.5H12.5C13.0523 14.5 13.5 14.0523 13.5 13.5V12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
    btn.innerHTML = mode === 'text' ? iconSvg + `<span>${t('overlay_download_label', currentLang)}</span>` : iconSvg;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ytdlp-minimalist-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', t('overlay_close_aria', currentLang));
    closeBtn.textContent = '\u00d7';

    const qualityMenu = document.createElement('div');
    qualityMenu.className = 'ytdlp-minimalist-quality-menu';
    document.documentElement.appendChild(qualityMenu);

    wrap.appendChild(btn);
    wrap.appendChild(closeBtn);
    document.documentElement.appendChild(wrap);

    const userPositioned = { value: false }; // objeto para poder pasarlo por referencia
    positionOverlay(wrap, videoEl, userPositioned);
    makeDraggable(wrap, userPositioned);

    // El reproductor puede cambiar de tamaño/posición (scroll, resize,
    // scroll infinito reacomodando tarjetas), así que reubicamos el botón
    // de forma periódica en vez de depender de un único evento.
    const reposition = () => positionOverlay(wrap, videoEl, userPositioned);
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition);
    const intervalId = setInterval(reposition, 500);

    function cleanupOverlay() {
      clearInterval(intervalId);
      window.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
      qualityMenu.remove();
      wrap.remove();
      // Además de sacar el botón de la pantalla, hay que sacarlo del
      // registro overlaysByVideo — si no, cuando este mismo <video> se
      // reutiliza para otro contenido (YouTube no recarga la página al
      // pasar a otro video, solo le cambia el src al mismo <video>),
      // syncOverlay() cree que ese video "ya tiene botón" (aunque ya no
      // esté en pantalla) y nunca vuelve a crear uno — quedaba así hasta
      // recargar la página. El chequeo de identidad evita borrar la
      // entrada si para cuando esto se ejecuta (ej. el setTimeout de
      // "Enviado ✓") ya se creó una entrada MÁS NUEVA para este mismo
      // video.
      if (overlaysByVideo.get(videoEl) === entry) overlaysByVideo.delete(videoEl);
    }

    closeBtn.addEventListener('click', () => {
      onDismiss();
      cleanupOverlay();
    });

    // Envía la URL del video de ESTE overlay con la calidad indicada. Usado
    // tanto por un clic izquierdo directo en el botón (sin calidad puntual)
    // como por elegir una opción en el menú de calidad (clic derecho sobre
    // el mismo botón).
    function doSend(quality) {
      const label = btn.querySelector('span');
      btn.disabled = true;
      btn.classList.add('is-sending');
      btn.title = t('sending_ellipsis', currentLang);
      if (label) label.textContent = t('sending_ellipsis', currentLang);

      chrome.runtime.sendMessage(
        {
          type: 'send-url',
          url: cleanDownloadUrl(getEffectiveDownloadUrl(videoEl)),
          title: getEffectiveTitle(videoEl),
          quality,
        },
        (response) => {
          btn.classList.remove('is-sending');
          if (response && response.ok) {
            btn.classList.add('is-success');
            btn.title = t('overlay_sent_check', currentLang);
            if (label) label.textContent = t('overlay_sent_check', currentLang);
            setTimeout(() => cleanupOverlay(), 1000);
          } else if (response && response.needsProtocol) {
            triggerProtocolOpen(response.url, quality, response.id);
            btn.classList.add('is-success');
            btn.title = t('opening_app', currentLang);
            if (label) label.textContent = t('overlay_opening_app_label', currentLang);
            setTimeout(() => cleanupOverlay(), 1000);
          } else {
            btn.classList.add('is-error');
            btn.title = t('overlay_open_app_retry_title', currentLang);
            if (label) label.textContent = t('overlay_open_app_retry_label', currentLang);
            setTimeout(() => {
              btn.classList.remove('is-error');
              btn.title = t('overlay_btn_title', currentLang);
              if (label) label.textContent = t('overlay_download_label', currentLang);
              btn.disabled = false;
            }, 1800);
          }
        }
      );
    }

    // Clic izquierdo en "Descargar": manda la URL sola (sin calidad puntual)
    // para que la app abra su propio selector y el usuario elija ahí. Clic
    // derecho: abre acá mismo el menú de calidades (ver más abajo) para
    // bajar directo con una calidad puntual sin pasar por la app.
    btn.addEventListener('click', () => {
      doSend(null);
    });

    // ---- Menú de calidad (clic derecho sobre el botón "Descargar") ----
    function closeQualityMenu() {
      qualityMenu.classList.remove('open');
    }

    function openQualityMenu() {
      // Siempre se marca "Mejor calidad (video+audio)" como opción actual
      // acá, sin importar qué calidad se haya usado la última vez — este
      // menú es de descarga rápida por video, no un ajuste persistente, así
      // que no tiene sentido que arrastre la calidad de una descarga
      // anterior (ver historial de por qué se hizo así). Igual seguimos
      // guardando en storage la calidad elegida, porque el <select> del
      // popup de la extensión sí usa ese valor como su propio default.
      qualityMenu.innerHTML = '';
      for (const opt of getQualityOptions(currentLang)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = opt.label;
        if (opt.value === 'best') item.classList.add('is-current');
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          chrome.storage.sync.set({ [QUALITY_STORAGE_KEY]: opt.value });
          closeQualityMenu();
          doSend(parseQualityValue(opt.value));
        });
        qualityMenu.appendChild(item);
      }
      const btnRect = btn.getBoundingClientRect();
      qualityMenu.style.top = Math.min(btnRect.bottom + 4, window.innerHeight - 8) + 'px';
      // Alineado a la derecha del botón, sin salirse de la ventana por la izquierda.
      const menuWidth = 176; // debe matchear min-width del CSS + padding
      qualityMenu.style.left = Math.max(4, btnRect.right - menuWidth) + 'px';
      qualityMenu.classList.add('open');
    }

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (qualityMenu.classList.contains('open')) {
        closeQualityMenu();
      } else {
        openQualityMenu();
      }
    });

    document.addEventListener('click', (e) => {
      if (!qualityMenu.contains(e.target)) closeQualityMenu();
    });

    const entry = { wrap, qualityMenu, cleanupOverlay };
    return entry;
  }

  // --- Solo mostramos botones si la página realmente tiene <video>. ---
  // Esto evita que aparezca en cualquier página (Google, Wikipedia, blogs,
  // etc.) y hace que funcione automáticamente en cualquier sitio que
  // yt-dlp soporte, sin tener que mantener una lista fija de dominios.
  let currentMode = 'icon';
  // Interruptor general del botón flotante (ver toggle "Botón flotante" en
  // popup.js, guardado aparte de overlayMode para no perder la preferencia
  // de estilo ícono/texto cuando se apaga y se vuelve a prender).
  let overlayEnabled = true;

  // Lista de hostnames donde el usuario apagó el botón flotante puntualmente
  // (ver toggle "Desactivar botón flotante en este sitio" en popup.js). Se
  // suma al interruptor general de arriba: si cualquiera de los dos dice
  // "apagado", no se muestra nada en esta página.
  const DISABLED_SITES_KEY = 'overlayDisabledSites';
  let disabledSites = [];

  // Lista de hostnames donde el usuario desactivó TODA la extensión (ver
  // toggle "Desactivar la extensión en este sitio" en popup.js). Acá dentro
  // solo nos importa para lo mismo que la lista de arriba: no mostrar el
  // botón flotante. El resto de ese apagado (deshabilitar el envío desde el
  // popup) lo maneja popup.js directamente, ya que este content script no
  // tiene nada que ver con eso.
  const EXTENSION_DISABLED_SITES_KEY = 'extensionDisabledSites';
  let extensionDisabledSites = [];

  // Misma normalización que usa popup.js para poder comparar
  // "www.ejemplo.com" con "ejemplo.com" como el mismo sitio.
  function normalizeHostname(hostname) {
    return (hostname || '').replace(/^www\./, '');
  }

  function isSiteDisabled() {
    const host = normalizeHostname(location.hostname);
    return disabledSites.includes(host) || extensionDisabledSites.includes(host);
  }

  // Un overlay por <video> visible: la clave es el propio elemento
  // <video>, así que si el sitio reemplaza ese nodo (scroll infinito, SPA)
  // el overlay viejo se limpia solo y se crea uno nuevo para el que lo
  // reemplazó, sin mezclar botones de un video con otro.
  const overlaysByVideo = new Map(); // video -> { wrap, qualityMenu, cleanupOverlay }
  // Videos que el usuario cerró a mano con la X: no se les vuelve a poner
  // botón mientras sigan en pantalla (se resetea solo si el video sale del
  // DOM/deja de estar visible y aparece otro nuevo, o si se recarga la
  // página). Un WeakSet no necesita limpieza manual: cuando el <video> se
  // saca del DOM y no queda ninguna otra referencia, se libera solo.
  const dismissedVideos = new WeakSet();

  function removeOverlayFor(video) {
    const entry = overlaysByVideo.get(video);
    if (!entry) return;
    entry.cleanupOverlay();
    overlaysByVideo.delete(video);
  }

  function removeAllOverlays() {
    for (const video of Array.from(overlaysByVideo.keys())) removeOverlayFor(video);
  }

  function syncOverlay() {
    if (!overlayEnabled || isSiteDisabled()) {
      removeAllOverlays();
      return;
    }

    const eligible = getEligibleVideos();
    const eligibleSet = new Set(eligible);

    // Sacamos los overlays de videos que ya no están (se fueron de
    // pantalla, se los reemplazó el sitio, o el usuario los cerró y siguen
    // sin ser elegibles de nuevo).
    for (const video of Array.from(overlaysByVideo.keys())) {
      if (!eligibleSet.has(video) || dismissedVideos.has(video)) {
        removeOverlayFor(video);
      }
    }

    // Agregamos overlays para videos elegibles que todavía no tienen uno
    // (y que el usuario no cerró a mano).
    for (const video of eligible) {
      if (overlaysByVideo.has(video)) continue;
      if (dismissedVideos.has(video)) continue;
      const entry = buildOverlay(currentMode, video, () => dismissedVideos.add(video));
      overlaysByVideo.set(video, entry);
    }
  }

  function init() {
    chrome.storage.sync.get(
      { overlayMode: 'icon', overlayEnabled: true, [DISABLED_SITES_KEY]: [], [EXTENSION_DISABLED_SITES_KEY]: [], [I18N_LANG_KEY]: I18N_DEFAULT_LANG },
      (data) => {
      currentMode = data.overlayMode === 'text' ? 'text' : 'icon';
      overlayEnabled = data.overlayEnabled !== false;
      disabledSites = Array.isArray(data[DISABLED_SITES_KEY]) ? data[DISABLED_SITES_KEY] : [];
      extensionDisabledSites = Array.isArray(data[EXTENSION_DISABLED_SITES_KEY]) ? data[EXTENSION_DISABLED_SITES_KEY] : [];
      currentLang = i18nNormalizeLang(data[I18N_LANG_KEY]);
      syncOverlay();

      // Muchos sitios (YouTube, X/Twitter, Instagram, etc.) son SPA y montan
      // el <video> unos instantes después de cargar la página, reemplazan
      // el nodo al navegar entre videos, o cargan más tarjetas al hacer
      // scroll infinito. Por eso vigilamos el DOM en vez de chequear una
      // sola vez.
      const observer = new MutationObserver(() => syncOverlay());
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      // Respaldo por si algún cambio no dispara el MutationObserver (p. ej.
      // un <video> que solo cambia de tamaño/posición al hacer scroll, o
      // entra/sale del viewport sin que cambie el DOM).
      setInterval(syncOverlay, 1000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // El popup de la extensión (popup.js) no tiene acceso al DOM de la
  // página, así que cuando el usuario manda la descarga desde ahí (en vez
  // de con alguno de los botones flotantes) nos pregunta a nosotros cuál
  // es la URL/título "efectivos" del video principal en vez de usar
  // tab.url directamente — así también funciona bien en X/Twitter. Si esta
  // pestaña no tiene el content script inyectado (páginas especiales,
  // recién abierta, etc.), chrome.tabs.sendMessage falla del lado del
  // popup y este listener ni se llega a usar.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'get-effective-url') return;
    const video = findBestVideoEl();
    sendResponse({ url: getEffectiveDownloadUrl(video), title: getEffectiveTitle(video) });
  });

  // Si el usuario cambia el modo o apaga/prende el botón flotante desde los
  // ajustes mientras esta página sigue abierta, reconstruimos todos los
  // overlays (o los quitamos/mostramos) al toque, sin tener que recargar
  // la pestaña.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let relevant = false;
    if (changes.overlayMode) {
      currentMode = changes.overlayMode.newValue === 'text' ? 'text' : 'icon';
      relevant = true;
    }
    if (changes.overlayEnabled) {
      overlayEnabled = changes.overlayEnabled.newValue !== false;
      relevant = true;
    }
    if (changes[DISABLED_SITES_KEY]) {
      disabledSites = Array.isArray(changes[DISABLED_SITES_KEY].newValue) ? changes[DISABLED_SITES_KEY].newValue : [];
      relevant = true;
    }
    if (changes[EXTENSION_DISABLED_SITES_KEY]) {
      extensionDisabledSites = Array.isArray(changes[EXTENSION_DISABLED_SITES_KEY].newValue) ? changes[EXTENSION_DISABLED_SITES_KEY].newValue : [];
      relevant = true;
    }
    if (changes[I18N_LANG_KEY]) {
      currentLang = i18nNormalizeLang(changes[I18N_LANG_KEY].newValue);
      relevant = true;
    }
    if (!relevant) return;
    removeAllOverlays();
    syncOverlay();
  });
})();
