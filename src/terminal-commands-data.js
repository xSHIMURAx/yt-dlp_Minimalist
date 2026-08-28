// Lista de referencia de comandos de yt-dlp, agrupados por categoría.
// Usada por el panel "Referencia de comandos" del modo Terminal
// (ver renderer.js: openTerminalReferencePanel / renderTerminalReferenceList).
//
// Se definen dos listas paralelas (ES / EN) en el mismo orden, para que
// renderer.js pueda elegir la que corresponda según window.i18n.getLanguage().
window.YTDLP_COMMANDS_ES = [
  {
    category: 'Selección de formatos (video y audio)',
    items: [
      { cmd: '-f best', desc: 'Descarga el mejor formato disponible en un solo archivo (video + audio).' },
      { cmd: '-f bestvideo', desc: 'Descarga solo la mejor pista de video disponible.' },
      { cmd: '-f bestaudio', desc: 'Descarga solo la mejor pista de audio disponible.' },
      { cmd: '-f bestvideo+bestaudio', desc: 'Descarga y une la mejor pista de video y la mejor de audio.' },
      { cmd: '-f worst', desc: 'Descarga el formato de menor calidad disponible.' },
      { cmd: '-f worstvideo', desc: 'Descarga la peor calidad de video disponible.' },
      { cmd: '-f worstaudio', desc: 'Descarga la peor calidad de audio disponible.' },
      { cmd: '-f mp4', desc: 'Descarga el mejor formato disponible que sea container MP4.' },
      { cmd: '-f "ba[ext=m4a]"', desc: 'Descarga solo el mejor audio en formato M4A.' },
      { cmd: '-f "bv[ext=mp4]+ba[ext=m4a]"', desc: 'Fuerza la combinación estricta de video MP4 y audio M4A.' },
      { cmd: '-f "bv[height<=1080]+ba"', desc: 'Limita la resolución máxima de video a 1080p.' },
      { cmd: '-f "bv[height<=720]+ba"', desc: 'Limita la resolución máxima de video a 720p.' },
      { cmd: '-f "bv[height<=480]+ba"', desc: 'Limita la resolución máxima de video a 480p.' },
      { cmd: '-f "bv[fps<=60]+ba"', desc: 'Selecciona video con un máximo de 60 cuadros por segundo.' },
      { cmd: '-f "bv[vcodec^=avc1]+ba"', desc: 'Descarga video codificado específicamente en H.264 (AVC).' },
      { cmd: '-f "bv[vcodec^=vp9]+ba"', desc: 'Descarga video codificado específicamente en VP9.' },
      { cmd: '-f "bv[vcodec^=av01]+ba"', desc: 'Descarga video codificado en AV1.' },
      { cmd: '-f "b[filesize<50M]"', desc: 'Selecciona el mejor formato cuyo tamaño sea menor a 50 Megabytes.' },
      { cmd: '-f "bv+ba/b"', desc: 'Descarga mejor video + audio; si falla, descarga el mejor archivo combinado.' },
      { cmd: '-F', desc: 'Muestra la lista con todos los ID de formatos y resoluciones disponibles.' }
    ]
  },
  {
    category: 'Extracción y conversión de audio',
    items: [
      { cmd: '-x', desc: 'Convierte la pista de video descargada a solo audio (--extract-audio).' },
      { cmd: '--audio-format mp3', desc: 'Convierte el audio extraído al formato MP3.' },
      { cmd: '--audio-format m4a', desc: 'Convierte el audio extraído al formato M4A.' },
      { cmd: '--audio-format wav', desc: 'Convierte el audio extraído a WAV sin compresión.' },
      { cmd: '--audio-format flac', desc: 'Convierte el audio extraído al formato FLAC (sin pérdida).' },
      { cmd: '--audio-format opus', desc: 'Convierte el audio extraído a formato Opus.' },
      { cmd: '--audio-format aac', desc: 'Convierte el audio extraído a formato AAC.' },
      { cmd: '--audio-quality 0', desc: 'Establece la mejor calidad de conversión de audio (VBR 0 = ~250 kbps).' },
      { cmd: '--audio-quality 5', desc: 'Establece una calidad media de conversión de audio.' },
      { cmd: '--audio-quality 320k', desc: 'Establece un bitrate fijo de audio a 320 kbps (si el códec lo soporta).' }
    ]
  },
  {
    category: 'Modificación de contenedor y recorte',
    items: [
      { cmd: '--recode-video mp4', desc: 'Reencopila/reconvierte el video descargado a formato MP4.' },
      { cmd: '--recode-video mkv', desc: 'Reencopila/reconvierte el video descargado a formato MKV.' },
      { cmd: '--merge-output-format mp4', desc: 'Si une video y audio separados, fuerza que el archivo final sea MP4.' },
      { cmd: '--merge-output-format mkv', desc: 'Si une video y audio separados, fuerza que el archivo final sea MKV.' },
      { cmd: '--download-sections "*1:00-2:30"', desc: 'Descarga únicamente el fragmento de video entre el minuto 1:00 y 2:30.' },
      { cmd: '--download-sections "*00:00-05:00"', desc: 'Descarga solo los primeros 5 minutos del video.' },
      { cmd: '--download-sections "*10:00-inf"', desc: 'Descarga desde el minuto 10:00 hasta el final del video.' },
      { cmd: '--postprocessor-args "-ss 00:01:00"', desc: 'Pasa argumentos directos a FFmpeg para cortar el inicio.' },
      { cmd: '--keep-video', desc: 'Mantiene el archivo de video original tras extraer el audio.' }
    ]
  },
  {
    category: 'Nombres y rutas de archivos de salida',
    items: [
      { cmd: '-o "%(title)s.%(ext)s"', desc: 'Guarda el archivo usando únicamente el título del video y la extensión.' },
      { cmd: '-o "%(uploader)s - %(title)s.%(ext)s"', desc: 'Agrega el nombre del canal o creador antes del título.' },
      { cmd: '-o "%(upload_date)s_%(title)s.%(ext)s"', desc: 'Antepone la fecha de subida (YYYYMMDD) al nombre del archivo.' },
      { cmd: '-o "%(id)s.%(ext)s"', desc: 'Guarda el archivo usando únicamente el ID único del video.' },
      { cmd: '-o "%(playlist_index)s - %(title)s.%(ext)s"', desc: 'En listas de reproducción, antepone el número de posición del video.' },
      { cmd: '-P "C:/Videos"', desc: 'Define el directorio o carpeta donde se guardarán las descargas (--paths).' },
      { cmd: '-P "temp:C:/Temp"', desc: 'Define una carpeta temporal para descargas en curso antes de moverlas.' },
      { cmd: '--restrict-filenames', desc: 'Elimina espacios y caracteres especiales de los nombres guardados.' },
      { cmd: '--windows-filenames', desc: 'Adapta los nombres para evitar caracteres no válidos en Windows.' },
      { cmd: '--trim-filenames 50', desc: 'Limita la longitud máxima del nombre del archivo a 50 caracteres.' }
    ]
  },
  {
    category: 'Subtítulos y metadatos',
    items: [
      { cmd: '--write-subs', desc: 'Descarga los archivos de subtítulos oficiales del video.' },
      { cmd: '--write-auto-subs', desc: 'Descarga los subtítulos generados automáticamente.' },
      { cmd: '--sub-langs "es,en"', desc: 'Especifica qué idiomas de subtítulos descargar (ej. español e inglés).' },
      { cmd: '--sub-langs "all"', desc: 'Descarga absolutamente todos los idiomas de subtítulos disponibles.' },
      { cmd: '--embed-subs', desc: 'Incrusta (integra) los subtítulos dentro del propio archivo de video.' },
      { cmd: '--convert-subs srt', desc: 'Convierte el formato de los subtítulos descargados a SRT.' },
      { cmd: '--convert-subs vtt', desc: 'Convierte los subtítulos descargados al formato VTT.' },
      { cmd: '--embed-thumbnail', desc: 'Incrusta la imagen de portada (miniatura) dentro del archivo de audio/video.' },
      { cmd: '--write-thumbnail', desc: 'Descarga la imagen de la miniatura como archivo separado.' },
      { cmd: '--convert-thumbnails jpg', desc: 'Convierte la miniatura descargada a formato JPG.' },
      { cmd: '--embed-metadata', desc: 'Incrusta metadatos completos (título, artista, año, descripción) en el archivo.' },
      { cmd: '--embed-chapters', desc: 'Incrusta las marcas de capítulo del video en el archivo descargado.' },
      { cmd: '--split-chapters', desc: 'Descarga y divide el video en archivos individuales según sus capítulos.' },
      { cmd: '--parse-metadata ...', desc: 'Permite reorganizar los metadatos leídos (ej. extrae artista del título).' }
    ]
  },
  {
    category: 'Gestión de playlists y canales',
    items: [
      { cmd: '--no-playlist', desc: 'Descarga únicamente el video individual si la URL pertenece a una playlist.' },
      { cmd: '--yes-playlist', desc: 'Fuerza la descarga de la lista de reproducción completa desde la URL.' },
      { cmd: '--playlist-items 1,3,5', desc: 'Descarga exclusivamente los videos en las posiciones 1, 3 y 5 de la lista.' },
      { cmd: '--playlist-start 5', desc: 'Empieza a descargar la playlist a partir del elemento número 5.' },
      { cmd: '--playlist-end 10', desc: 'Detiene la descarga de la playlist en el elemento número 10.' },
      { cmd: '--playlist-reverse', desc: 'Descarga la lista de reproducción en orden inverso.' },
      { cmd: '--playlist-random', desc: 'Descarga los videos de la playlist en orden aleatorio.' },
      { cmd: '--max-downloads 5', desc: 'Cancela la ejecución tras descargar exitosamente 5 archivos.' },
      { cmd: '--break-on-existing', desc: 'Interrumpe la descarga si detecta que un archivo ya existe localmente.' },
      { cmd: '--download-archive historial.txt', desc: 'Registra videos descargados en un archivo y omite los duplicados a futuro.' }
    ]
  },
  {
    category: 'Filtros de fechas y métricas',
    items: [
      { cmd: '--date 20240101', desc: 'Descarga videos subidos únicamente en una fecha específica (AAAAMMDD).' },
      { cmd: '--datebefore 20231231', desc: 'Descarga solo videos publicados antes de una fecha dada.' },
      { cmd: '--dateafter 20240101', desc: 'Descarga solo videos publicados después de una fecha dada.' },
      { cmd: '--match-filter "views > 10000"', desc: 'Descarga videos que tengan más de 10,000 reproducciones.' },
      { cmd: '--match-filter "like_count > 500"', desc: 'Descarga únicamente videos con más de 500 "Me gusta".' },
      { cmd: '--match-filter "duration < 600"', desc: 'Descarga solo videos con una duración menor a 10 minutos (600 s).' },
      { cmd: '--match-filter "!is_live"', desc: 'Omite de la descarga transmisiones en vivo o directo.' },
      { cmd: '--reject-title "shorts"', desc: 'Omite videos que contengan la palabra "shorts" en su título.' }
    ]
  },
  {
    category: 'Red, rendimiento y descarga',
    items: [
      { cmd: '-r 5M', desc: 'Limita la velocidad máxima de descarga, ej. 5 Megabytes por segundo (--limit-rate).' },
      { cmd: '--concurrent-fragments 4', desc: 'Descarga fragmentos de un mismo video de forma simultánea (acelera la descarga).' },
      { cmd: '-N 4', desc: 'Utiliza múltiples hilos de conexión simultáneos.' },
      { cmd: '--retries 10', desc: 'Establece el número de reintentos en caso de errores de conexión.' },
      { cmd: '--fragment-retries 10', desc: 'Ajusta los reintentos para fragmentos individuales fallidos.' },
      { cmd: '--proxy "http://127.0.0.1:8080"', desc: 'Realiza la conexión a través de un servidor Proxy especificado.' },
      { cmd: '--source-address IP', desc: 'Fuerza la conexión a salir a través de una dirección IP de red específica.' },
      { cmd: '--force-ipv4', desc: 'Enruta todas las conexiones a través del protocolo IPv4.' },
      { cmd: '--force-ipv6', desc: 'Enruta todas las conexiones a través del protocolo IPv6.' },
      { cmd: '--downloader aria2c', desc: 'Utiliza un gestor externo (como aria2c) para procesar las descargas.' }
    ]
  },
  {
    category: 'Autenticación y cookies',
    items: [
      { cmd: '--cookies cookies.txt', desc: 'Carga un archivo de cookies local para acceder a contenido privado o con restricción.' },
      { cmd: '--cookies-from-browser chrome', desc: 'Extrae automáticamente las cookies activas de Google Chrome.' },
      { cmd: '--cookies-from-browser firefox', desc: 'Extrae automáticamente las cookies activas de Mozilla Firefox.' },
      { cmd: '--cookies-from-browser edge', desc: 'Extrae automáticamente las cookies de Microsoft Edge.' },
      { cmd: '-u usuario -p contraseña', desc: 'Envía credenciales de acceso a plataformas que lo requieran.' },
      { cmd: '-n', desc: 'Usa las credenciales guardadas en el archivo .netrc del sistema (--netrc).' },
      { cmd: '--2fa CODE', desc: 'Pasa el código de verificación en dos pasos (2FA) durante el inicio de sesión.' }
    ]
  },
  {
    category: 'Simulación, información y consola',
    items: [
      { cmd: '-s', desc: 'Simula la ejecución sin descargar ningún archivo a disco (--simulate).' },
      { cmd: '-g', desc: 'Muestra las URL directas de transmisión de los flujos de audio/video (--get-url).' },
      { cmd: '--print title', desc: 'Imprime únicamente el título del video en la consola.' },
      { cmd: '-j', desc: 'Muestra toda la información del video estructurada en formato JSON (--dump-json).' },
      { cmd: '-J', desc: 'Genera una salida JSON completa de una playlist en un solo bloque (--dump-single-json).' },
      { cmd: '--write-info-json', desc: 'Guarda los metadatos completos en un archivo .info.json local.' },
      { cmd: '--write-description', desc: 'Guarda la descripción textual del video en un archivo .description.' },
      { cmd: '--write-comments', desc: 'Extrae los comentarios del video y los guarda en el JSON de información.' },
      { cmd: '-q', desc: 'Activa el modo silencioso; no muestra ningún mensaje en consola (--quiet).' },
      { cmd: '--no-warnings', desc: 'Oculta las advertencias no críticas generadas durante la ejecución.' },
      { cmd: '-v', desc: 'Muestra información detallada de depuración, útil para diagnosticar fallos (--verbose).' },
      { cmd: '--console-title', desc: 'Muestra el progreso de la descarga en la barra de título de la terminal.' },
      { cmd: '--progress', desc: 'Muestra la barra de progreso de la descarga (activado por defecto).' }
    ]
  },
  {
    category: 'Mantenimiento y automatización',
    items: [
      { cmd: '-U', desc: 'Actualiza yt-dlp a la última versión disponible (--update).' },
      { cmd: '-a lista.txt', desc: 'Descarga por lotes todas las URL enumeradas dentro de un archivo de texto.' },
      { cmd: '--batch-file lista.txt', desc: 'Equivalente explícito a la opción -a para archivos por lotes.' },
      { cmd: '--ignore-errors', desc: 'Ignora videos caídos o con fallos en una playlist y continúa con el siguiente.' },
      { cmd: '--config-location ruta', desc: 'Indica la ubicación de un archivo personalizado de configuración.' },
      { cmd: '--no-config', desc: 'Desactiva la carga del archivo de configuración global predeterminado.' },
      { cmd: '--version', desc: 'Muestra el número de versión instalado de yt-dlp.' },
      { cmd: '--help', desc: 'Despliega el manual de ayuda completo de la herramienta en terminal.' }
    ]
  }
];

