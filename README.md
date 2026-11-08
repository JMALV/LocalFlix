# LocalFlix

Servidor multimedia para tu casa: ves tus series y películas (`.mkv`, `.mp4`…) desde el celular, la tablet o la TV, con portadas,
"Continuar viendo" y salto automático al siguiente episodio. Corre en tu PC con Windows y solo necesita **Node.js** y
**ffmpeg**. No usa base de datos ni dependencias de npm.

- **Rápido:** si el dispositivo soporta el video original, lo manda tal cual. Si no, lo convierte con la placa de video.
- **iPhone y Safari** usan HLS. **Android y PC** usan MP4 progresivo.
- **Subtítulos** de texto y PGS (imagen), con elección de pista de audio.
- **TV:** Kodi o VLC leen los archivos directo, sin conversión.

---

## Instalación en una PC nueva

### 1. Descargar LocalFlix

Desde GitHub: botón verde **Code** → **Download ZIP** y descomprímelo donde quieras, por ejemplo `C:\LocalFlix`.

O con git:

```bash
git clone https://github.com/JMALV/LocalFlix.git
```

### 2. Instalar Node.js y ffmpeg

Doble clic en **`Instalar.bat`**. Instala con `winget` lo que falte:

- Node.js LTS (hace falta la versión 20.11 o más nueva).
- ffmpeg (la versión 6.1 o más nueva).

Al final pregunta si quieres que LocalFlix arranque solo con Windows.

Si prefieres hacerlo a mano:

```bash
winget install -e --id OpenJS.NodeJS.LTS
```

```bash
winget install -e --id Gyan.FFmpeg
```

### 3. Iniciar, crear la contraseña y elegir tus carpetas

Doble clic en **`Iniciar LocalFlix.bat`**. Se abre una consola, que tiene que quedar abierta, y el navegador en
`http://localhost:8484`.

La primera vez:

1. **Crea una contraseña.** La vas a usar para entrar desde el celular, la tablet o la TV. En la PC donde corre
   LocalFlix no se pide. Mientras no la crees, los demás dispositivos no pueden entrar.
2. Aparece la pantalla **Bienvenido a LocalFlix**: toca **+ Agregar carpeta**.
3. Navega hasta la carpeta con tus videos (o escribe la ruta, por ejemplo `D:\Series`) y toca **Usar esta carpeta**.
4. Repite para agregar más carpetas y toca **Guardar**.

Para cambiar las carpetas o la contraseña después, usa el **ícono de carpeta** arriba a la derecha. Por seguridad, las
dos cosas solo se pueden cambiar desde la PC donde corre LocalFlix.

Windows pregunta si Node.js puede usar la red: marca **Redes privadas** y acepta. Sin eso, los celulares no se conectan.

### 4. Abrirlo en el celular

La consola muestra la dirección de la PC en tu red, por ejemplo `http://192.168.1.50:8484`. Ábrela en el celular
conectado **al mismo Wi-Fi** y escribe la contraseña. La sesión queda abierta un año, o hasta que cambies la contraseña.

- **Android (Chrome):** menú ⋮ → **Agregar a la pantalla principal**.
- **iPhone (Safari):** botón Compartir → **Agregar a inicio**.

Así queda como una app, en pantalla completa.

---

## Arranque automático

| Para | Archivo |
|---|---|
| Iniciar sin ventana al entrar a Windows | `Activar arranque automatico.bat` |
| Dejar de iniciarlo solo | `Desactivar arranque automatico.bat` |
| Iniciar ahora sin ventana | `LocalFlix (segundo plano).vbs` |
| Detenerlo | `Detener LocalFlix.bat` |

Sin ventana, el registro queda en `data\server.log`. Windows tiene que iniciar sesión en tu usuario para que arranque.

Si mueves la carpeta de LocalFlix a otro lugar, vuelve a ejecutar `Activar arranque automatico.bat`.

---

## En la TV (Android / Google TV)

Google TV no trae navegador. Lo mejor es un reproductor que lea el archivo directo, sin conversión:

- **Kodi** (recomendado): Videos → Archivos → Agregar videos → Explorar → *Agregar ubicación de red*:
  - protocolo **Servidor web (HTTP)**
  - dirección: la IP de tu PC
  - puerto `8484`
  - ruta `browse/`
  - usuario: cualquiera (por ejemplo `kodi`); contraseña: la de LocalFlix

  Después asígnale el tipo de contenido "Series" y Kodi descarga pósters y sinopsis.
- **VLC:** Explorar → Stream → el enlace que aparece en LocalFlix, en la PC: ícono de carpeta → **VLC y Kodi**. Se ve así:
  `http://IP-DE-TU-PC:8484/api/m3u/all.m3u?k=CLAVE`. Ese enlace es toda la biblioteca; para una sola serie, usa el botón
  "Lista M3U" de esa serie. La clave cambia cuando cambias la contraseña.
- **Desde el celular:** en el reproductor, ⚙ → *Abrir en VLC / MX Player*.

---

## Cómo evita trabarse

