import generateFF from 'fake-ff'
import fs from 'fs/promises'
import path from 'path'

// Vercel serverless functions hanya boleh nulis ke /tmp
const OUTPUT_DIR = '/tmp/fake-ff'

async function getInput(req) {
  if (req.method === 'GET') return req.query || {}
  let body = req.body || {}
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch {}
  }
  return body
}

// fake-ff bisa mengembalikan path file (result.data.image / result.result)
// tergantung versi paketnya — dukung dua-duanya biar aman.
function extractImagePath(result) {
  return result?.data?.image || result?.result || null
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ status: false, message: 'Method Not Allowed' })
  }

  let filePath

  try {
    const input = await getInput(req)

    const username = String(input.username || input.name || '').trim().slice(0, 20)
    if (!username) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'username' wajib diisi.",
        example: '/api/fakeff?username=Gwok&lobby=5'
      })
    }

    let lobby = parseInt(input.lobby, 10)
    if (!Number.isInteger(lobby) || lobby < 1 || lobby > 30) lobby = undefined // biar fake-ff yang random

    await fs.mkdir(OUTPUT_DIR, { recursive: true })

    const result = await generateFF({
      username,
      ...(lobby ? { lobby } : {}),
      outputDir: OUTPUT_DIR
    })

    if (!result || (result.status !== true && result.status !== 'success')) {
      throw new Error('Fake FF gagal menghasilkan gambar')
    }

    const imagePath = extractImagePath(result)
    if (!imagePath) throw new Error('Fake FF tidak mengembalikan path gambar')

    filePath = path.resolve(imagePath)
    const buffer = await fs.readFile(filePath)

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Disposition', 'inline; filename="fakeff.png"')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(buffer)
  } catch (err) {
    console.error('FAKEFF ERROR:', err)
    return res.status(500).json({ status: false, message: 'Gagal membuat fake lobby FF', error: err.message })
  } finally {
    if (filePath) {
      try { await fs.unlink(filePath) } catch {}
    }
  }
}