window.YTDLP_COMMANDS_EN = [
  {
    category: 'Format selection (video and audio)',
    items: [
      { cmd: '-f best', desc: 'Downloads the best available format in a single file (video + audio).' },
      { cmd: '-f bestvideo', desc: 'Downloads only the best available video track.' },
      { cmd: '-f bestaudio', desc: 'Downloads only the best available audio track.' },
      { cmd: '-f bestvideo+bestaudio', desc: 'Downloads and merges the best video track with the best audio track.' },
      { cmd: '-f worst', desc: 'Downloads the lowest quality format available.' },
      { cmd: '-f worstvideo', desc: 'Downloads the lowest available video quality.' },
      { cmd: '-f worstaudio', desc: 'Downloads the lowest available audio quality.' },
      { cmd: '-f mp4', desc: 'Downloads the best available format that uses an MP4 container.' },
      { cmd: '-f "ba[ext=m4a]"', desc: 'Downloads only the best audio in M4A format.' },
      { cmd: '-f "bv[ext=mp4]+ba[ext=m4a]"', desc: 'Forces a strict combination of MP4 video and M4A audio.' },
      { cmd: '-f "bv[height<=1080]+ba"', desc: 'Limits the maximum video resolution to 1080p.' },
      { cmd: '-f "bv[height<=720]+ba"', desc: 'Limits the maximum video resolution to 720p.' },
      { cmd: '-f "bv[height<=480]+ba"', desc: 'Limits the maximum video resolution to 480p.' },
      { cmd: '-f "bv[fps<=60]+ba"', desc: 'Selects video with a maximum of 60 frames per second.' },
      { cmd: '-f "bv[vcodec^=avc1]+ba"', desc: 'Downloads video encoded specifically in H.264 (AVC).' },
      { cmd: '-f "bv[vcodec^=vp9]+ba"', desc: 'Downloads video encoded specifically in VP9.' },
      { cmd: '-f "bv[vcodec^=av01]+ba"', desc: 'Downloads video encoded in AV1.' },
      { cmd: '-f "b[filesize<50M]"', desc: 'Selects the best format whose size is smaller than 50 Megabytes.' },
      { cmd: '-f "bv+ba/b"', desc: 'Downloads best video + audio; falls back to the best combined file if that fails.' },
      { cmd: '-F', desc: 'Lists all available format IDs and resolutions.' }
    ]
  },
  {
    category: 'Audio extraction and conversion',
    items: [
      { cmd: '-x', desc: 'Converts the downloaded video track to audio only (--extract-audio).' },
      { cmd: '--audio-format mp3', desc: 'Converts the extracted audio to MP3 format.' },
      { cmd: '--audio-format m4a', desc: 'Converts the extracted audio to M4A format.' },
      { cmd: '--audio-format wav', desc: 'Converts the extracted audio to uncompressed WAV.' },
      { cmd: '--audio-format flac', desc: 'Converts the extracted audio to FLAC format (lossless).' },
      { cmd: '--audio-format opus', desc: 'Converts the extracted audio to Opus format.' },
      { cmd: '--audio-format aac', desc: 'Converts the extracted audio to AAC format.' },
      { cmd: '--audio-quality 0', desc: 'Sets the best audio conversion quality (VBR 0 = ~250 kbps).' },
      { cmd: '--audio-quality 5', desc: 'Sets a medium audio conversion quality.' },
      { cmd: '--audio-quality 320k', desc: 'Sets a fixed audio bitrate of 320 kbps (if the codec supports it).' }
    ]
  },
  {
    category: 'Container and trimming options',
    items: [
      { cmd: '--recode-video mp4', desc: 'Re-encodes/converts the downloaded video to MP4 format.' },
      { cmd: '--recode-video mkv', desc: 'Re-encodes/converts the downloaded video to MKV format.' },
      { cmd: '--merge-output-format mp4', desc: 'When merging separate video and audio, forces the final file to be MP4.' },
      { cmd: '--merge-output-format mkv', desc: 'When merging separate video and audio, forces the final file to be MKV.' },
      { cmd: '--download-sections "*1:00-2:30"', desc: 'Downloads only the video segment between minute 1:00 and 2:30.' },
      { cmd: '--download-sections "*00:00-05:00"', desc: 'Downloads only the first 5 minutes of the video.' },
      { cmd: '--download-sections "*10:00-inf"', desc: 'Downloads from minute 10:00 to the end of the video.' },
      { cmd: '--postprocessor-args "-ss 00:01:00"', desc: 'Passes direct arguments to FFmpeg to trim the beginning.' },
      { cmd: '--keep-video', desc: 'Keeps the original video file after extracting the audio.' }
    ]
  },
  {
    category: 'Output file names and paths',
    items: [
      { cmd: '-o "%(title)s.%(ext)s"', desc: 'Saves the file using only the video title and the extension.' },
      { cmd: '-o "%(uploader)s - %(title)s.%(ext)s"', desc: 'Adds the channel or creator name before the title.' },
      { cmd: '-o "%(upload_date)s_%(title)s.%(ext)s"', desc: 'Prepends the upload date (YYYYMMDD) to the file name.' },
      { cmd: '-o "%(id)s.%(ext)s"', desc: "Saves the file using only the video's unique ID." },
      { cmd: '-o "%(playlist_index)s - %(title)s.%(ext)s"', desc: "In playlists, prepends the video's position number." },
      { cmd: '-P "C:/Videos"', desc: 'Sets the folder where downloads will be saved (--paths).' },
      { cmd: '-P "temp:C:/Temp"', desc: 'Sets a temporary folder for in-progress downloads before they are moved.' },
      { cmd: '--restrict-filenames', desc: 'Removes spaces and special characters from saved file names.' },
      { cmd: '--windows-filenames', desc: 'Adapts file names to avoid characters that are invalid on Windows.' },
      { cmd: '--trim-filenames 50', desc: 'Limits the maximum file name length to 50 characters.' }
    ]
  },
  {
    category: 'Subtitles and metadata',
    items: [
      { cmd: '--write-subs', desc: "Downloads the video's official subtitle files." },
      { cmd: '--write-auto-subs', desc: 'Downloads the automatically generated subtitles.' },
      { cmd: '--sub-langs "es,en"', desc: 'Specifies which subtitle languages to download (e.g. Spanish and English).' },
      { cmd: '--sub-langs "all"', desc: 'Downloads absolutely all available subtitle languages.' },
      { cmd: '--embed-subs', desc: 'Embeds the subtitles directly inside the video file.' },
      { cmd: '--convert-subs srt', desc: 'Converts the downloaded subtitles to SRT format.' },
      { cmd: '--convert-subs vtt', desc: 'Converts the downloaded subtitles to VTT format.' },
      { cmd: '--embed-thumbnail', desc: 'Embeds the thumbnail image inside the audio/video file.' },
      { cmd: '--write-thumbnail', desc: 'Downloads the thumbnail image as a separate file.' },
      { cmd: '--convert-thumbnails jpg', desc: 'Converts the downloaded thumbnail to JPG format.' },
      { cmd: '--embed-metadata', desc: 'Embeds full metadata (title, artist, year, description) into the file.' },
      { cmd: '--embed-chapters', desc: "Embeds the video's chapter markers into the downloaded file." },
      { cmd: '--split-chapters', desc: 'Downloads and splits the video into individual files by chapter.' },
      { cmd: '--parse-metadata ...', desc: 'Lets you rearrange the metadata that was read (e.g. extract artist from title).' }
    ]
  },
  {
    category: 'Playlist and channel management',
    items: [
      { cmd: '--no-playlist', desc: 'Downloads only the single video if the URL belongs to a playlist.' },
      { cmd: '--yes-playlist', desc: 'Forces downloading the full playlist from the URL.' },
      { cmd: '--playlist-items 1,3,5', desc: 'Downloads only the videos at positions 1, 3 and 5 in the list.' },
      { cmd: '--playlist-start 5', desc: 'Starts downloading the playlist from item number 5.' },
      { cmd: '--playlist-end 10', desc: 'Stops downloading the playlist at item number 10.' },
      { cmd: '--playlist-reverse', desc: 'Downloads the playlist in reverse order.' },
      { cmd: '--playlist-random', desc: "Downloads the playlist's videos in random order." },
      { cmd: '--max-downloads 5', desc: 'Stops the run after successfully downloading 5 files.' },
      { cmd: '--break-on-existing', desc: 'Stops the download when it detects a file that already exists locally.' },
      { cmd: '--download-archive historial.txt', desc: 'Logs downloaded videos to a file and skips duplicates in future runs.' }
    ]
  },
  {
    category: 'Date and metric filters',
    items: [
      { cmd: '--date 20240101', desc: 'Downloads videos uploaded only on a specific date (YYYYMMDD).' },
      { cmd: '--datebefore 20231231', desc: 'Downloads only videos published before a given date.' },
      { cmd: '--dateafter 20240101', desc: 'Downloads only videos published after a given date.' },
      { cmd: '--match-filter "views > 10000"', desc: 'Downloads videos with more than 10,000 views.' },
      { cmd: '--match-filter "like_count > 500"', desc: 'Downloads only videos with more than 500 likes.' },
      { cmd: '--match-filter "duration < 600"', desc: 'Downloads only videos shorter than 10 minutes (600 s).' },
      { cmd: '--match-filter "!is_live"', desc: 'Skips live broadcasts from the download.' },
      { cmd: '--reject-title "shorts"', desc: 'Skips videos whose title contains the word "shorts".' }
    ]
  },
  {
    category: 'Network, performance and download',
    items: [
      { cmd: '-r 5M', desc: 'Limits the maximum download speed, e.g. 5 Megabytes per second (--limit-rate).' },
      { cmd: '--concurrent-fragments 4', desc: 'Downloads fragments of the same video simultaneously (speeds up the download).' },
      { cmd: '-N 4', desc: 'Uses multiple simultaneous connection threads.' },
      { cmd: '--retries 10', desc: 'Sets the number of retries on connection errors.' },
      { cmd: '--fragment-retries 10', desc: 'Adjusts the retries for individual failed fragments.' },
      { cmd: '--proxy "http://127.0.0.1:8080"', desc: 'Connects through a specified proxy server.' },
      { cmd: '--source-address IP', desc: 'Forces connections to go out through a specific network IP address.' },
      { cmd: '--force-ipv4', desc: 'Routes all connections over the IPv4 protocol.' },
      { cmd: '--force-ipv6', desc: 'Routes all connections over the IPv6 protocol.' },
      { cmd: '--downloader aria2c', desc: 'Uses an external manager (such as aria2c) to handle downloads.' }
    ]
  },
  {
    category: 'Authentication and cookies',
    items: [
      { cmd: '--cookies cookies.txt', desc: 'Loads a local cookies file to access private or restricted content.' },
      { cmd: '--cookies-from-browser chrome', desc: 'Automatically extracts active cookies from Google Chrome.' },
      { cmd: '--cookies-from-browser firefox', desc: 'Automatically extracts active cookies from Mozilla Firefox.' },
      { cmd: '--cookies-from-browser edge', desc: 'Automatically extracts active cookies from Microsoft Edge.' },
      { cmd: '-u user -p password', desc: 'Sends login credentials to platforms that require them.' },
      { cmd: '-n', desc: "Uses the credentials saved in the system's .netrc file (--netrc)." },
      { cmd: '--2fa CODE', desc: 'Passes the two-factor authentication (2FA) code during login.' }
    ]
  },
  {
    category: 'Simulation, info and console output',
    items: [
      { cmd: '-s', desc: 'Simulates the run without downloading any file to disk (--simulate).' },
      { cmd: '-g', desc: 'Shows the direct streaming URLs for the audio/video streams (--get-url).' },
      { cmd: '--print title', desc: 'Prints only the video title to the console.' },
      { cmd: '-j', desc: "Shows all the video's information structured as JSON (--dump-json)." },
      { cmd: '-J', desc: 'Generates a full JSON output for a playlist in a single block (--dump-single-json).' },
      { cmd: '--write-info-json', desc: 'Saves the full metadata to a local .info.json file.' },
      { cmd: '--write-description', desc: "Saves the video's text description to a .description file." },
      { cmd: '--write-comments', desc: "Extracts the video's comments and saves them in the info JSON." },
      { cmd: '-q', desc: 'Enables quiet mode; shows no console messages (--quiet).' },
      { cmd: '--no-warnings', desc: 'Hides non-critical warnings generated during the run.' },
      { cmd: '-v', desc: 'Shows detailed debug information, useful for diagnosing failures (--verbose).' },
      { cmd: '--console-title', desc: "Shows the download progress in the terminal's title bar." },
      { cmd: '--progress', desc: 'Shows the download progress bar (enabled by default).' }
    ]
  },
  {
    category: 'Maintenance and automation',
    items: [
      { cmd: '-U', desc: 'Updates yt-dlp to the latest available version (--update).' },
      { cmd: '-a list.txt', desc: 'Batch-downloads all the URLs listed inside a text file.' },
      { cmd: '--batch-file list.txt', desc: 'Explicit equivalent of the -a option for batch files.' },
      { cmd: '--ignore-errors', desc: 'Ignores failed or broken videos in a playlist and continues with the next one.' },
      { cmd: '--config-location path', desc: 'Specifies the location of a custom configuration file.' },
      { cmd: '--no-config', desc: 'Disables loading the default global configuration file.' },
      { cmd: '--version', desc: 'Shows the installed version number of yt-dlp.' },
      { cmd: '--help', desc: "Displays the tool's full help manual in the terminal." }
    ]
  }
];

// Compatibilidad hacia atrás: si algo referencia window.YTDLP_COMMANDS
// directamente, se apunta a la lista en español por defecto.
window.YTDLP_COMMANDS = window.YTDLP_COMMANDS_ES;
