/* ================== IMPORT ================== */
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ================== ENV ================== */
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(x => Number(x.trim()));
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const COOKIES = process.env.COOKIES || '';

if (!BOT_TOKEN || !WEBHOOK_URL) {
  console.error('❌ BOT_TOKEN / WEBHOOK_URL missing');
  process.exit(1);
}

/* ================== INIT ================== */
const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
bot.setWebHook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);

app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (_, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 Bot webhook running on', PORT));

/* ================== CONFIG ================== */
const TMP_DIR = './tmp';
const MAX_QUEUE = 3;
const USER_LIMIT = 5;
const CACHE_TTL = 1000 * 60 * 60;

/* ================== STATE ================== */
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const queue = [];
let running = 0;
const userUsage = new Map();
const metaCache = new Map();
const fileCache = new Map();

/* ================== UTILS ================== */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = s => crypto.createHash('md5').update(s).digest('hex');

const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

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

function progressBar(p) {
  const total = 20;
  const filled = Math.round((p / 100) * total);
  return '█'.repeat(filled) + '░'.repeat(total - filled);
}

/* ================== PLATFORM ================== */
function detectPlatform(url) {
  if (/tiktok/i.test(url)) return 'TikTok';
  if (/facebook|fb/i.test(url)) return 'Facebook';
  if (/instagram|ig/i.test(url)) return 'Instagram';
  if (/youtu/i.test(url)) return 'YouTube';
  return 'Video';
}

/* ================== CAPTION ================== */
function buildCaption(m) {
  return [
    `🎬 ${m.platform} Video`,
    '',
    m.author ? `👤 ${m.author}` : '',
    m.description ? `📝 ${m.description}` : '',
    '',
    `👁️ ${m.views || '-'}   👍 ${m.likes || '-'}`,
    `⏱️ ${m.duration || '-'} detik`,
    `📦 ${m.size || '-'}`
  ].filter(Boolean).join('\n');
}

/* ================== METADATA ================== */
function extractMeta(url) {
  if (metaCache.has(url)) return Promise.resolve(metaCache.get(url));

  return new Promise(resolve => {
    exec(`yt-dlp -j "${url}"`, (e, out) => {
      if (e) return resolve({});
      const i = JSON.parse(out);
      const meta = {
        platform: detectPlatform(url),
        author: i.uploader || i.channel,
        description: (i.description || i.title || '').slice(0, 300),
        views: i.view_count ? `${Math.round(i.view_count / 1000)}K` : null,
        likes: i.like_count ? `${Math.round(i.like_count / 1000)}K` : null,
        duration: i.duration ? i.duration.toFixed(1) : null,
        size: i.filesize_approx
          ? `${(i.filesize_approx / 1024 / 1024).toFixed(2)} MB`
          : null
      };
      metaCache.set(url, meta);
      resolve(meta);
    });
  });
}

/* ================== YT-DLP ================== */
function runYtdlp(url, mp3, onProgress) {
  return new Promise((resolve, reject) => {
    const id = hash(url);
    const out = `${TMP_DIR}/${id}.%(ext)s`;

    const cmd = [
      'yt-dlp',
      COOKIES ? `--cookies ${COOKIES}` : '',
      '--newline',
      '--no-playlist',
      mp3 ? '-x --audio-format mp3' : '-f bestvideo+bestaudio/best',
      `-o "${out}"`,
      `"${url}"`
    ].join(' ');

    const p = exec(cmd);
    p.stdout.on('data', d => {
      const m = d.toString().match(/(\d+\.\d+)%.*?(\d+(\.\d+)?)(MiB|KiB)\/s.*?ETA\s+(\d+:\d+)/);
      if (m) onProgress(Number(m[1]), `${m[2]} ${m[4]}/s`, m[5]);
    });

    p.on('close', c => {
      if (c !== 0) return reject();
      const file = fs.readdirSync(TMP_DIR).find(f => f.startsWith(id));
      resolve(path.join(TMP_DIR, file));
    });
  });
}

/* ================== QUEUE ================== */
async function processQueue() {
  if (running >= MAX_QUEUE || queue.length === 0) return;
  running++;

  const job = queue.shift();
  try {
    const meta = await extractMeta(job.url);
    let lastEdit = 0;
    let spin = 0;

    const msg = await bot.sendMessage(job.chat, '⏳ Starting...');

    const file = await runYtdlp(job.url, job.mp3, async (p, speed, eta) => {
      if (Date.now() - lastEdit < 5000) return;
      lastEdit = Date.now();

      await bot.editMessageText(
        `⏳ Downloading ${SPINNER[spin++ % SPINNER.length]}\n` +
        `${progressBar(p)} ${Math.floor(p)}%\n` +
        `📶 ${speed}\n🧠 ETA ${eta}`,
        { chat_id: job.chat, message_id: msg.message_id }
      );
    });

    await bot.sendDocument(job.chat, file, { caption: buildCaption(meta) });
    fileCache.set(job.url, file);

  } catch {
    bot.sendMessage(job.chat, '❌ Gagal download');
  } finally {
    running--;
    cleanup();
    processQueue();
  }
}

/* ================== BOT COMMAND ================== */
bot.onText(/\/start/, m => {
  bot.sendMessage(m.chat.id,
`👋 Welcome Downloader Bot

📥 Kirim link TikTok / IG / FB / YT
🎵 /mp3 <link> audio only
📊 /stats statistik bot`
  );
});

bot.onText(/\/stats/, m => {
  bot.sendMessage(m.chat.id,
`📊 Statistik
Queue: ${queue.length}
Running: ${running}
Cache: ${fileCache.size}`
  );
});

bot.onText(/\/mp3 (.+)/, (m, g) => {
  if (!canUse(m.from.id)) return bot.sendMessage(m.chat.id, '❌ Limit tercapai');
  queue.push({ chat: m.chat.id, url: g[1], mp3: true });
  processQueue();
});

bot.on('message', m => {
  if (!m.text || m.text.startsWith('/')) return;
  if (!canUse(m.from.id)) return bot.sendMessage(m.chat.id, '❌ Limit tercapai');
  queue.push({ chat: m.chat.id, url: m.text, mp3: false });
  processQueue();
});

/* ================== CLEANER ================== */
setInterval(cleanup, 10 * 60 * 1000);
