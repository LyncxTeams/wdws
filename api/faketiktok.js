const FAZZCODE_URL = 'https://api.fazzcode.eu.cc/fakettchat'
const FALLBACK_API_KEY = 'fcs_test_e14c30beb771224d6a726aa4ddd0e99d75a474c3'

async function getInput(req) {
  if (req.method === 'GET') return req.query || {}
  let body = req.body || {}
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch {}
  }
  return body
}

async function fetchImage(url) {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    throw new Error('URL image tidak valid')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL image harus menggunakan http atau https')
  }

  const response = await fetch(parsed, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow'
  })

  if (!response.ok) {
    throw new Error(`Gagal mengambil image (${response.status})`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) {
    throw new Error('URL tersebut bukan file gambar')
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('Image kosong')
  if (buffer.length > 10 * 1024 * 1024) throw new Error('Ukuran image terlalu besar (maks 10 MB)')

  let ext = 'jpg'
  if (contentType.includes('png')) ext = 'png'
  else if (contentType.includes('webp')) ext = 'webp'
  else if (contentType.includes('gif')) ext = 'gif'

  return { buffer, contentType, filename: `avatar.${ext}` }
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ status: false, error: 'Method Not Allowed' })
  }

  try {
    const input = await getInput(req)
    const image = String(input.image || input.avatar || '').trim()
    const username = String(input.username || input.user || 'Dika').trim()
    const chat = String(input.chat || input.message || 'Apasih').trim()

    if (!image) {
      return res.status(400).json({
        status: false,
        error: 'Parameter image wajib diisi',
        example: '/api/faketiktok?username=Dika&chat=Apasih&image=https://example.com/foto.jpg'
      })
    }

    if (!username || !chat) {
      return res.status(400).json({
        status: false,
        error: 'Parameter username dan chat wajib diisi'
      })
    }

    if (username.length > 60 || chat.length > 500) {
      return res.status(400).json({
        status: false,
        error: 'Username maksimal 60 karakter dan chat maksimal 500 karakter'
      })
    }

    const apiKey = process.env.FAZZCODE_API_KEY || FALLBACK_API_KEY
    const imageData = await fetchImage(image)

    const form = new FormData()
    form.append(
      'image',
      new Blob([imageData.buffer], { type: imageData.contentType }),
      imageData.filename
    )

    const target = new URL(FAZZCODE_URL)
    target.searchParams.set('username', username)
    target.searchParams.set('chat', chat)

    const response = await fetch(target, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    })

    const contentType = response.headers.get('content-type') || ''
    const result = Buffer.from(await response.arrayBuffer())

    if (!response.ok) {
      let error = result.toString('utf8')
      try {
        const json = JSON.parse(error)
        error = json.error || json.message || error
      } catch {}
      return res.status(response.status).json({
        status: false,
        error: error || `FazzCode API error (${response.status})`
      })
    }

    if (contentType.startsWith('image/')) {
      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Disposition', 'inline; filename="faketiktok.png"')
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).send(result)
    }

    try {
      const json = JSON.parse(result.toString('utf8'))
      if (json.url || json.image || json.data?.url) {
        const outputUrl = json.url || json.image || json.data.url
        const output = await fetch(outputUrl)
        if (output.ok) {
          const outputType = output.headers.get('content-type') || 'image/png'
          const outputBuffer = Buffer.from(await output.arrayBuffer())
          res.setHeader('Content-Type', outputType)
          res.setHeader('Content-Disposition', 'inline; filename="faketiktok.png"')
          res.setHeader('Cache-Control', 'no-store')
          return res.status(200).send(outputBuffer)
        }
      }
      return res.status(200).json(json)
    } catch {
      res.setHeader('Content-Type', contentType || 'image/png')
      return res.status(200).send(result)
    }
  } catch (error) {
    console.error('faketiktok:', error)
    return res.status(500).json({
      status: false,
      error: error.message || 'Gagal membuat Fake TikTok Chat'
    })
  }
}
