import axios from 'axios'

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
  const match = input.match(/https?:\/\/(?:www\.)?sticker\.ly\/s\/([A-Za-z0-9_-]+)/i)
  return match?.[1] || null
}

function normalizePack(pack, index) {
  const files = pack.resourceFiles || pack.stickers || []
  const shareUrl = pack.shareUrl || null
  return {
    number: index + 1,
    name: pack.name || null,
    author: pack.authorName || pack.user?.displayName || pack.user?.name || null,
    stickerCount: files.length || pack.stickerCount || null,
    shareUrl,
    cover: files[0]?.fileName && pack.resourceUrlPrefix ? pack.resourceUrlPrefix + files[0].fileName : null,
    isAnimated: Boolean(pack.isAnimated || pack.animated)
  }
}

async function requestStickerly(url, options = {}) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await axios({
        url,
        method: options.method || 'GET',
        headers: HEADERS,
        data: options.data,
        timeout: 25000,
        validateStatus: () => true,
        responseType: 'json'
      })
      if (response.data && typeof response.data === 'object') return response
      lastError = new Error(`Respons Sticker.ly kosong atau bukan JSON (HTTP ${response.status}).`)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(lastError?.message || 'Sticker.ly tidak memberikan respons yang valid.')
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return send(res, 405, { success: false, creator: 'FuadXyro', message: 'Gunakan method GET atau POST.' })
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

  const input = String(directInput || params.url || params.link || params.q || params.keyword || params.search || '').trim()
  if (!input) return send(res, 400, {
    success: false,
    creator: 'FuadXyro',
    message: 'Masukkan kata kunci atau URL pack langsung setelah ?=.',
    examples: {
      search: '/api/stickerly?=blue%20archive',
      pack: '/api/stickerly?=https%3A%2F%2Fsticker.ly%2Fs%2FJ3ELW0'
    }
  })

  try {
    const code = getCode(input)
    if (code) {
      const response = await requestStickerly(`${BASE_URL}/stickerPack/${encodeURIComponent(code)}?needRelation=true`)
      const json = response.data
      if (response.status < 200 || response.status >= 300) return send(res, 502, { success: false, creator: 'FuadXyro', message: 'Sticker.ly gagal mengambil pack.', detail: json?.message || `HTTP ${response.status}` })
      const pack = json?.result || {}
      const prefix = pack.resourceUrlPrefix || ''
      const files = pack.stickers || pack.resourceFiles || []
      const stickers = files.map((sticker, index) => ({
        number: index + 1,
        fileName: sticker.fileName || null,
        url: sticker.fileName ? prefix + sticker.fileName : null,
        animated: Boolean(sticker.isAnimated || sticker.animated),
        tags: sticker.tags || []
      }))
      if (!stickers.length) return send(res, 404, { success: false, creator: 'FuadXyro', message: 'Pack tidak ditemukan atau tidak memiliki stiker.' })
      return send(res, 200, {
        success: true,
        creator: 'FuadXyro',
        mode: 'pack',
        pack: {
          name: pack.name || null,
          author: pack.authorName || pack.user?.displayName || pack.user?.name || null,
          url: `https://sticker.ly/s/${code}`,
          total: stickers.length,
          cover: stickers[0]?.url || null
        },
        stickers
      })
    }

    const response = await requestStickerly(`${BASE_URL}/stickerPack/smartSearch`, {
      method: 'POST',
      data: {
        keyword: input,
        enabledKeywordSearch: true,
        filter: {
          extendSearchResult: false,
          sortBy: 'RECOMMENDED',
          languages: ['ALL'],
          minStickerCount: 5,
          searchBy: 'ALL',
          stickerType: 'ALL'
        }
      }
    })
    const json = response.data
    if (response.status < 200 || response.status >= 300) return send(res, 502, { success: false, creator: 'FuadXyro', message: 'Pencarian Sticker.ly gagal.', detail: json?.message || `HTTP ${response.status}` })
    const packs = json?.result?.stickerPacks || []
    const results = packs.map(normalizePack)
    return send(res, 200, {
      success: true,
      creator: 'FuadXyro',
      mode: 'search',
      keyword: input,
      total: results.length,
      results
    })
  } catch (error) {
    return send(res, 502, {
      success: false,
      creator: 'FuadXyro',
      message: 'Terjadi kesalahan saat menghubungi Sticker.ly.',
      detail: error?.message || 'Request gagal.'
    })
  }
}
