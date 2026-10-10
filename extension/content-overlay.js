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

  // Si la extensión se recarga, se actualiza o se desactiva mientras esta pestaña sigue abierta,
  // Chrome le quita el CSS a este script y todas las llamadas a chrome.* empiezan a fallar
  // ("Extension context invalidated"). Sin esto, los botones ya dibujados quedaban en pantalla
  // sin estilo y sin funcionar hasta recargar la página. Ahora se detecta y se limpian solos.
  function extensionAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }
  let pageObserver = null;
  let pageSyncIntervalId = null;
  let shutDown = false;
  function shutdownOrphaned() {
    if (shutDown) return;
    shutDown = true;
    try { removeAllOverlays(); } catch (e) { /* ya no importa */ }
    if (pageSyncIntervalId) clearInterval(pageSyncIntervalId);
    if (pageObserver) pageObserver.disconnect();
    // Por si quedó algún botón o menú que el registro ya no conocía.
    document.querySelectorAll('.ytdlp-minimalist-overlay, .ytdlp-minimalist-quality-menu').forEach((el) => el.remove());
    window.__ytdlpMinimalistOverlayInjected = false;
  }

  // ---- Opciones del menú de calidad (mismas que el popup, ver skin.js) ----
  // Gramática de los valores (ver parseQualityValue en url-utils.js):
  //   best:<contenedor> | video:<alto>:<contenedor> | audio:<fmt>[:<kbps>]
  const QM_CONTAINERS = ['mp4', 'mkv', 'webm'];
  const QM_AUDIO_FMTS = ['mp3', 'm4a', 'opus'];
  const QM_AUDIO_BITRATES = [320, 256, 192, 128];
  // Alturas con su insignia, igual que HEIGHTS en skin.js.
  const QM_HEIGHTS = [
    { h: 2160, badge: ['4K', 'b-4k'] },
    { h: 1440, badge: ['2K', 'b-2k'] },
    { h: 1080, badge: ['Full HD', 'b-fhd'] },
    { h: 720, badge: ['HD', 'b-hd'] },
    { h: 480, badge: ['SD', 'b-sd'] },
    { h: 360 },
    { h: 240 },
    { h: 144 },
  ];

  // Valor guardado -> estado del menú ({ type, fmt, container }). También
  // entiende los valores viejos ("best", "video:720", "audio", "audio:m4a").
  function qmStateOf(value) {
    const [kind, a, b] = String(value || 'best').split(':');
    if (kind === 'thumb') return { type: 'thumb', fmt: 'mp3', container: 'mp4' };
    if (kind === 'audio') return { type: 'audio', fmt: QM_AUDIO_FMTS.includes(a) ? a : 'mp3', container: 'mp4' };
    const container = kind === 'video' ? b : a;
    return { type: 'video', fmt: 'mp3', container: QM_CONTAINERS.includes(container) ? container : 'mp4' };
  }

  // Valor a guardar al cambiar de pestaña (la opción "mejor" de ese estado).
  function qmDefaultValue(state) {
    if (state.type === 'thumb') return 'thumb';
    if (state.type === 'audio') return `audio:${state.fmt}:320`;
    return `best:${state.container}`;
  }

  // Filas a mostrar según el estado: nombre, insignia, formato a la derecha.
  function qmRowsFor(state, lang) {
    if (state.type === 'thumb') {
      return [{ value: 'thumb', name: t('skin_best_quality', lang), fmt: 'JPG', best: true }];
    }
    if (state.type === 'audio') {
      return QM_AUDIO_BITRATES.map((k, i) => ({
        value: `audio:${state.fmt}:${k}`, name: `${k} kbps`, fmt: state.fmt.toUpperCase(), best: i === 0,
      }));
    }
    const c = state.container;
    return [
      { value: `best:${c}`, name: t('skin_best_quality', lang), fmt: c.toUpperCase(), best: true },
      ...QM_HEIGHTS.map(({ h, badge }) => ({ value: `video:${h}:${c}`, name: `${h}p`, badge, fmt: c.toUpperCase() })),
    ];
  }

  // Estado actual del menú, compartido por todos los botones de la página.
  // Arranca con lo último que se eligió (contenedor/formato) para no tener
  // que cambiarlo en cada video; se mantiene al día con lo que se elija en
  // el popup (ver chrome.storage.onChanged más abajo).
  let quickMenuState = qmStateOf('best');

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

  // Busca un diálogo/modal REAL (marcado como tal para accesibilidad, con
  // role="dialog" o aria-modal="true" — así es como casi todos los sitios
  // bien hechos marcan tanto un visor ampliado de pantalla completa como
  // un panel más chico, ej. el menú "Compartir" de X) que se solape con el
  // área del video y no lo contenga (si lo contiene, el video está DENTRO
  // del propio diálogo, no tapado por él).
  //
  // Antes probamos detectar oclusión con document.elementFromPoint, pero
  // eso también detectaba capas invisibles que algunos menús desplegables
  // (ej. el menú nativo "..." de un tweet: Enviar vía chat/Copiar
  // vínculo/etc.) ponen sobre TODA la página solo para poder cerrarse al
  // hacer click afuera — sin ser un modal real, tapaban los botones igual.
  // Guiarnos por el rol de accesibilidad evita ese falso positivo, porque
  // esos menús desplegables usan role="menu", no role="dialog".
  function findCoveringDialog(video, rect) {
    const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
    for (const dlg of dialogs) {
      if (!dlg.isConnected || dlg.contains(video)) continue;
      const dr = dlg.getBoundingClientRect();
      if (dr.width === 0 || dr.height === 0) continue; // desmontado/oculto
      const overlap = !(dr.right < rect.left || dr.left > rect.right || dr.bottom < rect.top || dr.top > rect.bottom);
      if (overlap) return dlg;
    }
    return null;
  }

  // Un video cuenta como "tapado" si hay un diálogo/modal real (ver
  // arriba) solapado con su área — ej. el fondo oscuro de un visor
  // ampliado de pantalla completa (al expandir un video en X) o un panel
  // más chico como el menú "Compartir".
  function isOccludedByModal(video, rect) {
    return !!findCoveringDialog(video, rect);
  }


  // Todos los <video> que ahora mismo valen la pena mostrar con su propio
  // botón: visibles en el viewport, de un tamaño mínimo razonable, y no
  // tapados por un modal/visor ampliado. Orden de más grande a más chico
  // (así, si hay que recortar por MAX_OVERLAYS, se priorizan los videos
  // principales por sobre thumbnails secundarios).
  function getEligibleVideos() {
    const videos = Array.from(document.querySelectorAll('video'));
    const eligible = [];
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) continue;
      if (!isInViewport(rect)) continue;
      if (isOccludedByModal(v, rect)) continue;
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
  // Miniatura de la página: poster del <video>, o og:image / twitter:image.
  // En YouTube no hace falta (el popup arma la miniatura con el id del video).
  function getPageThumbnail(videoEl) {
    try {
      const abs = (u) => {
        if (!u) return null;
        const url = new URL(u, location.href);
        if (url.protocol === 'http:') url.protocol = 'https:';
        return url.protocol === 'https:' ? url.href : null;
      };
      const candidates = [];
      if (videoEl && videoEl.poster) candidates.push(videoEl.poster);
      ['meta[property="og:image"]', 'meta[property="og:image:url"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]'].forEach((sel) => {
        const m = document.querySelector(sel);
        if (m && m.content) candidates.push(m.content);
      });
      const link = document.querySelector('link[rel="image_src"]');
      if (link && link.href) candidates.push(link.href);
      for (const c of candidates) {
        const a = abs(c);
        if (a) return a;
      }
    } catch (e) { /* sin miniatura */ }
    return null;
  }

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
    wrap.className = 'ytdlp-minimalist-overlay ' + (mode === 'text' ? 'mode-text' : 'mode-icon') + (currentTheme === 'dark' ? ' theme-dark' : '');

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

    // Ya lo descargaste antes (según el historial): se recalcula acá (no
    // solo al crear el botón) porque en sitios tipo SPA (YouTube) el mismo
    // <video> puede cambiar de contenido sin que este overlay se
    // reconstruya — ver `reposition` más abajo, que la vuelve a llamar
    // periódicamente, y refreshAllDownloadedVisuals(), que la dispara apenas
    // cambia el historial (ej. termina una descarga en curso).
    function updateDownloadedVisual() {
      const downloaded = isUrlAlreadyDownloaded(getEffectiveDownloadUrl(videoEl));
      wrap.classList.toggle('is-downloaded', downloaded);
      btn.classList.toggle('is-downloaded', downloaded);
      // No pisamos el estado si el botón está en medio de un envío
      // (enviando/éxito/error): ese feedback tiene prioridad momentánea.
      if (btn.disabled) return;
      const label = btn.querySelector('span');
      btn.title = downloaded
        ? t('overlay_already_downloaded_title', currentLang)
        : t('overlay_btn_title', currentLang);
      if (label) {
        label.textContent = downloaded
          ? t('overlay_already_downloaded_label', currentLang)
          : t('overlay_download_label', currentLang);
      }
    }
    updateDownloadedVisual();

    const userPositioned = { value: false }; // objeto para poder pasarlo por referencia
    positionOverlay(wrap, videoEl, userPositioned);
    makeDraggable(wrap, userPositioned);

    // El reproductor puede cambiar de tamaño/posición (scroll, resize,
    // scroll infinito reacomodando tarjetas), así que reubicamos el botón
    // de forma periódica en vez de depender de un único evento. Aprovechamos
    // el mismo ciclo para refrescar el estado "ya descargado" del punto de
    // arriba.
    const reposition = () => {
      if (!extensionAlive()) {
        shutdownOrphaned();
        return;
      }
      positionOverlay(wrap, videoEl, userPositioned);
      updateDownloadedVisual();
    };
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
          thumbnail: getPageThumbnail(videoEl),
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
              btn.disabled = false;
              updateDownloadedVisual(); // restaura "Descargar" o "Ya descargado" según corresponda
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

    // Ubica el menú junto al botón sin salirse de la ventana: debajo si
    // entra, si no arriba, y si tampoco entra se ajusta al borde (el menú
    // tiene scroll propio). Se vuelve a llamar al cambiar de pestaña porque
    // el alto cambia (video tiene más filas que audio).
    function positionQualityMenu() {
      const btnRect = btn.getBoundingClientRect();
      const margin = 8;
      const menuW = qualityMenu.offsetWidth;
      const menuH = qualityMenu.offsetHeight;
      let top = btnRect.bottom + 4;
      if (top + menuH > window.innerHeight - margin) {
        const above = btnRect.top - 4 - menuH;
        top = above >= margin ? above : Math.max(margin, window.innerHeight - margin - menuH);
      }
      // Alineado a la derecha del botón, sin salirse de la ventana.
      const left = Math.min(Math.max(4, btnRect.right - menuW), Math.max(4, window.innerWidth - menuW - 4));
      qualityMenu.style.top = top + 'px';
      qualityMenu.style.left = left + 'px';
    }

    function makeTabBar(items, activeKey, onPick) {
      const bar = document.createElement('div');
      bar.className = 'ytdlp-qm-tabs';
      bar.setAttribute('role', 'tablist');
      for (const item of items) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'ytdlp-qm-tab' + (item.key === activeKey ? ' is-active' : '');
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', item.key === activeKey ? 'true' : 'false');
        tab.textContent = item.label;
        tab.addEventListener('click', (e) => {
          // stopPropagation: al redibujar el menú este botón sale del DOM y
          // el listener de "clic afuera" (document) lo tomaría por un clic
          // fuera del menú y lo cerraría.
          e.stopPropagation();
          if (item.key !== activeKey) onPick(item.key);
        });
        bar.appendChild(tab);
      }
      return bar;
    }

    // Cambiar de pestaña actualiza el estado compartido, lo guarda (igual que
    // el popup, que también recuerda la última elección) y redibuja el menú.
    function pickMenuState(patch) {
      quickMenuState = { ...quickMenuState, ...patch };
      chrome.storage.sync.set({ [QUALITY_STORAGE_KEY]: qmDefaultValue(quickMenuState) });
      renderQualityMenu();
      positionQualityMenu();
    }

    // Diseño: mismo estilo y mismas opciones que la lista de calidades del
    // popup (skin.js), en versión compacta — título "// Seleccionar calidad",
    // pestañas Video/Audio, contenedor (MP4/MKV/WEBM) o formato de audio
    // (MP3/M4A/OPUS), y filas de una línea con nombre + insignia + formato.
    // Un clic en una fila sigue enviando la descarga directo.
    function renderQualityMenu() {
      const state = quickMenuState;
      qualityMenu.textContent = '';
      qualityMenu.setAttribute('role', 'menu');

      const title = document.createElement('div');
      title.className = 'ytdlp-qm-title';
      title.textContent = t('skin_select_quality', currentLang);
      qualityMenu.appendChild(title);

      qualityMenu.appendChild(makeTabBar(
        [{ key: 'video', label: t('skin_tab_video', currentLang) }, { key: 'audio', label: t('skin_tab_audio', currentLang) }, { key: 'thumb', label: t('skin_tab_thumb', currentLang) }],
        state.type,
        (type) => pickMenuState({ type })
      ));
      if (state.type === 'thumb') {
        // Solo miniatura: sin sub-pestañas de formato.
      } else if (state.type === 'audio') {
        qualityMenu.appendChild(makeTabBar(
          QM_AUDIO_FMTS.map((f) => ({ key: f, label: f.toUpperCase() })),
          state.fmt,
          (fmt) => pickMenuState({ fmt })
        ));
      } else {
        qualityMenu.appendChild(makeTabBar(
          QM_CONTAINERS.map((c) => ({ key: c, label: c.toUpperCase() })),
          state.container,
          (container) => pickMenuState({ container })
        ));
      }

      const list = document.createElement('div');
      list.className = 'ytdlp-qm-list';
      for (const row of qmRowsFor(state, currentLang)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'ytdlp-qm-row';
        item.setAttribute('role', 'menuitem');
        const summary = [row.name, row.badge ? row.badge[0] : '', row.fmt].filter(Boolean).join(' ');
        item.setAttribute('aria-label', summary);
        item.title = summary;
        // La primera fila (la "mejor") es la opción destacada, como en el popup.
        if (row.best) item.classList.add('is-current');

        const name = document.createElement('span');
        name.className = 'ytdlp-qm-name';
        name.textContent = row.name;
        item.appendChild(name);

        if (row.best) {
          const b = document.createElement('span');
          b.className = 'ytdlp-qm-badge b-best';
          b.textContent = t('skin_best_badge', currentLang);
          item.appendChild(b);
        }
        if (row.badge) {
          const b = document.createElement('span');
          b.className = 'ytdlp-qm-badge ' + row.badge[1];
          b.textContent = row.badge[0];
          item.appendChild(b);
        }
        const fmt = document.createElement('span');
        fmt.className = 'ytdlp-qm-fmt';
        fmt.textContent = row.fmt;
        item.appendChild(fmt);

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          chrome.storage.sync.set({ [QUALITY_STORAGE_KEY]: row.value });
          closeQualityMenu();
          doSend(parseQualityValue(row.value));
        });
        list.appendChild(item);
      }
      qualityMenu.appendChild(list);
    }

    function openQualityMenu() {
      renderQualityMenu();
      // Se abre primero para poder medir su tamaño real y ubicarlo.
      qualityMenu.classList.add('open');
      positionQualityMenu();
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

    const entry = { wrap, qualityMenu, cleanupOverlay, updateDownloadedVisual };
    return entry;
  }

  // --- Solo mostramos botones si la página realmente tiene <video>. ---
  // Esto evita que aparezca en cualquier página (Google, Wikipedia, blogs,
  // etc.) y hace que funcione automáticamente en cualquier sitio que
  // yt-dlp soporte, sin tener que mantener una lista fija de dominios.
  let currentMode = 'icon';
  let currentTheme = 'light';
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

  // ---- "Ya lo descargaste antes" ----
  // Fuente principal: el historial REAL de la app (history.json), que
  // background.js cachea acá bajo APP_DOWNLOADED_KEY vía GET /downloaded
  // (ver refreshAppDownloadedUrls en background.js) — se llena apenas
  // termina cada descarga, sin importar si el popup de la extensión estuvo
  // abierto en algún momento.
  // Fuente secundaria (respaldo): sendHistory, el historial propio de la
  // EXTENSIÓN (pestaña "Historial" del popup), por si todavía no llegó
  // ningún refresco de la app (ej. justo se instaló la extensión) — ese
  // solo se marca 'completed' cuando el popup sondeó /progress hasta el
  // final, así que puede quedar desactualizado si el popup nunca se abrió,
  // pero sigue siendo mejor que nada mientras se pone al día el de arriba.
  const APP_DOWNLOADED_KEY = 'appDownloadedUrls';
  const HISTORY_KEY = 'sendHistory';
  let downloadedUrlKeys = new Set();
  let downloadedVideoIds = new Set();

  // Misma idea que cleanDownloadUrl (url-utils.js) pero un paso más allá,
  // pensada solo para COMPARAR si es "el mismo video", no para mandar a la
  // app: además de descartar &list=/&index=, ignora "t" (marca de tiempo
  // donde quedó el video) y barras finales, para que "ya lo descargué"
  // siga valiendo aunque se reabra el mismo video en otro momento del
  // reproductor o con distinto host www./m.
  function normalizeForHistoryMatch(rawUrl) {
    try {
      const cleaned = cleanDownloadUrl(rawUrl);
      const u = new URL(cleaned);
      const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
      u.searchParams.delete('t');
      u.hash = '';
      const path = u.pathname.replace(/\/+$/, '');
      const params = u.searchParams.toString();
      return host + path + (params ? '?' + params : '');
    } catch (e) {
      return rawUrl;
    }
  }

  // Solo para YouTube: el "videoId" que guarda el historial de la app viene
  // de los metadatos reales que sacó yt-dlp, así que comparar por ahí es
  // más robusto que por URL — reconoce el mismo video sin importar si se
  // llegó por youtu.be, /watch?v=, /shorts/ o con distintos parámetros.
  function extractYoutubeVideoId(rawUrl) {
    try {
      const u = new URL(rawUrl);
      const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '').replace(/^music\./, '');
      if (host === 'youtube.com') {
        if (u.pathname === '/watch') return u.searchParams.get('v');
        if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
        return null;
      }
      if (host === 'youtu.be') return u.pathname.replace(/^\//, '') || null;
      return null;
    } catch (e) {
      return null;
    }
  }

  // entries: array de { url, videoId, extractorKey } (ver GET /downloaded)
  // o de entradas de sendHistory ({ url, status }). isCompletedList indica
  // si hace falta filtrar por status === 'completed' (sendHistory trae de
  // todo: sent/protocol/error/completed) o si ya vienen todas confirmadas
  // (las de la app, que solo manda las exitosas).
  function mergeDownloadedEntries(entries, requireCompletedStatus) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || !entry.url) continue;
      if (requireCompletedStatus && entry.status !== 'completed') continue;
      downloadedUrlKeys.add(normalizeForHistoryMatch(entry.url));
      if (entry.videoId) downloadedVideoIds.add(entry.videoId);
    }
  }

  function rebuildDownloadedSet(appList, sendHistoryList) {
    downloadedUrlKeys = new Set();
    downloadedVideoIds = new Set();
    mergeDownloadedEntries(appList, false);
    mergeDownloadedEntries(sendHistoryList, true);
  }

  function isUrlAlreadyDownloaded(rawUrl) {
    if (!rawUrl) return false;
    const videoId = extractYoutubeVideoId(rawUrl);
    if (videoId && downloadedVideoIds.has(videoId)) return true;
    return downloadedUrlKeys.has(normalizeForHistoryMatch(rawUrl));
  }

  function loadDownloadHistory(callback) {
    // Le pedimos a background.js que refresque su caché del historial de
    // la app ANTES de leerla (en vez de solo leer lo que ya tenía guardado
    // de la última alarma, que puede ser de hasta 1 minuto atrás) — así el
    // primer render de esta página ya sale con el dato más fresco posible.
    // Si background.js no llega a responder a tiempo (o el mensaje falla
    // por lo que sea), igual seguimos y leemos lo que haya en storage.
    const proceed = () => {
      chrome.storage.local.get({ [APP_DOWNLOADED_KEY]: [], [HISTORY_KEY]: [] }, (data) => {
        rebuildDownloadedSet(data[APP_DOWNLOADED_KEY], data[HISTORY_KEY]);
        if (callback) callback();
      });
    };
    try {
      chrome.runtime.sendMessage({ type: 'refresh-downloaded-urls' }, () => {
        void chrome.runtime.lastError; // evita el warning si no hubo listener a tiempo
        proceed();
      });
    } catch (e) {
      proceed();
    }
  }

  // Recorre los botones ya en pantalla para que se actualicen apenas
  // cambia el historial (ej. termina una descarga en curso), sin esperar
  // a que syncOverlay() los reconstruya.
  function refreshAllDownloadedVisuals() {
    for (const entry of overlaysByVideo.values()) {
      if (entry.updateDownloadedVisual) entry.updateDownloadedVisual();
    }
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
    if (!extensionAlive()) {
      shutdownOrphaned();
      return;
    }
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
    // Cargamos primero el historial (para saber qué videos ya se
    // descargaron) y recién con eso resuelto pedimos los ajustes y armamos
    // los botones, así el primer render ya sale con el color/etiqueta
    // correctos en vez de "saltar" un instante después.
    loadDownloadHistory(() => {
      chrome.storage.sync.get(
        { overlayMode: 'icon', overlayTheme: 'light', overlayEnabled: true, [DISABLED_SITES_KEY]: [], [EXTENSION_DISABLED_SITES_KEY]: [], [I18N_LANG_KEY]: I18N_DEFAULT_LANG, [QUALITY_STORAGE_KEY]: 'best' },
        (data) => {
        currentMode = data.overlayMode === 'text' ? 'text' : 'icon';
        currentTheme = data.overlayTheme === 'dark' ? 'dark' : 'light';
        overlayEnabled = data.overlayEnabled !== false;
        disabledSites = Array.isArray(data[DISABLED_SITES_KEY]) ? data[DISABLED_SITES_KEY] : [];
        extensionDisabledSites = Array.isArray(data[EXTENSION_DISABLED_SITES_KEY]) ? data[EXTENSION_DISABLED_SITES_KEY] : [];
        currentLang = i18nNormalizeLang(data[I18N_LANG_KEY]);
        quickMenuState = qmStateOf(data[QUALITY_STORAGE_KEY]);
        syncOverlay();

        // Muchos sitios (YouTube, X/Twitter, Instagram, etc.) son SPA y montan
        // el <video> unos instantes después de cargar la página, reemplazan
        // el nodo al navegar entre videos, o cargan más tarjetas al hacer
        // scroll infinito. Por eso vigilamos el DOM en vez de chequear una
        // sola vez.
        const observer = new MutationObserver(() => syncOverlay());
        pageObserver = observer;
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });

        // Respaldo por si algún cambio no dispara el MutationObserver (p. ej.
        // un <video> que solo cambia de tamaño/posición al hacer scroll, o
        // entra/sale del viewport sin que cambie el DOM).
        pageSyncIntervalId = setInterval(syncOverlay, 1000);
      });
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
    sendResponse({ url: getEffectiveDownloadUrl(video), title: getEffectiveTitle(video), thumbnail: getPageThumbnail(video) });
  });

  // Si el usuario cambia el modo o apaga/prende el botón flotante desde los
  // ajustes mientras esta página sigue abierta, reconstruimos todos los
  // overlays (o los quitamos/mostramos) al toque, sin tener que recargar
  // la pestaña.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    // La última calidad cambió (desde el popup o desde otro botón): solo se
    // actualiza el estado del menú; no hace falta reconstruir los botones.
    if (changes[QUALITY_STORAGE_KEY]) {
      quickMenuState = qmStateOf(changes[QUALITY_STORAGE_KEY].newValue);
    }
    let relevant = false;
    if (changes.overlayMode) {
      currentMode = changes.overlayMode.newValue === 'text' ? 'text' : 'icon';
      relevant = true;
    }
    if (changes.overlayTheme) {
      currentTheme = changes.overlayTheme.newValue === 'dark' ? 'dark' : 'light';
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

  // El historial vive en chrome.storage.LOCAL (no sync): tanto
  // APP_DOWNLOADED_KEY (lo cachea background.js desde la app, ver
  // refreshAppDownloadedUrls) como HISTORY_KEY (sendHistory, respaldo — ver
  // arriba). Cualquiera de los dos que cambie, sin que esta pestaña haga
  // nada — por ejemplo cuando termina una descarga que se mandó desde el
  // popup, desde OTRA pestaña con el mismo video, o directo desde la app —
  // dispara un refresco de color/etiqueta de los botones ya en pantalla
  // (sin reconstruirlos), sin esperar el refresco periódico de `reposition`.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes[APP_DOWNLOADED_KEY] && !changes[HISTORY_KEY]) return;
    chrome.storage.local.get({ [APP_DOWNLOADED_KEY]: [], [HISTORY_KEY]: [] }, (data) => {
      rebuildDownloadedSet(data[APP_DOWNLOADED_KEY], data[HISTORY_KEY]);
      refreshAllDownloadedVisuals();
    });
  });
})();
