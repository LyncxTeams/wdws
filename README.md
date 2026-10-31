# WDWS + Fake GC + Fake TikTok Chat API

Satu project Vercel dengan endpoint:

- `/api/wq`
- `/api/fakegc`
- `/api/faketiktok`

## Fake TikTok Chat

Proxy ke FazzCode `POST https://api.fazzcode.eu.cc/fakettchat`.

Image dapat diberikan sebagai URL dan akan otomatis di-download oleh Vercel lalu dikirim sebagai multipart `image`.

### GET

```text
/api/faketiktok?username=Dika&chat=Apasih&image=https://example.com/foto.jpg
```

### POST JSON

```json
{
  "username": "Dika",
  "chat": "Apasih",
  "image": "https://example.com/foto.jpg"
}
```

Jika FazzCode mengembalikan PNG/JPG/WebP, endpoint ini meneruskan hasilnya langsung sebagai gambar.

API key membaca `FAZZCODE_API_KEY`. Project juga memiliki fallback test key agar tidak langsung gagal ketika Environment Variable belum dibuat. Untuk production, tetap disarankan mengisi `FAZZCODE_API_KEY` di Vercel dan menghapus fallback key dari source.

## Fake GC

```text
/api/fakegc?name=RIN%20MD%20OFFICIAL&members=2%20anggota&image=https://example.com/avatar.jpg
```

## WDWS

```text
/api/wq?text=halo%20dunia
```

## CylicDev AI

Proxy ke Gemini, mengembalikan balasan sebagai JSON `{ status, result }`.

### GET

```text
/api/cylicdev?text=Kamu%20siapa&system=Kamu%20adalah%20asisten%20ramah&apikey=API_KEY_KAMU&id=user123
```

### POST JSON

```json
{
  "text": "Kamu siapa",
  "system": "Kamu adalah asisten ramah",
  "image": "https://example.com/foto.jpg",
  "apikey": "API_KEY_KAMU",
  "id": "user123"
}
```

- `text` — opsional jika `image` diisi, tapi salah satu wajib ada.
- `image` — opsional, URL http/https atau data URI base64 (`data:image/...;base64,...`), maks 8MB. AI akan menganalisa gambar ini.
- `system` — opsional, default-nya "Kamu adalah CylicDev AI. Developer: FuadXyro."
- `apikey` — wajib. Gemini API key kamu. Kalau kosong, request ditolak dengan pesan "apikey belum diisi."
- `id` — opsional. Kalau diisi (misal nomor WA atau user id), 10 percakapan terakhir dengan id yang sama otomatis dibaca ulang jadi konteks, jadi AI "inget" obrolan sebelumnya. Beda `id` = beda sesi/tidak nyambung.

⚠️ Histori sesi (`id`) disimpan **in-memory** di server, bukan di database. Artinya bisa hilang kapan saja kalau Vercel me-restart/cold-start function-nya, dan tidak dijamin konsisten kalau trafik dipecah ke banyak instance sekaligus. Cocok buat obrolan santai/testing; kalau butuh histori yang beneran permanen & reliable (misal buat bot produksi), bilang aja — bisa diganti pakai Vercel KV atau Upstash Redis.

## AntiNSFW

Deteksi konten NSFW pada gambar pakai Gemini (multimodal) — Gemini menganalisa gambar lalu balas terstruktur, bukan pakai Cloud Vision.

### GET

```text
/api/antinsfw?image=https://example.com/foto.jpg&apikey=API_KEY_KAMU
```

### POST JSON

```json
{
  "image": "https://example.com/foto.jpg",
  "apikey": "API_KEY_KAMU"
}
```

- `image` — wajib, URL http/https atau data URI base64 (maks 8MB).
- `apikey` — wajib. Gemini API key kamu. Kalau kosong, request ditolak dengan pesan "apikey belum diisi."

Respons:

```json
{
  "status": true,
  "isNSFW": false,
  "category": "safe",
  "reason": "Gambar berupa pemandangan, tidak ada konten sensitif"
}
```

`category` bisa `safe`, `adult`, `racy`, `violence`, atau `other`.

## Sticker.ly API

Satu format URL untuk pencarian dan mengambil pack. Nilai diletakkan langsung setelah `?=`:

Cari berdasarkan kata kunci:

```text
/api/stickerly?=naruto
```

Ambil pack dari tautan Sticker.ly (URL di-encode agar aman):

```text
/api/stickerly?=https%3A%2F%2Fsticker.ly%2Fs%2FJ3ELW0
```

Endpoint juga tetap mendukung parameter `q`, `keyword`, `url`, dan `link` untuk kompatibilitas. Respons berbentuk JSON berisi metadata pack dan URL tiap stiker.


## Text-to-Speech Anime Jepang (TTS)

