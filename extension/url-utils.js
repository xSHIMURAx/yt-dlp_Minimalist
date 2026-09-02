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
function parseQualityValue(value) {
  if (!value || value === 'best') return { type: 'best' };
  if (value === 'audio') return { type: 'audio' };
  if (value.startsWith('audio:')) {
    const format = value.slice('audio:'.length);
    if (format === 'm4a' || format === 'opus') return { type: 'audio', format };
    return { type: 'audio' };
  }
  if (value.startsWith('video:')) {
    const height = parseInt(value.slice('video:'.length), 10);
    if (Number.isFinite(height) && height > 0) return { type: 'video', height };
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
