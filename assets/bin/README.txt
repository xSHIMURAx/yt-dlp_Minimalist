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
