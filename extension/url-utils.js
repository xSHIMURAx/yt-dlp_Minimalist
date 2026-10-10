// Utilidad compartida por popup.js y content-overlay.js.
//
// Cuando estás viendo un video de YouTube dentro de una playlist o un Mix
// (autogenerado por YouTube), la URL de la pestaña trae también
// "&list=..." (y a veces "&index=", "&pp=", etc). Si mandamos esa URL tal
// cual a YT-DLP Minimalist, la app la interpreta como "descargar la lista
// completa" en vez de solo el video que se está viendo — por eso aparecía
// "Cargando playlist... 1200 videos" al querer bajar un solo video.
//
// cleanDownloadUrl() se queda solo con "v" (y "t" si hay marca de tiempo)
// para links de /watch, así siempre se manda el video individual. Si el
// usuario abrió directamente una página de playlist real
// (youtube.com/playlist?list=...) o cualquier otro sitio, la URL se manda
// sin tocar.
function cleanDownloadUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');

    if (host === 'youtube.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch' && u.searchParams.has('v')) {
        const clean = new URL('https://www.youtube.com/watch');
        clean.searchParams.set('v', u.searchParams.get('v'));
        const t = u.searchParams.get('t');
        if (t) clean.searchParams.set('t', t);
        return clean.toString();
      }
      return rawUrl;
    }

    if (host === 'youtu.be') {
      // Formato corto: youtu.be/VIDEOID?list=...&t=...
      const videoId = u.pathname.replace(/^\//, '');
      if (videoId) {
        const clean = new URL('https://www.youtube.com/watch');
        clean.searchParams.set('v', videoId);
        const t = u.searchParams.get('t');
        if (t) clean.searchParams.set('t', t);
        return clean.toString();
      }
      return rawUrl;
    }

    return rawUrl;
  } catch (err) {
    return rawUrl;
  }
}

// ---- Selector de calidad (popup y botón flotante) ----
// Traduce el value del <select>/lista de calidad ("best", "video:1080",
// "audio") al objeto que espera la app en /add-url. Si el video no tiene
// exactamente esa altura disponible, la app cae sola a la más cercana (ver
// README de la app, sección "Calidad enviada desde la extensión").
// Gramática del valor de calidad (el mismo que usa el <select> del popup):
//   best[:mp4|mkv|webm]                  -> mejor video+audio
//   video:<alto>[:mp4|mkv|webm]          -> altura puntual (ej. video:1080:webm)
//   audio[:<fmt>[:<kbps>]]           -> solo audio (fmt = mp3|m4a|opus)
//   thumb                            -> solo la miniatura del video (imagen)
// Los valores viejos ("best", "video:720", "audio", "audio:m4a") siguen valiendo.
const QUALITY_CONTAINERS = ['mp4', 'mkv', 'webm'];
const QUALITY_AUDIO_FORMATS = ['mp3', 'm4a', 'opus'];
function parseQualityValue(value) {
  if (!value) return { type: 'best' };
  const [kind, a, b] = String(value).split(':');
  if (kind === 'best') {
    const out = { type: 'best' };
    if (QUALITY_CONTAINERS.includes(a)) out.container = a;
    return out;
  }
  if (kind === 'thumb') return { type: 'thumb' };
  if (kind === 'audio') {
    if (!a) return { type: 'audio' };
    const format = QUALITY_AUDIO_FORMATS.includes(a) ? a : 'mp3';
    const out = { type: 'audio', format };
    const kbps = parseInt(b, 10);
    if (Number.isFinite(kbps) && kbps > 0) out.bitrateKbps = kbps;
    return out;
  }
  if (kind === 'video') {
    const height = parseInt(a, 10);
    if (Number.isFinite(height) && height > 0) {
      const out = { type: 'video', height };
      if (QUALITY_CONTAINERS.includes(b)) out.container = b;
      return out;
    }
  }
  return { type: 'best' };
}

const QUALITY_STORAGE_KEY = 'lastQuality';
// Si la app fue instalada con el instalador de Windows, quedó registrada
// como manejadora de "ytdlpminimalist://". La propia app, al arrancar, lee
// la URL real desde este link — ver 'ytdlpminimalist' en src/main.js.
const PROTOCOL_SCHEME = 'ytdlpminimalist';

// "quality" es opcional: cuando ya se eligió una calidad puntual (popup o
// menú del botón flotante) y hay que caer al link de protocolo porque la
// app no estaba abierta, la mandamos también acá (como JSON codificado en
// el query "quality") para que la app, al abrirse en frío, arranque la
// descarga directo con esa calidad en vez de mostrar su propio selector —
// ver extractQualityFromProtocolLink en src/main.js.
// "extId" también es opcional: es el id que background.js ya generó para
// esta descarga ANTES de intentar el POST por HTTP (ver
// generateClientDownloadId), así que es el mismo id con el que el popup ya
// empezó a sondear /progress. Mandándolo acá también, la app lo usa para
// registrar la descarga (ver extractExtIdFromProtocolLink en src/main.js)
// en vez de inventar uno nuevo — así el sondeo que ya arrancó del lado del
// popup encuentra esta misma descarga apenas la app abre, sin depender de
// ninguna respuesta HTTP que nunca llegó.
function buildProtocolUrl(url, quality, extId) {
  let out = `${PROTOCOL_SCHEME}://add-url?url=${encodeURIComponent(url)}`;
  if (quality) {
    try {
      out += `&quality=${encodeURIComponent(JSON.stringify(quality))}`;
    } catch (e) {
      // Si falla la serialización, seguimos sin la calidad (igual que antes).
    }
  }
  if (extId) out += `&extId=${encodeURIComponent(extId)}`;
  return out;
}

// Variante sin URL: solo trae la app al frente (o la abre si estaba
// cerrada), sin agregar ninguna descarga. La usa el botón "Abrir programa"
// del popup. Ver el manejo de "ytdlpminimalist://open" en src/main.js.
function buildOpenProtocolUrl() {
  return `${PROTOCOL_SCHEME}://open`;
}

// Miniatura de un video de YouTube a partir de su URL (null si no es YouTube
// o no se puede sacar el id). Usada por el historial del popup.
function youtubeThumbnailUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const h = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h.endsWith('youtube.com') || h.endsWith('youtube-nocookie.com')) {
      id = u.searchParams.get('v');
      if (!id) {
        const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
        if (m) id = m[1];
      }
    }
    return id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg` : null;
  } catch (e) {
    return null;
  }
}