Endpoint ini meneruskan permintaan ke server KokoroTTS yang dijalankan sendiri. Output berupa MP3. Default voice `jf_alpha` (perempuan Jepang); tersedia juga `jf_gongitsune`, `jf_nezumi`, dan `jf_tebukuro`. Voice Jepang cocok untuk teks bahasa Jepang; teks Indonesia dapat terdengar tidak natural.

### Menjalankan server KokoroTTS di VPS

Pasang Docker, lalu jalankan image CPU (GPU tidak wajib, tetapi CPU bisa lebih lambat):

```bash
docker run -d --name kokorotts --restart unless-stopped \
  -p 7860:7860 \
  -v kokorotts_data:/app/persistent \
  hangrylabs/kokorotts:latest
```

Jangan membuka port ini ke internet tanpa pembatasan akses. Tempatkan di belakang reverse proxy HTTPS/firewall. Simpan URL server dan token sebagai Environment Variables Vercel:

- `KOKORO_URL` — URL dasar server KokoroTTS, contoh `https://tts.domain-kamu.com` (tanpa slash terakhir).
- `KOKORO_API_KEY` — opsional. Isi hanya jika `KOKOROTTS_API_KEY` juga diaktifkan pada container. Tanpa keduanya, tidak perlu API key.

### GET

```text
/api/tts?text=こんにちは%20みんな
```

### GET dengan voice dan pengaturan

```text
/api/tts?text=こんにちは&voice=jf_alpha&speed=1.08&pitch=2&tempo=1.04&volume=1
```

### POST JSON

```json
{
  "text": "こんにちは、みんな！",
  "voice": "jf_alpha",
  "speed": 1.08,
  "pitch": 2,
  "tempo": 1.04,
  "volume": 1
}
```

- `text` — wajib, maksimal 500 karakter.
- `voice` — `jf_alpha`, `jf_gongitsune`, `jf_nezumi`, atau `jf_tebukuro`.
- `speed` — 0.5 sampai 2; default 1.08.
- `pitch` — -12 sampai 12 semitone; default 2.
- `tempo` — 0.5 sampai 2; default 1.04.
- `volume` — 0 sampai 2; default 1.
- Output — MP3 (`audio/mpeg`). Jika gagal, endpoint mengembalikan JSON `{ "status": false, "creator": "FuadXyro", "message": "..." }`.

### Pemakaian dari Node.js

```js
const response = await fetch(
  'https://wdws.vercel.app/api/tts?text=' + encodeURIComponent('こんにちは、みんな！')
)
if (!response.ok) throw new Error(await response.text())
const audio = Buffer.from(await response.arrayBuffer())

await conn.sendMessage(m.chat, {
  audio,
  mimetype: 'audio/mpeg',
  fileName: 'anime-voice.mp3'
}, { quoted: m })
```

Server KokoroTTS perlu berjalan terus di VPS. Vercel hanya menjadi endpoint relay; model tidak dijalankan di Vercel. Dokumentasi: https://github.com/hangry-labs/kokoroTTS

## VOICEVOX Japanese TTS

Endpoint khusus VOICEVOX Jepang. Route ini berdiri sendiri dan tidak mengubah endpoint Kokoro yang sudah ada di `/api/tts`.

### GET

```text
/api/tts/jpn?text=こんにちは
```

Opsional, pilih speaker: `&speaker=0`. Teks maksimal 300 karakter. Output berhasil berupa MP3 (`audio/mpeg`). Jika provider masih memproses audio, endpoint dapat mengembalikan HTTP 202 beserta `mp3Url`.

Contoh URL production:

```text
https://wdws.vercel.app/api/tts/jpn?text=こんにちは
```

Endpoint ini memakai provider publik `api.tts.quest`; ketersediaan dan kecepatan proses mengikuti layanan provider tersebut. Tidak memerlukan `KOKORO_URL` atau environment variable Kokoro.



## Instagram Downloader API

Mengambil media Instagram Reels, Post/Carousel, dan Story melalui beberapa provider fallback.

### GET

```text
/api/instagram?url=https%3A%2F%2Fwww.instagram.com%2Freel%2FXXXXXXXX%2F
```

Story:

```text
/api/instagram?url=https%3A%2F%2Fwww.instagram.com%2Fstories%2Fusername%2F
```

### POST JSON

```json
{
  "url": "https://www.instagram.com/p/XXXXXXXX/"
}
```

Respons berhasil berbentuk JSON dengan `status`, `platform`, `url`, dan `result.media`. Setiap item media berisi `type`, `url`, dan nomor urut. Endpoint mencoba Watext, Fastvidl, lalu IGExport untuk Reels/Post. Story menggunakan IGExport. Ketersediaan provider mengikuti perubahan layanan pihak ketiga.
