const API = 'https://api.tts.quest/v3/voicevox/synthesis'
const DEFAULT_SPEAKER = 0

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({
      status: false,
      message: 'Method Not Allowed'
    })
  }

  try {
    const text = String(req.query.text || '').trim()
    const speaker = Number(req.query.speaker ?? DEFAULT_SPEAKER)

    if (!text) {
      return res.status(400).json({
        status: false,
        message: 'Parameter text wajib diisi.',
        example: '/api/tts/jpn?text=こんにちは'
      })
    }

    if (text.length > 300) {
      return res.status(400).json({
        status: false,
        message: 'Maksimal 300 karakter.'
      })
    }

    if (!Number.isInteger(speaker) || speaker < 0 || speaker > 100) {
      return res.status(400).json({
        status: false,
        message: 'Speaker tidak valid.'
      })
    }

    const url = new URL(API)
    url.searchParams.set('text', text)
    url.searchParams.set('speaker', String(speaker))

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000)
    })
    const job = await response.json()

    if (!response.ok || !job.success) {
      const retryAfter = Number(job.retryAfter || 0)
      if (retryAfter > 0) res.setHeader('Retry-After', String(retryAfter))

      return res.status(response.status === 429 ? 429 : 502).json({
        status: false,
        message: job.error || 'Gagal membuat audio.',
        retryAfter: retryAfter || undefined
      })
    }

    if (!job.audioStatusUrl || !job.mp3DownloadUrl) {
      throw new Error('URL audio tidak tersedia.')
    }

    let buffer

    for (let i = 0; i < 15; i++) {
      if (i) await sleep(1000)

      const statusResponse = await fetch(job.audioStatusUrl, {
        signal: AbortSignal.timeout(7000),
        cache: 'no-store'
      })

      if (!statusResponse.ok) continue

      const status = await statusResponse.json()

      if (status.isAudioError) {
        throw new Error('Audio gagal dibuat.')
      }

      if (status.isAudioReady) {
        const audioResponse = await fetch(job.mp3DownloadUrl, {
          signal: AbortSignal.timeout(15000),
          cache: 'no-store'
        })

        if (!audioResponse.ok) {
          throw new Error('Download MP3 gagal.')
        }

        buffer = Buffer.from(await audioResponse.arrayBuffer())
        break
      }
    }

    if (!buffer?.length) {
      res.setHeader('Retry-After', '3')
      return res.status(202).json({
        status: true,
        processing: true,
        message: 'Audio masih diproses.',
        mp3Url: job.mp3DownloadUrl
      })
    }

    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Disposition', 'inline; filename="voice.mp3"')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Length', String(buffer.length))

    return res.status(200).send(buffer)
  } catch (error) {
    console.error('TTS JPN ERROR:', error)
    return res.status(500).json({
      status: false,
      message: error.message || 'Terjadi kesalahan.'
    })
  }
}
