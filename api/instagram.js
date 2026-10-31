import axios from 'axios'

const CREATOR = 'Alvin'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
const HEADERS = { 'User-Agent': UA, Accept: '*/*' }

function send(res, status, data) {
  res.status(status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  return res.json({ creator: CREATOR, ...data })
}

function parseInstagramUrl(value) {
  let parsed
  try {
    parsed = new URL(String(value || '').trim())
  } catch {
    return null
  }
  if (!['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(parsed.hostname.toLowerCase())) return null
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (!parts.length) return null
  const first = parts[0].toLowerCase()
  if (first === 'stories') {
    if (!parts[1]) return null
    return { type: 'story', username: parts[1], url: parsed.toString() }
  }
  if (['reel', 'reels'].includes(first)) return { type: 'reel', url: parsed.toString() }
  if (first === 'p') return { type: 'post', url: parsed.toString() }
  if (first === 'tv') return { type: 'video', url: parsed.toString() }
  return null
}

function normalizeMedia(items = []) {
  return items.map((item, index) => {
    const rawType = String(item.type || item.media_type || '').toLowerCase()
    const url = item.url || item.download_url || item.videoUrl || item.video_url || item.src || null
    const type = rawType.includes('video') || item.is_video === true || item.isVideo === true ? 'video' : 'image'
    return {
      number: index + 1,
      type,
      url,
      thumbnail: item.thumbnail || item.thumbnail_url || item.display_url || null,
      quality: item.quality || null
    }
  }).filter(item => item.url)
}

async function requestV1(url) {
  const config = await axios.get('https://watext.me/instagram-video-downloder/js/config.js', {
    headers: { ...HEADERS, Origin: 'https://watext.me', Referer: 'https://watext.me/' },
    timeout: 18000
  })
  const match = String(config.data || '').match(/apiUrl\s*:\s*['"]([^'"]+)['"]/)
  if (!match) throw new Error('Endpoint server pertama tidak ditemukan.')
  const api = new URL(match[1])
  const response = await axios.post(`${api.origin}/fetch`, { url }, {
    headers: {
      ...HEADERS,
      'Content-Type': 'application/json',
      Host: api.host,
      Origin: 'https://watext.me',
      Referer: 'https://watext.me/'
    },
    timeout: 25000
  })
  const data = response.data?.data
  const media = normalizeMedia(data?.mediaItems || [])
  if (!media.length) throw new Error('Server pertama tidak mengembalikan media.')
  const info = data?.postInfo || {}
  return {
    server: 'watext',
    type: info.type || null,
    username: info.ownerUsername || null,
    fullname: info.ownerFullname || null,
    verified: info.isVerified ?? null,
    private: info.isPrivate ?? null,
    likes: info.likes ?? null,
    caption: info.caption || null,
    total: media.length,
    media
  }
}

async function requestV2(url) {
  await axios.get('https://fastvidl.com/instagram-video-downloader-free', {
    headers: HEADERS,
    timeout: 18000
  })
  const response = await axios.post('https://fastvidl.com/api/lookup', { url }, {
    headers: {
      ...HEADERS,
      'Content-Type': 'application/json',
      Origin: 'https://fastvidl.com',
      Referer: 'https://fastvidl.com/instagram-video-downloader-free'
    },
    timeout: 25000
  })
  const data = response.data
  const media = normalizeMedia(data?.media || [])
  if (!data?.ok || !media.length) throw new Error(data?.message || 'Server kedua tidak mengembalikan media.')
  return {
    server: 'fastvidl',
    type: data.type || null,
    username: data.username || null,
    quality: data.quality || null,
    title: data.title || null,
    total: media.length,
    media
  }
}

async function requestV3(url, type) {
  const endpoint = type === 'reel' || type === 'video' ? 'ig-reels' : 'ig-photo'
  const response = await axios.get(`https://igexport.com/api/${endpoint}/`, {
    params: { url },
    headers: HEADERS,
    timeout: 25000
  })
  const data = response.data?.data || response.data
  const raw = data?.media?.items || data?.media?.videos || data?.media?.images || (data?.media?.videoUrl ? [{ type: 'video', url: data.media.videoUrl }] : [])
  const media = normalizeMedia(raw)
  if (!media.length) throw new Error('Server ketiga tidak mengembalikan media.')
  return {
    server: 'igexport',
    type,
    username: data?.user?.username || data?.username || null,
    caption: data?.caption || null,
    total: media.length,
    media
  }
}

async function requestStory(username) {
  const response = await axios.get('https://igexport.com/api/ig-stories/', {
    params: { username },
    headers: HEADERS,
    timeout: 25000
  })
  const data = response.data?.data
  const items = data?.items || []
  const media = items.map((item, index) => ({
    number: index + 1,
    type: item.is_video ? 'video' : 'image',
    url: item.is_video
      ? item.video_versions?.[0]?.url_original || item.video_versions?.[0]?.url
      : item.image_versions?.items?.[0]?.url_original || item.image_versions?.items?.[0]?.url,
    takenAt: item.taken_at || null
  })).filter(item => item.url)
  if (!media.length) throw new Error('Story tidak ditemukan, akun mungkin privat, atau story sudah kedaluwarsa.')
  const user = data?.additional_data?.user || {}
  return {
    server: 'igexport',
    type: 'story',
    username: user.username || username,
    fullname: user.full_name || null,
    verified: user.is_verified ?? null,
    total: media.length,
    expiresAt: data?.additional_data?.expiring_at || null,
    canReply: data?.additional_data?.can_reply ?? null,
    canReshare: data?.additional_data?.can_reshare ?? null,
    media
  }
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return send(res, 405, { status: false, message: 'Gunakan method GET atau POST.' })
  }

  let body = req.body || {}
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = {} }
  }

  const input = String(req.method === 'GET'
    ? req.query?.url || req.query?.link || ''
    : body.url || body.link || '').trim()

  if (!input) {
    return send(res, 400, {
      status: false,
      message: 'Parameter url wajib diisi.',
      example: '/api/instagram?url=https%3A%2F%2Fwww.instagram.com%2Freel%2FXXXXXXXX%2F'
    })
  }

  const parsed = parseInstagramUrl(input)
  if (!parsed) {
    return send(res, 400, {
      status: false,
      message: 'URL Instagram tidak valid. Gunakan URL Reels, Post, atau Story.'
    })
  }

  try {
    const result = parsed.type === 'story'
      ? await requestStory(parsed.username)
      : await (async () => {
          const errors = []
          for (const provider of [requestV1, requestV2, (url) => requestV3(url, parsed.type)]) {
            try {
              return await provider(parsed.url)
            } catch (error) {
              errors.push(error?.message || 'Request gagal.')
            }
          }
          throw new Error(errors.join(' | '))
        })()

    return send(res, 200, {
      status: true,
      platform: 'instagram',
      url: parsed.url,
      result
    })
  } catch (error) {
    console.error('[Instagram API]', error)
    return send(res, 502, {
      status: false,
      platform: 'instagram',
      message: 'Semua server downloader gagal mengambil media.',
      detail: error?.message || 'Provider tidak memberikan respons yang valid.'
    })
  }
}
