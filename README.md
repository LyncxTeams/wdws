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
