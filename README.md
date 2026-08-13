# WDWS Meme API

API sederhana untuk generate meme "qoutes Windows" (wdws), siap deploy ke Vercel.

## Struktur

```
wdws-api/
├── api/
│   └── wq.js        # endpoint utama
├── package.json
├── vercel.json
└── README.md
```

## Cara pakai (endpoint)

```
GET /api/wq?text=just friend kok manggil sayang dan cemburu
```

Response: gambar PNG langsung (`Content-Type: image/png`).

Bisa juga lewat POST dengan body JSON:

```
POST /api/wq
Content-Type: application/json

{ "text": "halo dunia" }
```

## Deploy ke Vercel

1. Push folder ini ke repo GitHub (atau GitLab/Bitbucket).
2. Buka https://vercel.com/new, import repo tersebut.
3. Vercel otomatis mendeteksi ini sebagai project Node.js — tidak perlu ubah setting build.
4. Klik **Deploy**.

Atau lewat CLI:

```bash
npm i -g vercel
cd wdws-api
vercel --prod
```

## Catatan teknis

- Cache font & background disimpan di `/tmp` (satu-satunya folder yang bisa ditulis di Vercel serverless). Cache ini bersifat sementara — akan hilang saat instance function di-recycle, lalu otomatis di-download ulang.
- `@napi-rs/canvas` dan `sharp` sudah pakai binary prebuilt untuk Linux x64, jadi tidak perlu setup tambahan di Vercel.
- Batas panjang teks di-set 300 karakter (bisa diubah di `api/wq.js`).
- Jika ingin memakai runtime Edge, JANGAN — canvas & sharp butuh Node.js runtime (native binding), bukan Edge runtime.

## Testing lokal

```bash
npm install
npx vercel dev
```

Lalu buka: `http://localhost:3000/api/wq?text=coba+dulu`
