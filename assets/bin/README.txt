Place the 3 Windows binaries here before running “npm run dist”.
electron-builder bundles them into the .exe (see “extraResources” in package.json).

1. yt-dlp.exe
   https://github.com/yt-dlp/yt-dlp/releases
   (Download “yt-dlp.exe” from the latest release)

2. ffmpeg.exe
   https://www.gyan.dev/ffmpeg/builds/  -> “release essentials”
   It’s a .zip file: inside, it’s in the bin/ folder. Extract only ffmpeg.exe
   (you don’t need ffplay.exe or ffprobe.exe; the app doesn’t use them).

3. deno.exe
   https://github.com/denoland/deno/releases
   Download “deno-x86_64-pc-windows-msvc.zip” from the latest release and extract deno.exe.

This file (README.txt) isn’t included with the app; it’s just a note for you.
You can delete it or leave it—it doesn’t matter.


--- PO Token automático (proveedor oficial bgutil) — para 4K y videos con restricción de edad ---

Requisitos: deno.exe en esta carpeta (paso 3 de arriba), Node/npm y tar (Windows 10/11).

Antes de compilar, ejecuta UNA vez desde la raíz del proyecto (necesita internet):

   npm run prepare:pot

Eso deja en esta carpeta:

   assets/bin/pot-server.tar.gz                         (~20 MB: servidor + dependencias ya instaladas)
   assets/bin/yt-dlp-plugins/bgutil-ytdlp-pot-provider.zip

Después "npm run dist" los mete en el instalador.

El servidor NO arranca al abrir la app: solo se inicia cuando consultas o
descargas un video de YouTube con restricción de edad. La primera vez extrae
pot-server.tar.gz en %APPDATA%\YT-DLP Minimalist\bin (un segundo, SIN
internet) y lo inicia en 127.0.0.1:4416 con deno.exe (unos 10-15 s). Después
se queda corriendo hasta cerrar la app y se detiene al salir. Si ya hay un
servidor respondiendo en ese puerto (por ejemplo Docker), lo reutiliza.

La Terminal de la app lo inicia con cualquier enlace de YouTube (modo manual).
Las descargas de playlists o de la extensión lo inician solo si ya se sabe que
el video tiene restricción de edad; si no, usan el que ya esté corriendo.

Si el instalador no trae pot-server.tar.gz, la app lo descarga e instala sola
la primera vez (necesita internet y puede tardar un par de minutos).

Para probar con "npm start" sin compilar:

   npm run prepare:pot -- --managed

(lo instala directamente en %APPDATA%\YT-DLP Minimalist\bin).

Para otra versión del proveedor:   npm run prepare:pot -- --version X.Y.Z
(cambia también POT_PROVIDER_VERSION en src/main.js).
