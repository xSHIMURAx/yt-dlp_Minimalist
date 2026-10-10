// Interfaz visual de calidad (Audio / MP4 / WEBM + lista con radios + recorte).
// No toca la lógica de descarga: solo maneja el <select id="qualitySelect"> que
// popup.js ya lee al enviar y guarda en chrome.storage, y expone
// window.skinGetTrim() para el recorte opcional.
(() => {
  const select = document.getElementById('qualitySelect');
  const listEl = document.getElementById('qualityList');
  const typeTabs = document.querySelectorAll('.type-tab');
  const fmtWrap = document.getElementById('formatTabs');
  const fmtTabs = document.querySelectorAll('#formatTabs .fmt-tab');
  const contWrap = document.getElementById('containerTabs');
  const contTabs = document.querySelectorAll('#containerTabs .fmt-tab');
  const sendBtn = document.getElementById('sendBtn');
  const thumb = document.getElementById('videoThumb');
  const thumbFallback = document.getElementById('videoThumbFallback');
  const hostEl = document.getElementById('videoHost');

  let lang = 'es';
  let lastFmt = 'mp3';        // último formato de audio elegido
  let lastContainer = 'mp4';  // último contenedor de video elegido

  const AUDIO_BITRATES = [320, 256, 192, 128];
  const HEIGHTS = [
    { h: 2160, badge: ['4K', 'b-4k'] },
    { h: 1440, badge: ['2K', 'b-2k'] },
    { h: 1080, badge: ['Full HD', 'b-fhd'] },
    { h: 720, badge: ['HD', 'b-hd'] },
    { h: 480, badge: ['SD', 'b-sd'] },
    { h: 360 },
    { h: 240 },
    { h: 144 },
  ];
  const AUDIO_FMTS = ['mp3', 'm4a', 'opus'];
  const VIDEO_CONTAINERS = ['mp4', 'mkv', 'webm'];

  // Valor del <select> -> estado de la interfaz.
  function stateOf(value) {
    const [kind, a, b] = String(value).split(':');
    if (kind === 'thumb') return { type: 'thumb', fmt: 'mp3', container: 'mp4' };
    if (kind === 'audio') return { type: 'audio', fmt: AUDIO_FMTS.includes(a) ? a : 'mp3', container: 'mp4' };
    // best:<contenedor> | video:<alto>:<contenedor>
    const container = kind === 'video' ? b : a;
    return { type: 'video', fmt: 'mp3', container: VIDEO_CONTAINERS.includes(container) ? container : 'mp4' };
  }

  // El <select> original solo conoce unos pocos valores; agregamos el resto
  // de combinaciones para que popup.js pueda restaurar la última elección.
  function ensureOption(value) {
    if ([...select.options].some((o) => o.value === value)) return;
    const o = document.createElement('option');
    o.value = value;
    o.textContent = value;
    select.append(o);
  }
  AUDIO_FMTS.forEach((f) => {
    AUDIO_BITRATES.forEach((k) => ensureOption(`audio:${f}:${k}`));
  });
  VIDEO_CONTAINERS.forEach((c) => {
    ensureOption(`best:${c}`);
    HEIGHTS.forEach(({ h }) => ensureOption(`video:${h}:${c}`));
  });

  ensureOption('thumb');

  function setValue(value) {
    ensureOption(value);
    select.value = value;
    select.dispatchEvent(new Event('change')); // popup.js guarda la última calidad
  }

  function rowsFor(state) {
    if (state.type === 'thumb') {
      return [{ value: 'thumb', nameKey: 'skin_best_quality', fmt: 'JPG', best: true }];
    }
    if (state.type === 'audio') {
      return AUDIO_BITRATES.map((k, i) => ({
        value: `audio:${state.fmt}:${k}`, name: `${k} kbps`, fmt: state.fmt.toUpperCase(), best: i === 0,
      }));
    }
    const c = state.container;
    return [
      { value: `best:${c}`, nameKey: 'skin_best_quality', fmt: c.toUpperCase(), best: true },
      ...HEIGHTS.map(({ h, badge }) => ({ value: `video:${h}:${c}`, name: `${h}p`, badge, fmt: c.toUpperCase() })),
    ];
  }

  function defaultValue(state) {
    if (state.type === 'thumb') return 'thumb';
    if (state.type === 'audio') return `audio:${state.fmt}:320`;
    return `best:${state.container}`;
  }

  // Valores guardados por versiones anteriores ("best", "video:720", "audio",
  // "audio:m4a") -> equivalente en la gramática nueva, para que la fila
  // correcta aparezca marcada y lo que se envía coincida con lo que se ve.
  function normalizeLegacy(value) {
    const [kind, a, b] = String(value).split(':');
    if (kind === 'best' && !a) return 'best:mp4';
    if (kind === 'video' && !b) return `video:${a}:mp4`;
    if (kind === 'audio' && !a) return 'audio:mp3:320';
    // 'audio:wav' (guardado por versiones anteriores) cae a MP3 al no existir ya WAV.
    if (kind === 'audio' && (!b || !AUDIO_FMTS.includes(a))) return `audio:${AUDIO_FMTS.includes(a) ? a : 'mp3'}:320`;
    return value;
  }

  function render() {
    const normalized = normalizeLegacy(select.value);
    if (normalized !== select.value) { ensureOption(normalized); select.value = normalized; }
    const state = stateOf(select.value);
    typeTabs.forEach((b) => b.classList.toggle('active', b.dataset.type === state.type));
    fmtWrap.hidden = state.type !== 'audio';
    fmtTabs.forEach((b) => b.classList.toggle('active', b.dataset.fmt === state.fmt));
    contWrap.hidden = state.type !== 'video';
    contTabs.forEach((b) => b.classList.toggle('active', b.dataset.cont === state.container));
    if (state.type === 'audio') lastFmt = state.fmt; else if (state.type === 'video') lastContainer = state.container;

    listEl.textContent = '';
    rowsFor(state).forEach((row) => {
      const selected = select.value === row.value;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'q-row' + (selected ? ' selected' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', selected ? 'true' : 'false');

      const radio = document.createElement('span');
      radio.className = 'q-radio';
      const name = document.createElement('span');
      name.className = 'q-name';
      name.textContent = row.nameKey ? t(row.nameKey, lang) : row.name;
      btn.append(radio, name);

      if (row.best) {
        const b = document.createElement('span');
        b.className = 'q-badge b-best';
        b.textContent = t('skin_best_badge', lang);
        btn.append(b);
      }
      if (row.badge) {
        const b = document.createElement('span');
        b.className = 'q-badge ' + row.badge[1];
        b.textContent = row.badge[0];
        btn.append(b);
      }
      const fmt = document.createElement('span');
      fmt.className = 'q-fmt';
      fmt.textContent = row.fmt;
      btn.append(fmt);

      btn.addEventListener('click', () => { setValue(row.value); render(); });
      listEl.append(btn);
    });

    const label = state.type === 'thumb'
      ? t('skin_download_thumb', lang)
      : state.type === 'audio'
      ? t('skin_download_audio', lang, { format: state.fmt.toUpperCase() })
      : t('skin_download_video', lang, { format: state.container.toUpperCase() });
    sendBtn.textContent = label;
  }

  typeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const cur = stateOf(select.value);
      if (tab.dataset.type === cur.type) return;
      setValue(defaultValue({ type: tab.dataset.type, fmt: lastFmt, container: lastContainer }));
      render();
    });
  });
  fmtTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      setValue(defaultValue({ type: 'audio', fmt: tab.dataset.fmt }));
      render();
    });
  });
  contTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      setValue(defaultValue({ type: 'video', container: tab.dataset.cont }));
      render();
    });
  });

  // popup.js restaura la última calidad guardada de forma asíncrona.
  select.addEventListener('qualitysync', render);

  i18nGetLang((l) => { lang = l; render(); });
  document.querySelectorAll('input[name="language"]').forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) { lang = i18nNormalizeLang(r.value); render(); }
    });
  });

  // El recorte se quitó de la interfaz: popup.js sigue consultando esto.
  window.skinGetTrim = () => ({ trim: null });

  // ---- Miniatura (solo YouTube) y sitio de origen ----
  function youtubeId(u) {
    try {
      const url = new URL(u);
      const h = url.hostname.replace(/^www\.|^m\./, '');
      if (h === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
      if (h.endsWith('youtube.com') || h.endsWith('youtube-nocookie.com')) {
        if (url.searchParams.get('v')) return url.searchParams.get('v');
        const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
        if (m) return m[1];
      }
    } catch (e) { /* URL inválida: sin miniatura */ }
    return null;
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const url = typeof effectiveUrl !== 'undefined' ? effectiveUrl : null;
    if (url || tries > 40) {
      clearInterval(timer);
      if (!url) return;
      try { hostEl.textContent = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* noop */ }
      const id = youtubeId(url);
      if (id) {
        thumb.onload = () => { thumb.hidden = false; thumbFallback.classList.add('hide'); };
        thumb.src = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
      } else if (typeof effectiveThumb !== 'undefined' && effectiveThumb) {
        // Otros sitios: og:image / poster que leyó el content script.
        thumb.referrerPolicy = 'no-referrer';
        thumb.onload = () => { thumb.hidden = false; thumbFallback.classList.add('hide'); };
        thumb.src = effectiveThumb;
      }
    }
  }, 125);

  render();
})();
