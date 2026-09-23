// Deteksi konten NSFW pada gambar menggunakan Gemini (multimodal), bukan
// Cloud Vision. Gemini diminta menganalisa gambar lalu balas dalam format
// JSON ketat yang kemudian kita parse di sini.
const DEFAULT_API_KEY = 'AQ.Ab8RN6IQZJvZPTCP5rRYDWsuYUcxBu8sDZ35yvEj4ThN3J_d4A'
const API_KEY = process.env.GEMINI_API_KEY || DEFAULT_API_KEY
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1/interactions'
const MODEL = 'gemini-3.6-flash'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // 8MB

const SYSTEM_INSTRUCTION = [
  'Kamu adalah content moderator gambar.',
  'Analisa gambar yang diberikan lalu balas HANYA dengan JSON valid, tanpa teks lain, tanpa markdown, dengan bentuk persis:',
  '{"isNSFW": boolean, "category": "safe" | "adult" | "racy" | "violence" | "other", "reason": string}',
  '"isNSFW" true jika gambar mengandung ketelanjangan, konten seksual/pornografi, atau kekerasan grafis eksplisit.',
  '"reason" singkat (maks 15 kata) dalam Bahasa Indonesia.'
].join(' ')

async function getInput(req) {
  if (req.method === 'GET') return req.query || {}
  let body = req.body || {}
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch {}
  }
  return body
}

// Terima gambar sebagai URL http(s) atau data URI, kembalikan { mimeType, data(base64) }.
async function resolveImage(raw) {
  const value = String(raw || '').trim()
  if (!value) return null

  const dataMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (dataMatch) {
    const [, mimeType, base64] = dataMatch
    const approxBytes = (base64.length * 3) / 4
    if (approxBytes > MAX_IMAGE_BYTES) throw new Error('Gambar terlalu besar (maks 8MB).')
    return { mimeType, data: base64 }
  }

  if (/^https?:\/\//i.test(value)) {
    const r = await fetch(value)
    if (!r.ok) throw new Error(`Gagal mengambil gambar dari URL (${r.status})`)

    const mimeType = r.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
    if (!mimeType.startsWith('image/')) throw new Error('URL yang diberikan bukan gambar.')

    const contentLength = Number(r.headers.get('content-length') || 0)
    if (contentLength && contentLength > MAX_IMAGE_BYTES) throw new Error('Gambar terlalu besar (maks 8MB).')

    const buffer = Buffer.from(await r.arrayBuffer())
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Gambar terlalu besar (maks 8MB).')

    return { mimeType, data: buffer.toString('base64') }
  }

  throw new Error("Parameter 'image' harus berupa URL http/https atau data URI base64.")
}

function extractText(data) {
  return (
    data.outputs?.find((x) => x.type === 'text')?.text ||
    data.steps?.flatMap((x) => x.content || []).find((x) => x.type === 'text')?.text ||
    null
  )
}

function parseVerdict(rawText) {
  // Gemini kadang membungkus JSON dengan ```json ... ``` walau sudah dilarang;
  // bersihkan dulu sebelum parse.
  const cleaned = rawText.replace(/```json|```/gi, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Gagal membaca hasil analisa (bukan JSON).')

  const parsed = JSON.parse(match[0])
  if (typeof parsed.isNSFW !== 'boolean') throw new Error('Hasil analisa tidak lengkap.')

  return {
    isNSFW: parsed.isNSFW,
    category: parsed.category || (parsed.isNSFW ? 'other' : 'safe'),
    reason: parsed.reason || ''
  }
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ status: false, message: 'Method Not Allowed' })
  }

  try {
    const input = await getInput(req)
    const imageParam = input.image || input.img || input.url || ''

    if (!imageParam) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'image' wajib diisi.",
        example: '/api/antinsfw?image=https://example.com/foto.jpg'
      })
    }

    let image
    try {
      image = await resolveImage(imageParam)
    } catch (imgErr) {
      return res.status(400).json({ status: false, message: imgErr.message })
    }

    const upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY
      },
      body: JSON.stringify({
        model: MODEL,
        system_instruction: SYSTEM_INSTRUCTION,
        input: [
          { type: 'text', text: 'Analisa gambar ini sesuai instruksi.' },
          { type: 'image', image: { mime_type: image.mimeType, data: image.data } }
        ]
      })
    })

    const data = await upstream.json()

    if (!upstream.ok) {
      throw new Error(data.error?.message || JSON.stringify(data))
    }

    const rawText = extractText(data)
    if (!rawText) {
      console.error('ANTINSFW unrecognized result shape:', JSON.stringify(data)?.slice(0, 2000))
      throw new Error('Gagal mengekstrak balasan dari upstream (format hasil tidak dikenali)')
    }

    const verdict = parseVerdict(rawText)

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ status: true, ...verdict })
  } catch (err) {
    console.error('ANTINSFW ERROR:', err)
    return res.status(500).json({ status: false, message: 'Gagal memproses permintaan', error: err.message })
  }
}
