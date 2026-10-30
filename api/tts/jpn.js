const API = 'https://api.tts.quest/v3/voicevox/synthesis'
const DEFAULT_SPEAKER = 0
const MAX_TEXT_LENGTH = 300
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function sendError(res, status, message, extra = {}) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  return res.status(status).json({
    status: false,
    creator: 'FuadXyro',
    message,
    ...extra
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return sendError(res, 405, 'Gunakan method GET.')
  }

  const text = String(req.query?.text || '').trim()
  const speakerValue = req.query?.speaker ?? DEFAULT_SPEAKER
  const speaker = Number(speakerValue)

  if (!text) {
    return sendError(res, 400, "Parameter 'text' wajib diisi.", {
      example: '/api/tts/jpn?text=こんにちは'
    })
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return sendError(res, 400, `Teks maksimal ${MAX_TEXT_LENGTH} karakter.`)
  }

  if (!Number.isInteger(speaker) || speaker < 0 || speaker > 100) {
    return sendError(res, 400, 'Speaker harus berupa angka 0 sampai 100.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 52000)

  try {
    const url = new URL(API)
    url.searchParams.set('text', text)
    url.searchParams.set('speaker', String(speaker))

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store'
    })

    const raw = await response.text()
    let job
    try {
      job = JSON.parse(raw)
    } catch {
      return sendError(res, 502, `Server TTS memberikan respons tidak valid (${response.status}).`)
    }

    if (!response.ok || job.success === false || job.error) {
      const retryAfter = Number(job.retryAfter || 0)
      if (retryAfter > 0) res.setHeader('Retry-After', String(retryAfter))
      return sendError(res, response.status === 429 ? 429 : 502,
        job.error || job.message || `Server TTS gagal (${response.status}).`,
        retryAfter > 0 ? { retryAfter } : {})
    }

    if (!job.audioStatusUrl || !job.mp3DownloadUrl) {
      return sendError(res, 502, 'Server TTS tidak mengirim URL audio yang diperlukan.')
    }

    for (let attempt = 0; attempt < 45; attempt++) {
      if (attempt > 0) await sleep(1000)

      const statusResponse = await fetch(job.audioStatusUrl, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store'
      })

      if (!statusResponse.ok) continue

      let status
      try {
        status = await statusResponse.json()
      } catch {
        continue
      }

      if (status.isAudioError) {
        return sendError(res, 502, 'Provider gagal membuat audio. Coba lagi nanti.')
      }

      if (status.isAudioReady) {
        const audioResponse = await fetch(job.mp3DownloadUrl, {
          signal: controller.signal,
          cache: 'no-store'
        })

        if (!audioResponse.ok) {
          return sendError(res, 502, `Download MP3 gagal (${audioResponse.status}).`)
        }

        const contentType = audioResponse.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const detail = (await audioResponse.text()).slice(0, 500)
          return sendError(res, 502, detail || 'Provider tidak mengembalikan file MP3.')
        }

        const audio = Buffer.from(await audioResponse.arrayBuffer())
        if (!audio.length) return sendError(res, 502, 'File MP3 kosong.')

        res.setHeader('Content-Type', 'audio/mpeg')
        res.setHeader('Content-Length', String(audio.length))
        res.setHeader('Content-Disposition', 'inline; filename="voicevox-jpn.mp3"')
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-TTS-Provider', 'VOICEVOX')
        res.setHeader('X-TTS-Speaker', String(speaker))
        return res.status(200).send(audio)
      }
    }

    res.setHeader('Retry-After', '3')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(202).json({
      status: true,
      processing: true,
      creator: 'FuadXyro',
      message: 'Audio masih diproses. Coba ambil MP3 beberapa saat lagi.',
      mp3Url: job.mp3DownloadUrl,
      audioStatusUrl: job.audioStatusUrl
    })
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Proses TTS melewati batas waktu 52 detik.'
      : error.message || 'Gagal menghubungi provider VOICEVOX.'
    return sendError(res, 502, message)
  } finally {
    clearTimeout(timeout)
  }
}
