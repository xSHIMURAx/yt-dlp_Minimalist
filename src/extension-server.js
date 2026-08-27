// Servidor HTTP mínimo, atado solo a 127.0.0.1, que recibe la URL que el
// usuario elige desde la extensión de navegador y se la pasa a la ventana
// principal por IPC. No expone nada fuera de la máquina local: al escuchar
// explícitamente en '127.0.0.1' (en vez de '0.0.0.0'), el sistema operativo
// rechaza cualquier conexión que no venga del propio equipo.
const http = require('http');

const PORT = 14370;
const HOST = '127.0.0.1';

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// onUrl(url, title) se llama cuando llega una URL válida.
function startExtensionServer(onUrl) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/add-url') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      body += chunk;
      // Corta cualquier cosa rara; una URL nunca necesita más que esto.
      if (body.length > 8192) {
        tooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload too large' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (tooLarge) return;
      try {
        const data = JSON.parse(body || '{}');
        if (!isHttpUrl(data.url)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid url' }));
          return;
        }
        onUrl(data.url, typeof data.title === 'string' ? data.title : '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
      }
    });
  });

  server.on('error', (err) => {
    // Puerto ocupado (ej. dos instancias de la app abiertas): no rompemos la app,
    // solo queda sin escuchar y la extensión mostrará "no se pudo conectar".
    console.warn('[extension-server] No se pudo iniciar:', err.message);
  });

  server.listen(PORT, HOST);
  return server;
}

module.exports = { startExtensionServer };
