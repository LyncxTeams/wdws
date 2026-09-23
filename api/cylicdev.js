// CylicDev AI proxy — meneruskan teks (dan opsional gambar) ke Gemini lalu
// mengembalikan balasannya sebagai JSON.
// (tidak ada fallback ke Environment Variable — apikey wajib dikirim di request)
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1/interactions'
const MODEL = 'gemini-3.6-flash'
const DEFAULT_SYSTEM_INSTRUCTION = 'Kamu adalah CylicDev AI. Developer: FuadXyro.'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // 8MB, sebelum di-encode base64

async function getInput(req) {
  if (req.method === 'GET') return req.query || {}
  let body = req.body || {}
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch {}
  }
  return body
}

function extractText(data) {
  return (
    data.outputs?.find((x) => x.type === 'text')?.text ||
    data.steps?.flatMap((x) => x.content || []).find((x) => x.type === 'text')?.text ||
    null
  )
}

// Terima gambar sebagai URL http(s) atau data URI (data:image/...;base64,...)
// dan kembalikan { mimeType, data } (data = base64 tanpa prefix).
async function resolveImage(raw) {
  const value = String(raw || '').trim()
  if (!value) return null

  const dataMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (dataMatch) {
    const [, mimeType, base64] = dataMatch
    const approxBytes = (base64.length * 3) / 4
    if (approxBytes > MAX_IMAGE_BYTES) {
      throw new Error('Gambar terlalu besar (maks 8MB).')
    }
    return { mimeType, data: base64 }
  }

  if (/^https?:\/\//i.test(value)) {
    const r = await fetch(value)
    if (!r.ok) throw new Error(`Gagal mengambil gambar dari URL (${r.status})`)

    const mimeType = r.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
    if (!mimeType.startsWith('image/')) {
      throw new Error('URL yang diberikan bukan gambar.')
    }

    const contentLength = Number(r.headers.get('content-length') || 0)
    if (contentLength && contentLength > MAX_IMAGE_BYTES) {
      throw new Error('Gambar terlalu besar (maks 8MB).')
    }

    const buffer = Buffer.from(await r.arrayBuffer())
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error('Gambar terlalu besar (maks 8MB).')
    }

    return { mimeType, data: buffer.toString('base64') }
  }

  throw new Error("Parameter 'image' harus berupa URL http/https atau data URI base64.")
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ status: false, message: 'Method Not Allowed' })
  }

  try {
    const input = await getInput(req)
    const apiKey = String(input.apikey || input.api_key || '').trim()

    if (!apiKey) {
      return res.status(400).json({
        status: false,
        message: 'apikey belum diisi.',
        example: '/api/cylicdev?text=Kamu siapa&apikey=API_KEY_KAMU'
      })
    }

    const text = String(input.text || input.q || input.message || '').trim()
    const imageParam = input.image || input.img || input.photo || ''

    if (!text && !imageParam) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'text' atau 'image' wajib diisi.",
        example: '/api/cylicdev?text=Ini gambar apa?&image=https://example.com/foto.jpg'
      })
    }

    if (text.length > 2000) {
      return res.status(400).json({ status: false, message: 'Teks terlalu panjang (maks 2000 karakter).' })
    }

    const systemInstruction = String(input.system || input.system_instruction || '').trim() || DEFAULT_SYSTEM_INSTRUCTION

    if (systemInstruction.length > 2000) {
      return res.status(400).json({ status: false, message: "Parameter 'system' terlalu panjang (maks 2000 karakter)." })
    }

    let image = null
    if (imageParam) {
      try {
        image = await resolveImage(imageParam)
      } catch (imgErr) {
        return res.status(400).json({ status: false, message: imgErr.message })
      }
    }

    // Catatan: skema multimodal endpoint ini menyesuaikan kontrak upstream
    // (bukan REST resmi Google). Jika upstream mengharapkan nama field lain
    // untuk gambar, sesuaikan bagian "input" di bawah ini.
    const requestBody = {
      model: MODEL,
      system_instruction: systemInstruction,
      input: image
        ? [
            ...(text ? [{ type: 'text', text }] : []),
            { type: 'image', image: { mime_type: image.mimeType, data: image.data } }
          ]
        : text
    }

    const upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey
      },
      body: JSON.stringify(requestBody)
    })

    const data = await upstream.json()

    if (!upstream.ok) {
      throw new Error(data.error?.message || JSON.stringify(data))
    }

    const result = extractText(data)
    if (!result) {
      console.error('CYLICDEV unrecognized result shape:', JSON.stringify(data)?.slice(0, 2000))
      throw new Error('Gagal mengekstrak balasan dari upstream (format hasil tidak dikenali)')
    }

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ status: true, result })
  } catch (err) {
    console.error('CYLICDEV ERROR:', err)
    return res.status(500).json({ status: false, message: 'Gagal memproses permintaan', error: err.message })
  }
}
