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
