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
  const parsed = new URL(String(url))
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL image harus menggunakan http atau https')

  const response = await fetch(parsed, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow'
  })
  if (!response.ok) throw new Error(`Gagal mengambil image (${response.status})`)

  const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase()
  if (!contentType.startsWith('image/')) throw new Error('URL tersebut bukan file gambar')

  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('Image kosong')
  if (buffer.length > 10 * 1024 * 1024) throw new Error('Ukuran image terlalu besar (maks 10 MB)')

  let ext = 'jpg'
  if (contentType.includes('png')) ext = 'png'
  else if (contentType.includes('webp')) ext = 'webp'
  else if (contentType.includes('gif')) ext = 'gif'

  return { buffer, contentType, filename: `avatar.${ext}` }
}

function isImageType(type) {
  return /^image\//i.test(type || '')
}

function sendImage(res, buffer, contentType = 'image/png') {
  res.statusCode = 200
  res.setHeader('Content-Type', contentType.split(';')[0] || 'image/png')
  res.setHeader('Content-Disposition', 'inline; filename="faketiktok.png"')
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  return res.end(buffer)
}

function base64ToBuffer(value) {
  if (typeof value !== 'string') return null
  let s = value.trim()
  const dataMatch = s.match(/^data:(image\/[^;]+);base64,(.+)$/is)
  if (dataMatch) return { buffer: Buffer.from(dataMatch[2], 'base64'), type: dataMatch[1] }

  // Only treat long strings as base64. This avoids accidentally decoding normal text.
  const compact = s.replace(/\s+/g, '')
  if (compact.length < 200 || !/^[A-Za-z0-9+/=_-]+$/.test(compact)) return null
  try {
    const normalized = compact.replace(/-/g, '+').replace(/_/g, '/')
    const buffer = Buffer.from(normalized, 'base64')
    if (!buffer.length) return null
    const hex = buffer.subarray(0, 12).toString('hex')
    if (hex.startsWith('89504e470d0a1a0a')) return { buffer, type: 'image/png' }
    if (hex.startsWith('ffd8ff')) return { buffer, type: 'image/jpeg' }
    if (hex.startsWith('47494638')) return { buffer, type: 'image/gif' }
    if (hex.startsWith('52494646') && buffer.subarray(8, 12).toString() === 'WEBP') return { buffer, type: 'image/webp' }
  } catch {}
  return null
}

function findImageValue(value, depth = 0) {
  if (depth > 6 || value == null) return null
  if (typeof value === 'string') {
    const direct = base64ToBuffer(value)
    if (direct) return direct
    if (/^https?:\/\//i.test(value)) return { url: value }
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageValue(item, depth + 1)
      if (found) return found
    }
    return null
  }
  if (typeof value === 'object') {
    const preferred = ['image', 'imageUrl', 'image_url', 'url', 'src', 'result', 'data', 'output', 'file', 'path']
    for (const key of preferred) {
      if (key in value) {
        const found = findImageValue(value[key], depth + 1)
        if (found) return found
      }
    }
    for (const key of Object.keys(value)) {
      if (!preferred.includes(key)) {
        const found = findImageValue(value[key], depth + 1)
        if (found) return found
      }
    }
  }
  return null
}

async function proxyImageUrl(url, res) {
  const output = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' }, redirect: 'follow' })
  const type = output.headers.get('content-type') || ''
  if (!output.ok || !isImageType(type)) return false
  return sendImage(res, Buffer.from(await output.arrayBuffer()), type)
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

    if (!image) return res.status(400).json({ status: false, error: 'Parameter image wajib diisi' })
    if (!username || !chat) return res.status(400).json({ status: false, error: 'Parameter username dan chat wajib diisi' })
    if (username.length > 60 || chat.length > 500) return res.status(400).json({ status: false, error: 'Username maksimal 60 karakter dan chat maksimal 500 karakter' })

    const apiKey = process.env.FAZZCODE_API_KEY || FALLBACK_API_KEY
    const imageData = await fetchImage(image)

    const form = new FormData()
    form.append('image', new Blob([imageData.buffer], { type: imageData.contentType }), imageData.filename)

    const target = new URL(FAZZCODE_URL)
    target.searchParams.set('username', username)
    target.searchParams.set('chat', chat)

    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'image/*, application/json, text/plain;q=0.8, */*'
      },
      body: form
    })

    const type = upstream.headers.get('content-type') || ''
    const result = Buffer.from(await upstream.arrayBuffer())

    if (!upstream.ok) {
      const text = result.toString('utf8')
      let error = text
      try {
        const json = JSON.parse(text)
        error = json.error || json.message || json.msg || text
      } catch {}
      return res.status(upstream.status).json({ status: false, error: error || `FazzCode API error (${upstream.status})` })
    }

    // FazzCode may return the generated file directly.
    if (isImageType(type)) return sendImage(res, result, type)

    const text = result.toString('utf8').trim()

    // JSON response: recursively find an image URL/base64 field.
    try {
      const json = JSON.parse(text)
      const found = findImageValue(json)
      if (found?.buffer) return sendImage(res, found.buffer, found.type)
      if (found?.url) {
        const ok = await proxyImageUrl(found.url, res)
        if (ok) return ok
      }
      return res.status(502).json({ status: false, error: 'FazzCode tidak mengembalikan gambar', response: json })
    } catch {}

    // Plain text response may itself be a data URI/base64 or an image URL.
    const found = findImageValue(text)
    if (found?.buffer) return sendImage(res, found.buffer, found.type)
    if (found?.url) {
      const ok = await proxyImageUrl(found.url, res)
      if (ok) return ok
    }

    // Do not expose/render upstream HTML in the browser.
    return res.status(502).json({
      status: false,
      error: 'FazzCode mengembalikan respons non-gambar. Pastikan endpoint /fakettchat dan API key benar.',
      upstreamContentType: type || 'unknown'
    })
  } catch (error) {
    console.error('faketiktok:', error)
    return res.status(500).json({ status: false, error: error.message || 'Gagal membuat Fake TikTok Chat' })
  }
}
