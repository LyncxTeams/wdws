import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import axios from 'axios';

const ASSETS_DIR = join('/tmp', 'fakegc');
const FONTS_DIR = join(ASSETS_DIR, 'fonts');
const BG_LOCAL = join(ASSETS_DIR, 'bg_fakegc.jpg');
const BG_URL = 'https://raw.githubusercontent.com/ryyntwx/Image-rinn/refs/heads/main/IMG-20260825-WA0312.jpg';
const FONT_URL = 'https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7W0Q5nw.woff2';
let fontReady = false;

async function ensureAssets() {
    await mkdir(FONTS_DIR, { recursive: true });
    const fontPath = join(FONTS_DIR, 'Inter.woff2');
    if (!existsSync(fontPath)) {
        const r = await axios.get(FONT_URL, { responseType: 'arraybuffer' });
        await writeFile(fontPath, Buffer.from(r.data));
    }
    if (!fontReady) {
        GlobalFonts.registerFromPath(fontPath, 'Inter');
        fontReady = true;
    }
    if (!existsSync(BG_LOCAL)) {
        const r = await axios.get(BG_URL, { responseType: 'arraybuffer' });
        await writeFile(BG_LOCAL, Buffer.from(r.data));
    }
}

function dataToBuffer(value) {
    if (typeof value !== 'string') return null;
    if (value.startsWith('data:')) {
        const match = value.match(/^data:[^;]+;base64,(.+)$/);
        return match ? Buffer.from(match[1], 'base64') : null;
    }
    return null;
}

async function getImage(value) {
    const data = dataToBuffer(value);
    if (data) return loadImage(data);
    if (/^https?:\/\//i.test(value)) {
        const r = await axios.get(value, {
            responseType: 'arraybuffer',
            timeout: 15000,
            maxContentLength: 10 * 1024 * 1024,
            maxBodyLength: 10 * 1024 * 1024,
            headers: { 'User-Agent': 'Vercel-FakeGC/1.0' }
        });
        const contentType = String(r.headers['content-type'] || '').toLowerCase();
        if (!contentType.startsWith('image/')) throw new Error('URL image tidak mengarah ke file gambar.');
        return loadImage(Buffer.from(r.data));
    }
    return null;
}

async function generateFakeGc(name, members, pp) {
    await ensureAssets();
    const bg = await loadImage(BG_LOCAL);
    const avatar = await getImage(pp);
    if (!avatar) throw new Error('PP harus berupa URL gambar atau data:image/...;base64,...');

    const canvas = createCanvas(bg.width, bg.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.beginPath();
    ctx.arc(538, 362, 162, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, 376, 200, 324, 324);
    ctx.restore();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 64px Inter';
    ctx.fillText(name, 540, 602);

    const prefix = 'Grup • ';
    ctx.font = '500 37px Inter';
    const pw = ctx.measureText(prefix).width;
    const mw = ctx.measureText(members).width;
    const startX = 548 - ((pw + mw) / 2);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#8E8E93';
    ctx.fillText(prefix, startX, 684);
    ctx.fillStyle = '#34C759';
    ctx.fillText(members, startX + pw, 684);

    return canvas.encode('png');
}

export default async function handler(req, res) {
    try {
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch {}
        }

        const name = String(req.method === 'GET' ? req.query.name || '' : body.name || '').trim();
        const members = String(req.method === 'GET' ? req.query.members || '' : body.members || '').trim();
        const pp = String(req.method === 'GET' ? (req.query.image || req.query.pp || '') : (body.image || body.pp || '')).trim();

        if (!name || !members || !pp) {
            res.status(400).json({
                status: false,
                message: 'Parameter name, members, dan image wajib diisi.',
                example: '/api/fakegc?name=RIN%20MD%20OFFICIAL&members=2%20anggota&image=https://example.com/avatar.jpg'
            });
            return;
        }

        if (name.length > 80 || members.length > 40) {
            res.status(400).json({ status: false, message: 'Nama grup atau jumlah anggota terlalu panjang.' });
            return;
        }

        const buffer = await generateFakeGc(name, members, pp);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', 'inline; filename="fakegc.png"');
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send(buffer);
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: false, message: 'Gagal membuat Fake GC', error: err.message });
    }
}