| Situación | Qué hace | Costo |
|---|---|---|
| El dispositivo soporta el códec (HEVC 10-bit en la mayoría de celulares modernos) | Manda el video tal cual y solo convierte el audio a AAC estéreo | Casi nada |
| No lo soporta, o elegiste subtítulos | Convierte a H.264 con la placa de video (NVIDIA, Intel o AMD) | Placa de video |
| No hay placa de video compatible | Convierte con el procesador (`libx264`) | CPU alta |
| Subtítulos PGS (imagen) | Los incrusta en el video al convertir | Placa de video |

- Si el modo original falla o se ve negro, cambia solo al modo convertido.
- Si el video se congela más de 15 s, reabre el stream en el mismo segundo.
- Cada reproductor usa un único ffmpeg: al adelantar, cambiar de pista o salir, el anterior se cierra.

---

## Pósters y sinopsis (opcional)

Sin configurar nada, se usan cuadros del propio video. Para pósters reales:

1. Consigue una API key gratis en [themoviedb.org](https://www.themoviedb.org/settings/api).
2. Ponla en `config.json` → `"tmdbApiKey"`.
3. Reinicia LocalFlix.

## Cómo nombrar los archivos

LocalFlix reconoce series por `S01E02` o `1x02`, en el nombre del archivo o de la carpeta:

```
Series\The Sopranos\Season 1\The.Sopranos.S01E01.1080p.mkv
Peliculas\Inception (2010)\Inception.2010.1080p.mkv
```

## config.json

Se crea solo al guardar las carpetas. Puedes editarlo a mano, con LocalFlix detenido:

| Clave | Para qué |
|---|---|
| `mediaDirs` | Carpetas con tus videos (también se eligen desde la web) |
| `port` | Puerto (8484) |
| `preferredSubLang` | Idioma de subtítulos que se activa si el audio está en otro idioma (`spa`) |
| `preferredAudioLang` | Idioma de audio preferido (vacío = el predeterminado del archivo) |
| `encoder` | `auto`, `h264_nvenc`, `h264_qsv`, `h264_amf` o `libx264` |
| `tmdbApiKey` | Opcional, para pósters |
| `rescanMinutes` | Cada cuánto buscar archivos nuevos (30) |
| `ffmpeg`, `ffprobe` | Ruta a mano, si no los encuentra solo |
| `maxStreams` | Reproducciones simultáneas como máximo (4) |
| `remoteSettings` | `true` permite cambiar las carpetas desde otros dispositivos (por defecto, solo desde la PC) |
| `allowedHosts` | Nombres extra con los que entras a LocalFlix, por ejemplo `["pc-living"]` |

El progreso, las miniaturas y la caché se guardan en `data/`. Puedes borrar esa carpeta sin perder los videos, pero se
pierde el progreso.

## Seguridad

LocalFlix está pensado para la red de tu casa. **No abras el puerto 8484 en el router:** la conexión no está cifrada
(HTTP).

Protecciones incluidas:

- **Contraseña:** se crea la primera vez y se pide en todos los dispositivos menos la PC donde corre LocalFlix. Solo se
  cambia desde esa PC, y al cambiarla se cierra la sesión en todos los demás. Se guarda cifrada (scrypt) en
  `data/auth.json`. Tras 5 intentos fallidos, LocalFlix hace esperar cada vez más antes del próximo intento.

- **Solo tus videos:** el servidor entrega videos, subtítulos e imágenes de las carpetas elegidas, nunca otros archivos
  ni nada fuera de ellas.
- **Carpetas solo desde la PC:** las carpetas se eligen únicamente desde la PC donde corre LocalFlix. Desde el celular
  se ven, pero no se pueden cambiar (se puede habilitar con `remoteSettings`).
- **Páginas web externas bloqueadas:** una página maliciosa abierta en tu navegador no puede mandarle órdenes a
  LocalFlix ni leer tu biblioteca. El servidor rechaza pedidos que no vengan de su propia interfaz o que usen un nombre
  de dominio ajeno (protección contra *DNS rebinding*).
- **Límite de reproducciones:** como máximo 4 a la vez (`maxStreams`), para que nadie sature la PC.

Si entras con un nombre propio para la PC (por ejemplo `http://pc-living:8484`) y aparece "Host no permitido",
agrégalo a `allowedHosts`. Las IP, `localhost`, el nombre de la PC y los nombres `.local` ya funcionan.

## Problemas comunes

| Problema | Solución |
|---|---|
| El celular no abre la página | Misma red Wi-Fi. Permite Node.js en el Firewall de Windows (Redes privadas). |
| "El puerto 8484 ya está en uso" | LocalFlix ya está corriendo. Usa `Detener LocalFlix.bat` antes de iniciarlo de nuevo. |
| "No encontré ffmpeg" | Ejecuta `Instalar.bat` o `winget install Gyan.FFmpeg` y abre una consola nueva. |
| `node` no se reconoce | Node.js se acaba de instalar: cierra y vuelve a abrir la ventana (o reinicia la PC). |
| No aparece un video nuevo | Se busca cada 30 min. Para buscar ya, toca **Guardar** en la pantalla de carpetas. |
| Olvidé la contraseña | En la PC, ícono de carpeta → **Cambiar contraseña** (ahí no pide la actual). |
| "LocalFlix todavía no está configurado" en el celular | Falta crear la contraseña: abre `http://localhost:8484` en la PC. |
| VLC o Kodi dejaron de funcionar | Cambiaste la contraseña: actualiza la contraseña en Kodi y el enlace con la clave en VLC. |
