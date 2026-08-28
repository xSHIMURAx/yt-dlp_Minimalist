Poné acá los 3 binarios de Windows antes de correr "npm run dist".
electron-builder los empaqueta dentro del .exe (ver "extraResources" en package.json).

1. yt-dlp.exe
   https://github.com/yt-dlp/yt-dlp/releases
   (bajá "yt-dlp.exe" del último release)

2. ffmpeg.exe
   https://www.gyan.dev/ffmpeg/builds/  -> "release essentials"
   Es un .zip: adentro está en la carpeta bin/. Sacá solo ffmpeg.exe
   (no hace falta ffplay.exe ni ffprobe.exe, la app no los usa).

3. deno.exe
   https://github.com/denoland/deno/releases
   Bajá "deno-x86_64-pc-windows-msvc.zip" del último release y sacá deno.exe.

Este archivo (LEEME.txt) no se empaqueta con la app, es solo una nota para vos.
Podés borrarlo o dejarlo, da igual.
