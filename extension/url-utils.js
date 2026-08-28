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

// ---- Protocolo personalizado (respaldo para cuando la app está cerrada) ----
// Si la app fue instalada con el instalador de Windows, quedó registrada
// como manejadora de "ytdlpminimalist://". La propia app, al arrancar, lee
// la URL real desde este link — ver 'ytdlpminimalist' en src/main.js.
const PROTOCOL_SCHEME = 'ytdlpminimalist';

function buildProtocolUrl(url) {
  return `${PROTOCOL_SCHEME}://add-url?url=${encodeURIComponent(url)}`;
}
