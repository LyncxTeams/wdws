export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const body = req.method === 'POST' ? (req.body || {}) : req.query
    const image = body.image || body.url

    if (!image || typeof image !== 'string') {
      return res.status(400).json({
        error: 'Parameter image wajib diisi',
        example: '/api/faketiktok?image=https://example.com/foto.jpg'
      })
    }

    let imageUrl
    try {
      imageUrl = new URL(image)
    } catch {
      return res.status(400).json({ error: 'URL image tidak valid' })
    }

    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) {
      return res.status(400).json({ error: `Gagal mengambil image (${imageResponse.status})` })
    }

    const imageType = imageResponse.headers.get('content-type') || 'image/jpeg'
    if (!imageType.startsWith('image/')) {
      return res.status(400).json({ error: 'URL bukan file gambar' })
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
    const form = new FormData()
    form.append('image', new Blob([imageBuffer], { type: imageType }), 'image.jpg')

    const apiKey = process.env.FAZZCODE_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'FAZZCODE_API_KEY belum diset di Vercel Environment Variables' })
    }

    const apiResponse = await fetch('https://api.fazzcode.eu.cc/faketiktok', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    })

    const contentType = apiResponse.headers.get('content-type') || ''
    const result = Buffer.from(await apiResponse.arrayBuffer())

    if (!apiResponse.ok) {
      const text = result.toString('utf8')
      return res.status(apiResponse.status).send(text || 'FazzCode API error')
    }

    if (contentType.includes('application/json')) {
      try {
        const json = JSON.parse(result.toString('utf8'))
        return res.status(200).json(json)
      } catch {}
    }

    res.status(200)
    res.setHeader('Content-Type', contentType.startsWith('image/') ? contentType : 'image/png')
    res.setHeader('Content-Disposition', 'inline; filename="faketiktok.png"')
    res.send(result)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: error.message })
  }
}
