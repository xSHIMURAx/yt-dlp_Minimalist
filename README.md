# YT-DLP Interface

Versión de escritorio (Electron) inspirada en el diseño del [yoinks](https://github.com/pablostanley/yoinks)
original de terminal — mismo look (fondo negro, logo en bloques, caja de
"Paste a link" con borde punteado), rebautizada como "YT-DLP Interface".

## Requisitos

- [Node.js](https://nodejs.org) 18 o superior

## Desarrollo (probar la app sin empaquetar)

```bash
npm install
npm start
```

## Generar el .exe

```bash
npm run dist
```

Esto usa `electron-builder` y genera un instalador `.exe` (NSIS) y una
versión portable en `dist/`.

### Incluir yt-dlp dentro del .exe (recomendado)

1. Descarga `yt-dlp.exe` desde https://github.com/yt-dlp/yt-dlp/releases
2. Colócalo en `assets/bin/yt-dlp.exe`
3. Agrega esto a `extraResources` en el `build` de `package.json`:

```json
"extraResources": [
  { "from": "assets/bin", "to": "bin" }
]
```

ffmpeg no viene empaquetado dentro del `.exe`: la app lo descarga sola a su
carpeta de configuración (junto a yt-dlp y, si lo instalas, Deno) la primera
vez que se abre, así que no necesitas instalarlo aparte. También puedes
forzar una redescarga/actualización desde Configuración → Actualizaciones.

## Estructura

```
yt-dlp-interface/
├── package.json
├── src/
│   ├── main.js
│   ├── preload.js
│   ├── index.html
│   ├── styles.css
│   └── renderer.js
└── assets/
```

## Licencia y créditos

Basado en el diseño de [yoinks](https://github.com/pablostanley/yoinks)
de Pablo Stanley, publicado bajo licencia MIT.

**Nota de uso justo:** descargar contenido puede violar los términos de
servicio de algunas plataformas — descarga solo lo que tengas derecho a
guardar.

## Presets

El botón ⚙ en la barra de título abre el panel de "Opciones Predeterminadas",
igual al de apps como media-downloader: una tabla editable de
Sitio Web / Nombre IU / Opciones, donde "Opciones" es el comando yt-dlp
completo (ej. `-f bestvideo[format_note*=1080p]+bestaudio` o
`-f bestaudio --extract-audio --audio-format mp3`).

- **Añadir**: completa los 3 campos y presiona "Añadir".
- **Eliminar**: botón "eliminar" en cada fila.
- **Establecer Predeterminados**: restaura los presets originales.

Se guardan en disco (`presets.json` en la carpeta de datos de la app) y
persisten entre sesiones.

Para usarlos rápido: pega un link y usa el botón "preset ▾" junto a
"yoink" — selecciona un preset y descarga directo con esas opciones, sin
pasar por la lista de resoluciones.
