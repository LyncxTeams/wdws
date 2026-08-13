import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import axios from 'axios';
import sharp from 'sharp';

// Vercel serverless functions only allow writing to /tmp — semua cache disimpan di sana.
const ASSETS_DIR = join('/tmp', 'wdws_meme');
const FONTS_DIR = join(ASSETS_DIR, 'fonts');
const EMOJI_DIR = join(ASSETS_DIR, 'emoji_cache');
const BG_LOCAL = join(ASSETS_DIR, 'template_wdws.png');
const BG_URL = 'https://raw.githubusercontent.com/ryyntwx/allimagerin/refs/heads/main/wdws.png';

const FONT_URL = 'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZ9hiJ-Ek-_EeA.woff2';
const FONT_FAMILY = 'InterBoldMeme';

let fontRegistered = false;

async function ensureAssets() {
    await mkdir(FONTS_DIR, { recursive: true });
    await mkdir(EMOJI_DIR, { recursive: true });

    const fPath = join(FONTS_DIR, 'Inter-Bold.ttf');
    if (!existsSync(fPath)) {
        const fRes = await axios.get(FONT_URL, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
        await writeFile(fPath, Buffer.from(fRes.data));
    }
    if (!fontRegistered) {
        GlobalFonts.registerFromPath(fPath, FONT_FAMILY);
        fontRegistered = true;
    }

    if (!existsSync(BG_LOCAL)) {
        const res = await axios.get(BG_URL, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
        await writeFile(BG_LOCAL, Buffer.from(res.data));
    }
}

const EMOJI_REGEX = /(\p{Extended_Pictographic}\uFE0F?(\u200D\p{Extended_Pictographic}\uFE0F?)*)/gu;

function tokenizeWord(str) {
    const tokens = [];
    let lastIndex = 0;
    let match;
    EMOJI_REGEX.lastIndex = 0;
    while ((match = EMOJI_REGEX.exec(str)) !== null) {
        if (match.index > lastIndex) tokens.push({ type: 'text', value: str.slice(lastIndex, match.index) });
        tokens.push({ type: 'emoji', value: match[0] });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < str.length) tokens.push({ type: 'text', value: str.slice(lastIndex) });
    return tokens;
}

async function generateWdws(rawText) {
    await ensureAssets();

    const bgImg = await loadImage(BG_LOCAL);
    const canvas = createCanvas(bgImg.width, bgImg.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);

    const x = 127;
    const y = 406;
    const w = 450;
    const h = 601;
    let fSize = 150;
    const lHeight = 1.3;

    ctx.fillStyle = '#1c1d21';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const rawWords = rawText.split(/\s+/).filter((ww) => ww.length > 0);
    const wordTokens = rawWords.map((ww) => tokenizeWord(ww));

    const uniqueEmojis = new Set();
    for (const tokens of wordTokens) {
        for (const t of tokens) if (t.type === 'emoji') uniqueEmojis.add(t.value);
    }

    const emojiRawBuffers = new Map();
    for (const emo of uniqueEmojis) {
        const hex = [...emo].map((c) => c.codePointAt(0).toString(16)).join('-');
        const cachePath = join(EMOJI_DIR, `${hex}.png`);
        try {
            if (existsSync(cachePath)) {
                emojiRawBuffers.set(emo, await readFile(cachePath));
            } else {
                const res = await axios.get(`https://emojicdn.elk.sh/${encodeURIComponent(emo)}?style=apple`, {
                    responseType: 'arraybuffer',
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                });
                const buf = Buffer.from(res.data);
                await writeFile(cachePath, buf);
                emojiRawBuffers.set(emo, buf);
            }
        } catch (e) {
            emojiRawBuffers.set(emo, null);
        }
    }

    const resizedEmojiCache = new Map();
    async function getEmojiImage(emo, size) {
        const key = `${emo}_${size}`;
        if (resizedEmojiCache.has(key)) return resizedEmojiCache.get(key);
        const raw = emojiRawBuffers.get(emo);
        if (!raw) return null;
        const resized = await sharp(raw).resize(size, size, { fit: 'contain' }).png().toBuffer();
        const img = await loadImage(resized);
        resizedEmojiCache.set(key, img);
        return img;
    }

    function measureWordWidth(tokens, size) {
        let total = 0;
        for (const t of tokens) {
            total += t.type === 'text' ? ctx.measureText(t.value).width : size;
        }
        return total;
    }

    function buildLines(size) {
        ctx.font = `700 ${size}px ${FONT_FAMILY}`;
        const spaceWidth = ctx.measureText(' ').width;
        const lines = [];
        let currentLine = [];
        let currentWidth = 0;

        for (const tokens of wordTokens) {
            const wordWidth = measureWordWidth(tokens, size);
            const addedWidth = currentLine.length === 0 ? wordWidth : currentWidth + spaceWidth + wordWidth;

            if (addedWidth > w && currentLine.length > 0) {
                lines.push({ words: currentLine, width: currentWidth });
                currentLine = [tokens];
                currentWidth = wordWidth;
            } else {
                currentLine.push(tokens);
                currentWidth = addedWidth;
            }
        }
        if (currentLine.length > 0) lines.push({ words: currentLine, width: currentWidth });
        return { lines, spaceWidth };
    }

    let { lines, spaceWidth } = buildLines(fSize);
    let totalTextHeight = lines.length * (fSize * lHeight);

    while (totalTextHeight > h && fSize > 24) {
        fSize -= 4;
        ({ lines, spaceWidth } = buildLines(fSize));
        totalTextHeight = lines.length * (fSize * lHeight);
    }

    ctx.font = `700 ${fSize}px ${FONT_FAMILY}`;

    let startY = y;
    if (totalTextHeight < h) startY = y + (h - totalTextHeight) / 2;

    const wordCount = rawWords.length;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const currentY = startY + index * (fSize * lHeight);
        if (currentY + fSize > y + h) continue;

        let cursorX = wordCount === 1 ? x + (w - line.width) / 2 : x;

        for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
            const tokens = line.words[wIdx];
            for (const t of tokens) {
                if (t.type === 'text') {
                    ctx.fillText(t.value, cursorX, currentY);
                    cursorX += ctx.measureText(t.value).width;
                } else {
                    const img = await getEmojiImage(t.value, fSize);
                    if (img) ctx.drawImage(img, cursorX, currentY, fSize, fSize);
                    cursorX += fSize;
                }
            }
            if (wIdx < line.words.length - 1) cursorX += spaceWidth;
        }
    }

    return canvas.encode('png');
}

export default async function handler(req, res) {
    try {
        const text = req.method === 'POST' ? req.body?.text : req.query.text;

        if (!text || typeof text !== 'string' || !text.trim()) {
            res.status(400).json({
                status: false,
                message: "Parameter 'text' wajib diisi. Contoh: /api/wq?text=halo dunia",
            });
            return;
        }

        if (text.length > 300) {
            res.status(400).json({ status: false, message: "Teks terlalu panjang (maks 300 karakter)." });
            return;
        }

        const buffer = await generateWdws(text.trim());

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send(buffer);
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: false, message: 'Terjadi kesalahan saat memproses gambar', error: err.message });
    }
}
