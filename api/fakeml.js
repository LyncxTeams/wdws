const RANKS = ['epic', 'glory', 'gm', 'honor', 'imo', 'legend', 'mawi']
const FALLBACK_AVATAR = 'https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Image/artworks-gWLRE6HyPH3DgVMG-ZFFxtg-t500x500.jpg'

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

// Mendukung dua bentuk hasil fake-ml: buffer langsung, atau { data: { image } }
function extractBuffer(result) {
  if (!result) return null
  if (Buffer.isBuffer(result)) return result
  const image = result.data?.image ?? result.image
  if (!image) return null
  return Buffer.isBuffer(image) ? image : Buffer.from(image)
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
    const result = await generateCard({ avatar, username, rank, border })

    const buffer = extractBuffer(result)
    if (!buffer) {
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
