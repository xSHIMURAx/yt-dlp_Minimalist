# YT-DLP Minimalist

![Vista principal](screenshots/Principal.gif)

Versión de escritorio (Electron) inspirada en el diseño del [yoinks](https://github.com/pablostanley/yoinks)
original de terminal — mismo look (fondo negro, logo en bloques, caja de
"Paste a link" con borde punteado), rebautizada como "YT-DLP Minimalist".

## Capturas del programa

**Información del video y selección de calidad**

![Información del video](screenshots/01.png)

**Descarga de playlists completas**

![Descarga de playlist](screenshots/02.png)

**Configuración de descarga**

![Configuración de descarga](screenshots/03.png)

**Descargas en curso**

![Descargas en curso](screenshots/04.png)

**Opciones predeterminadas (presets)**

![Opciones predeterminadas](screenshots/05.png)

**Panel de actualizaciones**

![Actualizaciones](screenshots/06.png)

**Ventana "Acerca de"**

![Acerca de](screenshots/07.png)

## Requisitos para compilarla tu mismo

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

### Incluir yt-dlp, ffmpeg y Deno dentro del .exe (recomendado)

Los tres binarios se empaquetan igual, desde la misma carpeta:

1. Descarga `yt-dlp.exe` desde https://github.com/yt-dlp/yt-dlp/releases
2. Descarga `ffmpeg.exe` desde https://www.gyan.dev/ffmpeg/builds/ (build
   "release essentials"; el `.zip` trae varios `.exe` en `bin/`, solo
   necesitás `ffmpeg.exe`)
3. Descarga `deno.exe` desde https://github.com/denoland/deno/releases
   (`deno-x86_64-pc-windows-msvc.zip`)
4. Colocá los tres en `assets/bin/` (`yt-dlp.exe`, `ffmpeg.exe`, `deno.exe`)

El `build` de `package.json` ya tiene `extraResources` apuntando a esa
carpeta:

```json
"extraResources": [
  { "from": "assets/bin", "to": "bin" }
]
```

Si un binario no está en `assets/bin`, la app no rompe: sigue descargándolo
sola a su carpeta de configuración (`userData/bin`) la primera vez que hace
falta, igual que antes. Empaquetarlos solo evita esa descarga inicial y hace
que la app funcione sin conexión desde el primer arranque — a cambio, el
instalador pesa bastante más. También podés forzar una redescarga/
actualización de cualquiera de los tres desde Configuración → Actualizaciones.

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
