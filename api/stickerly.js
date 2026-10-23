const BASE_URL = 'https://api.sticker.ly/v4'
const HEADERS = {
  'user-agent': 'androidapp.stickerly/3.17.0',
  'content-type': 'application/json'
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  return res.end(JSON.stringify(body, null, 2))
}

function getCode(value) {
  const input = String(value || '').trim()
  const match = input.match(/(?:sticker\.ly\/s\/|^)([A-Za-z0-9_-]{4,})(?:[/?#].*)?$/i)
  return match?.[1] || null
}

async function readUpstream(response) {
  const raw = await response.text()
  if (!raw || !raw.trim()) {
    return { ok: false, json: null, detail: `Sticker.ly mengembalikan respons kosong (HTTP ${response.status}).` }
  }
  try {
    return { ok: true, json: JSON.parse(raw), detail: null }
  } catch {
    return { ok: false, json: null, detail: `Respons Sticker.ly bukan JSON yang valid (HTTP ${response.status}): ${raw.slice(0, 180)}` }
  }
}

async function fetchStickerly(url, options = {}) {
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25000) })
      const parsed = await readUpstream(response)
      if (parsed.ok) return { response, json: parsed.json, parseError: null }
      lastError = { response, parseError: parsed.detail }
    } catch (error) {
      lastError = { response: null, parseError: error?.name === 'TimeoutError' ? 'Request ke Sticker.ly timeout.' : error.message }
    }
  }
  return { response: lastError?.response || null, json: null, parseError: lastError?.parseError || 'Sticker.ly tidak memberikan respons yang valid.' }
}

function normalizePack(pack) {
  const code = pack.shareCode || getCode(pack.shareUrl || pack.url || '')
  return {
    name: pack.name || null,
    author: pack.user?.displayName || pack.user?.name || pack.authorName || null,
    total: pack.stickerCount ?? pack.stickers?.length ?? null,
    shareCode: code,
    url: code ? `https://sticker.ly/s/${code}` : pack.shareUrl || pack.url || null,
    cover: pack.resourceUrlPrefix && pack.stickers?.[0]?.fileName ? pack.resourceUrlPrefix + pack.stickers[0].fileName : pack.cover || pack.thumbnail || null
  }
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return send(res, 405, { success: false, message: 'Gunakan method GET atau POST.' })
  }

  let body = req.body || {}
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = {} }
  }
  const params = { ...(req.query || {}), ...(body || {}) }
  const requestUrl = String(req.url || req.originalUrl || '')
  let directInput = ''
  const rawMatch = requestUrl.match(/[?&]=([^&]*)/)
  if (rawMatch) {
    try { directInput = decodeURIComponent(rawMatch[1].replace(/\+/g, '%20')).trim() } catch { directInput = rawMatch[1].trim() }
  }
  if (!directInput && params[''] != null) directInput = String(Array.isArray(params['']) ? params[''][0] : params['']).trim()
  if (!directInput) {
    const oddKey = Object.keys(params).find(key => key && !['q', 'keyword', 'search', 'url', 'link'].includes(key.toLowerCase()) && (params[key] === '' || params[key] == null))
    if (oddKey) directInput = oddKey.trim()
  }
  const inputUrl = String(directInput || params.url || params.link || '').trim()
  const keyword = String(directInput || params.q || params.keyword || params.search || '').trim()
  const code = getCode(inputUrl)

  try {
    if (code) {
      const upstream = await fetchStickerly(`${BASE_URL}/stickerPack/${encodeURIComponent(code)}?needRelation=true`, { headers: HEADERS })
      if (!upstream.json) return send(res, 502, { success: false, creator: 'FuadXyro', message: 'Sticker.ly gagal mengembalikan data pack yang valid.', detail: upstream.parseError })
      const response = upstream.response
      const json = upstream.json
      if (!response.ok) return send(res, response.status, { success: false, creator: 'FuadXyro', message: 'Sticker.ly gagal mengambil pack.', detail: json?.message || null })
      const pack = json?.result || {}
      const prefix = pack.resourceUrlPrefix || ''
      const stickers = (pack.stickers || []).map((sticker, index) => ({
        number: index + 1,
        fileName: sticker.fileName || null,
        url: sticker.fileName ? prefix + sticker.fileName : null,
        animated: Boolean(sticker.isAnimated || sticker.animated),
        tags: sticker.tags || []
      }))
      if (!stickers.length) return send(res, 404, { success: false, message: 'Pack tidak ditemukan atau tidak memiliki stiker.' })
      return send(res, 200, {
        success: true,
        creator: 'FuadXyro',
        mode: 'pack',
        pack: {
          name: pack.name || null,
          author: pack.user?.displayName || pack.user?.name || pack.authorName || null,
          url: `https://sticker.ly/s/${code}`,
          total: stickers.length,
          cover: stickers[0]?.url || null
        },
        stickers
      })
    }

    if (!keyword) return send(res, 400, {
      success: false,
      message: 'Input ?= tidak terbaca. Coba /api/stickerly?=naruto atau /api/stickerly?q=naruto.',
      examples: {
        search: '/api/stickerly?=naruto',
        fallbackSearch: '/api/stickerly?q=naruto',
        pack: '/api/stickerly?=https%3A%2F%2Fsticker.ly%2Fs%2FJ3ELW0'
      }
    })

    const upstream = await fetchStickerly(`${BASE_URL}/stickerPack/smartSearch`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ keyword, cursor: 0, page: 1, limit: 20, searchType: 'ALL' })
    })
    if (!upstream.json) return send(res, 502, { success: false, creator: 'FuadXyro', message: 'Pencarian Sticker.ly gagal mengembalikan data yang valid.', detail: upstream.parseError })
    const response = upstream.response
    const json = upstream.json
    if (!response.ok) return send(res, response.status, { success: false, creator: 'FuadXyro', message: 'Pencarian Sticker.ly gagal.', detail: json?.message || null })
    const result = json?.result
    const packs = Array.isArray(result) ? result : result?.packs || result?.stickerPacks || result?.data || result?.items || []
    const results = packs.map(normalizePack)
    return send(res, 200, { success: true, creator: 'FuadXyro', mode: 'search', keyword, total: results.length, results })
  } catch (error) {
    return send(res, 500, { success: false, creator: 'FuadXyro', message: 'Terjadi kesalahan saat menghubungi Sticker.ly.', detail: error?.name === 'TimeoutError' ? 'Request timeout.' : error.message })
  }
}
