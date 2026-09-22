import axios from 'axios';
import FormData from 'form-data';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { randomUUID } from 'node:crypto';

const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
};

const BASE_URL = 'https://www.free-ai-online.com';
const PAGE_URL = `${BASE_URL}/id/chatgpt-5-free/`;

/**
 * Session per userId: cookie jar + chatId + history, terisolasi satu sama lain.
 * CATATAN: serverless function itu stateless antar cold start — Map ini cuma
 * bertahan selama instance-nya masih "warm". Untuk memory permanen antar
 * request, ganti sessions Map ini dengan KV/Redis/DB eksternal.
 */
const sessions = new Map();

function getSession(userId) {
    if (!sessions.has(userId)) {
        const jar = new CookieJar();
        sessions.set(userId, {
            chatId: Math.random().toString(36).substring(2, 13),
            jar,
            client: wrapper(axios.create({ jar, maxRedirects: 5 })),
            messages: [
                {
                    id: randomUUID(),
                    role: 'assistant',
                    content: 'Hi! How can I help you?',
                    who: 'AI: ',
                    timestamp: Date.now(),
                },
            ],
            isFirst: true,
            sendImage: false,
            lastResponseData: null,
        });
    }
    return sessions.get(userId);
}

function parseEventStream(rawBody) {
    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf-8') : String(rawBody || '');
    let streamedText = '';
    let fullReply = '';
    let endObj;

    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.replace('data: ', '').trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
            const obj = JSON.parse(jsonStr);
            if (obj.type === 'live' && obj.data) streamedText += obj.data;
            if (obj.type === 'end' && obj.data) {
                const endParsed = JSON.parse(obj.data);
                if (endParsed.reply) fullReply = endParsed.reply;
                endObj = obj;
            }
        } catch {
            // lewati chunk SSE yang gagal di-parse
        }
    }

    return { reply: fullReply || streamedText, endObj };
}

async function sendMessage(session, newText, imageBuffer) {
    if (imageBuffer) session.sendImage = true;

    await session.client.get(PAGE_URL, { headers: COMMON_HEADERS });

    const startRes = await session.client.post(
        `${BASE_URL}/wp-json/mwai/v1/start_session/`,
        {},
        {
            headers: {
                ...COMMON_HEADERS,
                'Content-Type': 'application/json',
                Origin: BASE_URL,
                Referer: PAGE_URL,
            },
        }
    );
    const { sessionId, restNonce } = startRes.data;

    let imageData = {};
    if (imageBuffer) {
        const form = new FormData();
        form.append('file', imageBuffer, `photo_${Date.now()}.jpg`);
        form.append('type', 'N/A');
        form.append('purpose', 'N/A');
        const upload = await session.client.post(
            `${BASE_URL}/wp-json/mwai-ui/v1/files/upload`,
            form,
            {
                headers: {
                    Accept: '*/*',
                    ...form.getHeaders(),
                    Origin: BASE_URL,
                    Referer: PAGE_URL,
                    'User-Agent': COMMON_HEADERS['User-Agent'],
                    'X-Wp-Nonce': restNonce,
                },
            }
        );
        imageData = { id: upload.data.data.id, url: upload.data.data.url };
    }

    const payload = {
        botId: 'GPT-5',
        customId: null,
        session: sessionId,
        chatId: session.chatId,
        contextId: 62,
        messages: session.messages,
        newMessage: newText,
        newFileId: imageBuffer ? imageData.id : null,
        newFileIds: null,
        stream: true,
        ...(!session.isFirst && session.sendImage && session.lastResponseData
            ? {
                previousResponseId:
                    typeof session.lastResponseData === 'object'
                        ? JSON.parse(session.lastResponseData.data).responseId
                        : {},
            }
            : {}),
    };

    const submit = await session.client.post(
        `${BASE_URL}/wp-json/mwai-ui/v1/chats/submit/`,
        payload,
        {
            headers: {
                Accept: 'text/event-stream',
                'Accept-Language': 'en-US,en;q=0.5',
                'Content-Type': 'application/json',
                Origin: BASE_URL,
                Referer: PAGE_URL,
                'User-Agent': COMMON_HEADERS['User-Agent'],
                'X-Wp-Nonce': restNonce,
            },
        }
    );

    const { reply, endObj } = parseEventStream(submit.data);

    session.lastResponseData = endObj || session.lastResponseData;
    session.messages.push(
        {
            id: randomUUID(),
            role: 'user',
            content: newText,
            who: 'User: ',
            timestamp: Date.now(),
            ...(imageBuffer ? { userImages: [imageData.url] } : {}),
        },
        {
            id: randomUUID(),
            role: 'assistant',
            content: reply,
            who: 'AI: ',
            timestamp: Date.now(),
            isQuerying: false,
        }
    );
    session.isFirst = false;

    return { reply, imageData };
}

export default async function handler(req, res) {
    try {
        // Reset sesi: DELETE /api/gpt5?userId=xxx
        if (req.method === 'DELETE') {
            const userId = req.query.userId;
            if (!userId) {
                res.status(400).json({ status: false, message: "Parameter 'userId' wajib diisi." });
                return;
            }
            const existed = sessions.delete(userId);
            res.status(200).json({ status: true, reset: existed });
            return;
        }

        // Lihat histori: GET /api/gpt5?userId=xxx&history=1
        if (req.method === 'GET' && req.query.history) {
            const userId = req.query.userId;
            const session = sessions.get(userId);
            if (!session) {
                res.status(404).json({ status: false, message: 'Tidak ada sesi untuk userId ini.' });
                return;
            }
            res.status(200).json({ status: true, userId, messages: session.messages });
            return;
        }

        // Kirim pesan: GET /api/gpt5?userId=xxx&text=halo  atau  POST { userId, message, imageBase64 }
        const userId = req.method === 'POST' ? req.body?.userId : req.query.userId;
        const message = req.method === 'POST' ? req.body?.message : req.query.text;
        const imageBase64 = req.method === 'POST' ? req.body?.imageBase64 : null;

        if (!userId || typeof userId !== 'string') {
            res.status(400).json({ status: false, message: "Parameter 'userId' wajib diisi." });
            return;
        }
        if (!message || typeof message !== 'string' || !message.trim()) {
            res.status(400).json({ status: false, message: "Parameter 'message' wajib diisi." });
            return;
        }

        const session = getSession(userId);
        const imageBuffer = imageBase64 ? Buffer.from(imageBase64, 'base64') : null;

        const { reply, imageData } = await sendMessage(session, message.trim(), imageBuffer);

        res.status(200).json({
            status: true,
            userId,
            reply,
            image: imageData?.url || null,
        });
    } catch (err) {
        console.error(err?.response?.data || err.message || err);
        res.status(500).json({
            status: false,
            message: 'Gagal mendapat balasan dari layanan upstream',
            error: err?.response?.data || err.message,
        });
    }
}
