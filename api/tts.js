const MAX_TEXT_LENGTH = 500
const DEFAULT_VOICE = 'jf_alpha'
const ALLOWED_VOICES = new Set([
  'jf_alpha',
  'jf_gongitsune',
  'jf_nezumi',
  'jf_tebukuro'
])

function sendError(res, status, message) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  return res.status(status).json({
    status: false,
    creator: 'FuadXyro',
    message
  })
}

function getInput(req) {
  if (req.method === 'GET') return req.query || {}

  let body = req.body || {}
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = {}
    }
  }

  return body
}

function numberParam(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return sendError(res, 405, 'Gunakan method GET atau POST.')
  }

  const input = getInput(req)
  const text = String(input.text || input.q || input.message || '').trim()
  const voice = String(input.voice || DEFAULT_VOICE)

  if (!text) return sendError(res, 400, "Parameter 'text' wajib diisi.")
  if (text.length > MAX_TEXT_LENGTH) {
    return sendError(res, 400, `Teks terlalu panjang. Maksimal ${MAX_TEXT_LENGTH} karakter.`)
  }
  if (!ALLOWED_VOICES.has(voice)) {
    return sendError(res, 400, `Voice tidak tersedia. Pilihan: ${[...ALLOWED_VOICES].join(', ')}`)
  }

  const baseUrl = process.env.KOKORO_URL?.replace(/\/+$/, '')
  if (!baseUrl) {
    return sendError(res, 503, 'KOKORO_URL belum diatur pada Environment Variables Vercel.')
  }

  const speed = numberParam(input.speed, 1.08, 0.5, 2)
  const pitch = numberParam(input.pitch, 2, -12, 12)
  const tempo = numberParam(input.tempo, 1.04, 0.5, 2)
  const volume = numberParam(input.volume, 1, 0, 2)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 55000)

  try {
    const headers = { 'Content-Type': 'application/json' }
    if (process.env.KOKORO_API_KEY) {
      headers.Authorization = `Bearer ${process.env.KOKORO_API_KEY}`
    }

    const response = await fetch(`${baseUrl}/tts/generate`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        text,
        voice,
        output_format: 'mp3',
        speed,
        pitch_semitones: pitch,
        tempo,
        volume,
        normalize: true
      })
    })

    const contentType = response.headers.get('content-type') || ''
    const audio = Buffer.from(await response.arrayBuffer())

    if (!response.ok || contentType.includes('application/json')) {
      const detail = audio.toString('utf8').slice(0, 1200)
      return sendError(res, 502, `Kokoro TTS gagal (${response.status}): ${detail || 'Tidak ada detail error.'}`)
    }

    if (!audio.length) return sendError(res, 502, 'Kokoro TTS mengembalikan audio kosong.')

    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', audio.length)
    res.setHeader('Content-Disposition', 'inline; filename="cylicdev-anime-voice.mp3"')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-TTS-Voice', voice)
    return res.status(200).send(audio)
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Proses TTS melewati batas waktu 55 detik.'
      : error.message || 'Gagal menghubungi server Kokoro TTS.'
    return sendError(res, 502, message)
  } finally {
    clearTimeout(timeout)
  }
}
