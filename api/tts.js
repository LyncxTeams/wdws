import { EdgeTTS, Constants } from '@andresaya/edge-tts'

const MAX_TEXT_LENGTH = 500
const DEFAULT_VOICE = 'id-ID-GadisNeural'

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

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return sendError(res, 405, 'Gunakan method GET atau POST.')
  }

  const input = getInput(req)
  const text = String(input.text || input.q || input.message || '').trim()

  if (!text) {
    return sendError(res, 400, "Parameter 'text' wajib diisi.")
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return sendError(res, 400, `Teks terlalu panjang. Maksimal ${MAX_TEXT_LENGTH} karakter.`)
  }

  const pitch = String(input.pitch || '+20Hz')
  const rate = String(input.rate || '+5%')
  const volume = String(input.volume || '+10%')

  if (!/^[+-]?\d{1,3}Hz$/.test(pitch) || Math.abs(parseInt(pitch, 10)) > 100) {
    return sendError(res, 400, "Parameter 'pitch' harus antara -100Hz sampai +100Hz.")
  }

  if (!/^[+-]?\d{1,3}%$/.test(rate) || parseInt(rate, 10) < -100 || parseInt(rate, 10) > 200) {
    return sendError(res, 400, "Parameter 'rate' harus antara -100% sampai +200%.")
  }

  if (!/^[+-]?\d{1,3}%$/.test(volume) || parseInt(volume, 10) < -100 || parseInt(volume, 10) > 100) {
    return sendError(res, 400, "Parameter 'volume' harus antara -100% sampai +100%.")
  }

  try {
    const tts = new EdgeTTS({ timeout: 60000 })
    const result = await tts.generate(text, DEFAULT_VOICE, {
      pitch,
      rate,
      volume,
      outputFormat: Constants.OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
      timeout: 60000
    })

    const audio = Buffer.from(result.audio)

    if (!audio.length) {
      throw new Error('Layanan TTS tidak menghasilkan audio.')
    }

    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', audio.length)
    res.setHeader('Content-Disposition', 'inline; filename="cylicdev-tts.mp3"')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-TTS-Voice', DEFAULT_VOICE)

    return res.status(200).send(audio)
  } catch (error) {
    console.error('TTS ERROR:', error)
    return sendError(res, 502, error?.message || 'Gagal membuat audio TTS.')
  }
}
