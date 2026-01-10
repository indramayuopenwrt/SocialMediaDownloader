const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(Number);
const WEBHOOK_URL = process.env.WEBHOOK_URL; // https://xxxx.up.railway.app
const PORT = process.env.PORT || 3000;

/* ================= BOT ================= */
const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);

app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (_, res) => res.send('✅ Bot alive'));

app.listen(PORT, () => console.log('🚀 Webhook running on port', PORT));

/* ================= CONFIG ================= */
const TMP_DIR = './tmp';
const MAX_QUEUE = 3;
const USER_LIMIT = 5;
const CACHE_TTL = 1000 * 60 * 60;

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

/* ================= STATE ================= */
const queue = [];
let running = 0;
const userUsage = new Map();
const metaCache = new Map();

/* ================= UTILS ================= */
const hash = s => crypto.createHash('md5').update(s).digest('hex');

function isAdmin(id) {
  return ADMIN_IDS.includes(id);
}

function canUse(id) {
  if (isAdmin(id)) return true;
  const used = userUsage.get(id) || 0;
  if (used >= USER_LIMIT) return false;
  userUsage.set(id, used + 1);
  return true;
}

function cleanup() {
  for (const f of fs.readdirSync(TMP_DIR)) {
    const p = path.join(TMP_DIR, f);
    if (Date.now() - fs.statSync(p).mtimeMs > CACHE_TTL) {
      fs.unlinkSync(p);
    }
  }
}

/* ================= CAPTION ================= */
function buildCaption(meta) {
  return [
    `🎬 ${meta.platform}`,
    meta.author ? `👤 ${meta.author}` : null,
    meta.description ? `📝 ${meta.description}` : null,
    meta.views || meta.likes
      ? `👁️ ${meta.views || '-'}   👍 ${meta.likes || '-'}`
      : null,
    `⏱️ ${meta.duration || '-'} detik`,
    meta.size ? `📦 ${meta.size}` : null,
    meta.url ? `🔗 ${meta.url}` : null
  ]
    .filter(Boolean)
    .join('\n');
}

function detectPlatform(url) {
  if (/tiktok/i.test(url)) return 'TikTok';
  if (/facebook|fb/i.test(url)) return 'Facebook';
  if (/instagram/i.test(url)) return 'Instagram';
  if (/youtu/i.test(url)) return 'YouTube';
  return 'Video';
}

/* ================= META ================= */
function extractMeta(url) {
  if (metaCache.has(url)) return Promise.resolve(metaCache.get(url));

  return new Promise(resolve => {
    exec(`yt-dlp -j "${url}"`, (e, out) => {
      if (e) return resolve({ platform: detectPlatform(url), url });
      const i = JSON.parse(out);
      const meta = {
        platform: detectPlatform(url),
        author: i.uploader || i.channel,
        description: i.description || i.title,
        views: i.view_count ? `${Math.round(i.view_count / 1000)}K` : null,
        likes: i.like_count ? `${Math.round(i.like_count / 1000)}K` : null,
        duration: i.duration ? i.duration.toFixed(2) : null,
        size: i.filesize_approx
          ? `${(i.filesize_approx / 1024 / 1024).toFixed(2)} MB`
          : null,
        url
      };
      metaCache.set(url, meta);
      resolve(meta);
    });
  });
}

/* ================= YT-DLP ================= */
function runYtdlp(url, isMp3, onProgress) {
  return new Promise((resolve, reject) => {
    const id = hash(url);
    const out = `${TMP_DIR}/${id}.%(ext)s`;

    const cmd = [
      'yt-dlp',
      '--newline',
      '--no-playlist',
      isMp3 ? '-x --audio-format mp3' : '-f bestvideo+bestaudio/best',
      `-o "${out}"`,
      `"${url}"`
    ].join(' ');

    const p = exec(cmd);
    let lastUpdate = 0;

    p.stdout.on('data', d => {
      const line = d.toString();
      const m = line.match(/(\d+\.\d+)%.*?(\d+(\.\d+)?)(KiB|MiB)\/s.*?ETA\s+(\d+:\d+)/);
      if (m && Date.now() - lastUpdate > 3000) {
        lastUpdate = Date.now();
        onProgress(`${m[1]}%`, `${m[2]} ${m[4]}/s`, m[5]);
      }
    });

    p.on('close', code => {
      if (code !== 0) return reject();
      const file = fs.readdirSync(TMP_DIR).find(f => f.startsWith(id));
      resolve(path.join(TMP_DIR, file));
    });
  });
}

/* ================= QUEUE ================= */
async function processQueue() {
  if (running >= MAX_QUEUE || queue.length === 0) return;
  running++;

  const job = queue.shift();
  try {
    const meta = await extractMeta(job.url);

    const msg = await bot.sendMessage(job.chat, '⏳ Downloading...\n0%');

    const file = await runYtdlp(job.url, job.mp3, async (p, speed, eta) => {
      await bot.editMessageText(
        `⏳ Downloading...\n${p}\n⚡ ${speed}\n⏱️ ETA ${eta}`,
        { chat_id: job.chat, message_id: msg.message_id }
      );
    });

    await bot.sendDocument(job.chat, file, {
      caption: buildCaption(meta)
    });
  } catch {
    bot.sendMessage(job.chat, '❌ Gagal download');
  } finally {
    running--;
    cleanup();
    processQueue();
  }
}

/* ================= COMMANDS ================= */
bot.onText(/\/start/, m => {
  bot.sendMessage(
    m.chat.id,
    `👋 Welcome SocialMediaDownloader

📥 Kirim link TikTok / FB / IG / YT
🎵 /mp3 <link> → audio only
📊 /stats → statistik bot`
  );
});

bot.onText(/\/stats/, m => {
  bot.sendMessage(
    m.chat.id,
    `📊 Statistik Bot
Queue: ${queue.length}
Running: ${running}
Cache: ${metaCache.size}`
  );
});

bot.onText(/\/mp3 (.+)/, (m, g) => {
  if (!canUse(m.from.id))
    return bot.sendMessage(m.chat.id, '❌ Limit tercapai');
  queue.push({ chat: m.chat.id, url: g[1], mp3: true });
  processQueue();
});

bot.on('message', m => {
  if (!m.text || m.text.startsWith('/')) return;
  if (!canUse(m.from.id))
    return bot.sendMessage(m.chat.id, '❌ Limit tercapai');
  queue.push({ chat: m.chat.id, url: m.text, mp3: false });
  processQueue();
});

/* ================= CLEANER ================= */
setInterval(cleanup, 1000 * 60 * 10);
console.log('✅ Bot READY (Webhook mode)');
