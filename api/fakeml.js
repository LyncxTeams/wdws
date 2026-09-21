import fs from 'fs/promises'
import path from 'path'

const RANKS = ['epic', 'glory', 'gm', 'honor', 'imo', 'legend', 'mawi']
const FALLBACK_AVATAR = 'https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Image/artworks-gWLRE6HyPH3DgVMG-ZFFxtg-t500x500.jpg'
const TMP_DIR = '/tmp'

const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)]
const randomBorder = () => Math.floor(Math.random() * 16) + 1

let generateCardFn = null
async function loadGenerator() {
  if (generateCardFn) return generateCardFn
  const mod = await import('fake-ml')
  generateCardFn = mod.default || mod.generateCard || mod['module.exports']
  if (typeof generateCardFn !== 'function') {
    throw new Error('Module fake-ml tidak mengekspor fungsi generateCard')
  }
  return generateCardFn
}

async function getInput(req) {
  if (req.method === 'GET') return req.query || {}
  let body = req.body || {}
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch {}
  }
  return body
}

// Bentuk hasil fake-ml tidak konsisten dengan dokumentasinya, jadi cari secara
// rekursif ke seluruh struktur `result`: bisa buffer, data:URI base64, URL,
// atau path file di disk.
function findImageResult(value, depth = 0) {
  if (depth > 6 || value == null) return null

  if (Buffer.isBuffer(value)) return { type: 'buffer', value }

  if (value instanceof Uint8Array) return { type: 'buffer', value: Buffer.from(value) }

  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return null

    const dataMatch = s.match(/^data:image\/[^;]+;base64,(.+)$/is)
    if (dataMatch) return { type: 'buffer', value: Buffer.from(dataMatch[1], 'base64') }

    if (/^https?:\/\//i.test(s)) return { type: 'url', value: s }

    if (/\.(png|jpe?g|webp|gif)$/i.test(s)) return { type: 'path', value: s }

    return null
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageResult(item, depth + 1)
      if (found) return found
    }
    return null
  }

  if (typeof value === 'object') {
    const preferred = ['image', 'buffer', 'file', 'path', 'output', 'result', 'data', 'url']
    for (const key of preferred) {
      if (key in value) {
        const found = findImageResult(value[key], depth + 1)
        if (found) return found
      }
    }
    for (const key of Object.keys(value)) {
      if (!preferred.includes(key)) {
        const found = findImageResult(value[key], depth + 1)
        if (found) return found
      }
    }
  }

  return null
}

async function resolveBuffer(found) {
  if (!found) return null

  if (found.type === 'buffer') return found.value

  if (found.type === 'url') {
    const r = await fetch(found.value)
    if (!r.ok) throw new Error(`Gagal mengambil gambar hasil (${r.status})`)
    return Buffer.from(await r.arrayBuffer())
  }

  if (found.type === 'path') {
    // Path yang dikembalikan package biasanya relatif terhadap cwd saat
    // generate berlangsung (yang sudah kita arahkan ke /tmp).
    const resolved = path.isAbsolute(found.value)
      ? found.value
      : path.resolve(TMP_DIR, found.value.replace(/^\.[\\/]/, ''))

    const buffer = await fs.readFile(resolved)
    fs.unlink(resolved).catch(() => {})
    return buffer
  }

  return null
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ status: false, message: 'Method Not Allowed' })
  }

  try {
    const input = await getInput(req)

    const username = String(input.username || input.name || 'Player').trim().slice(0, 15) || 'Player'

    let rank = String(input.rank || '').toLowerCase().trim()
    if (rank && !RANKS.includes(rank)) {
      return res.status(400).json({
        status: false,
        message: 'Rank tidak valid.',
        availableRanks: RANKS
      })
    }
    rank = rank || randomItem(RANKS)

    let border = parseInt(input.border, 10)
    if (!Number.isInteger(border) || border < 0 || border > 16) border = randomBorder()

    const avatar = String(input.avatar || input.image || input.pp || '').trim() || FALLBACK_AVATAR
    if (!/^https?:\/\//i.test(avatar)) {
      return res.status(400).json({
        status: false,
        message: 'Parameter avatar/image harus berupa URL gambar http/https.',
        example: '/api/fakeml?username=Darrel&rank=imo&border=1&avatar=https://example.com/avatar.jpg'
      })
    }

    const generateCard = await loadGenerator()

    // fake-ml bikin folder cache pakai path relatif ("fake-ml/"), sedangkan
    // di Vercel cuma /tmp yang writable. Pindah cwd dulu biar folder relatif
    // itu kebuat di /tmp/fake-ml, bukan di root project yang read-only.
    // Sengaja TIDAK di-restore sebelum baca file hasil, karena path relatif
    // yang dikembalikan package masih perlu di-resolve terhadap /tmp ini.
    try { process.chdir(TMP_DIR) } catch {}

    const result = await generateCard({ avatar, username, rank, border })

    const found = findImageResult(result)
    const buffer = await resolveBuffer(found)

    if (!buffer) {
      console.error('FAKEML unrecognized result shape:', JSON.stringify(result)?.slice(0, 2000))
      throw new Error('Fake ML gagal menghasilkan gambar (format hasil tidak dikenali)')
    }

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Disposition', 'inline; filename="fakeml.png"')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(buffer)
  } catch (err) {
    console.error('FAKEML ERROR:', err)
    return res.status(500).json({ status: false, message: 'Gagal membuat card', error: err.message })
  }
}
