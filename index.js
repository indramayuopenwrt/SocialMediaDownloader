/* =========================================================
   TELEGRAM VIDEO DOWNLOADER BOT – FINAL PRODUCTION
   Webhook • Queue • Cache • Progress Animation
========================================================= */

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

/* ===================== ENV ===================== */
const BOT_TOKEN = process.env.BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(Number);
const PORT = process.env.PORT || 8080;

if (!BOT_TOKEN || !PUBLIC_URL) {
  console.error('❌ BOT_TOKEN / PUBLIC_URL belum di-set');
  process.exit(1);
}

/* ===================== BOT & SERVER ===================== */
const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

/* ===================== PATH ===================== */
const TMP = './tmp';
const FILE_DIR = path.join(TMP, 'files');
const META_FILE = path.join(TMP, 'meta.json');

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);
if (!fs.existsSync(FILE_DIR)) fs.mkdirSync(FILE_DIR);
if (!fs.existsSync(META_FILE)) fs.writeFileSync(META_FILE, '{}');

/* ===================== STATE ===================== */
const queue = [];
let running = 0;
const MAX_RUNNING = 2;
const USER_LIMIT = 30;
const userUsage = new Map();

/* ===================== UTIL ===================== */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = s => crypto.createHash('md5').update(s).digest('hex');
const isAdmin = id => ADMIN_IDS.includes(id);

/* ===================== SAFE SEND (ANTI 429) ===================== */
let lastSend = 0;
async function safeSend(fn) {
  const now = Date.now();
  if (now - lastSend < 1100) await sleep(1100);
  lastSend = Date.now();
  return fn();
}

/* ===================== CACHE ===================== */
function loadMeta() {
  return JSON.parse(fs.readFileSync(META_FILE));
}
function saveMeta(data) {
  fs.writeFileSync(META_FILE, JSON.stringify(data, null, 2));
}

/* ===================== METADATA ===================== */
async function fetchMeta(url) {
  const key = hash(url);
  const cache = loadMeta();
  if (cache[key]) return cache[key];

  return new Promise(resolve => {
    const p = spawn('yt-dlp', ['-J', '--no-playlist', url]);
    let out = '';

    p.stdout.on('data', d => out += d.toString());
    p.on('close', () => {
      try {
        const j = JSON.parse(out);
        const meta = {
          title: j.title || 'Video',
          author: j.uploader || j.channel || '-',
          views: j.view_count || 0,
          duration: j.duration || '-'
        };
        cache[key] = meta;
        saveMeta(cache);
        resolve(meta);
      } catch {
        resolve({});
      }
    });
  });
}

/* ===================== CAPTION ===================== */
function buildCaption(m) {
  return (
`🎬 ${m.title}
👤 ${m.author}
👁️ ${m.views.toLocaleString()} views
⏱️ ${m.duration} detik`
  );
}

/* ===================== PROGRESS BAR ===================== */
function progressBar(percent, frame) {
  const total = 10;
  const filled = Math.round((percent / 100) * total);
  const anim = ['⏳','⌛','⏰'][frame % 3];
  return `${anim} ${percent.toFixed(1)}%\n${'█'.repeat(filled)}${'░'.repeat(total - filled)}`;
}

/* ===================== DOWNLOAD ===================== */
function cachedFile(url, mp3) {
  const ext = mp3 ? 'mp3' : 'mp4';
  const f = path.join(FILE_DIR, `${hash(url)}.${ext}`);
  return fs.existsSync(f) ? f : null;
}

async function download(url, mp3, onProgress) {
  const output = path.join(FILE_DIR, `${hash(url)}.%(ext)s`);
  const args = ['--newline', '--no-playlist', '-o', output, url];
  if (mp3) args.unshift('-x', '--audio-format', 'mp3');

  return new Promise((resolve, reject) => {
    const p = spawn('yt-dlp', args);
    let frame = 0;

    p.stdout.on('data', d => {
      const m = d.toString().match(/(\d+\.\d+)%/);
      if (m) onProgress(parseFloat(m[1]), frame++);
    });

    p.on('close', c => {
      if (c !== 0) return reject();
      const file = fs.readdirSync(FILE_DIR).find(v => v.startsWith(hash(url)));
      resolve(path.join(FILE_DIR, file));
    });
  });
}

/* ===================== QUEUE ===================== */
async function processQueue() {
  if (running >= MAX_RUNNING || queue.length === 0) return;
  running++;

  const job = queue.shift();
  try {
    const meta = await fetchMeta(job.url);

    const msg = await safeSend(() =>
      bot.sendMessage(job.chat, '⏳ Downloading...\n0%')
    );

    let lastEdit = 0;
    const file =
      cachedFile(job.url, job.mp3) ||
      await download(job.url, job.mp3, async (p, f) => {
        if (Date.now() - lastEdit > 5000 && p < 100) {
          lastEdit = Date.now();
          await safeSend(() =>
            bot.editMessageText(progressBar(p, f), {
              chat_id: job.chat,
              message_id: msg.message_id
            })
          );
        }
      });

    await safeSend(() =>
      bot.sendDocument(job.chat, file, { caption: buildCaption(meta) })
    );

    await safeSend(() =>
      bot.deleteMessage(job.chat, msg.message_id)
    );

  } catch {
    await safeSend(() =>
      bot.sendMessage(job.chat, '❌ Gagal memproses video')
    );
  } finally {
    running--;
    processQueue();
  }
}

/* ===================== LIMIT ===================== */
function canUse(id) {
  if (isAdmin(id)) return true;
  const used = userUsage.get(id) || 0;
  if (used >= USER_LIMIT) return false;
  userUsage.set(id, used + 1);
  return true;
}

/* ===================== COMMAND ===================== */
bot.onText(/\/start/, m => {
  bot.sendMessage(m.chat.id,
`👋 Welcome Downloader Bot
📥 Kirim link TikTok / IG / FB / YT
🎵 /mp3 <link>
📊 /stats`);
});

bot.onText(/\/stats/, m => {
  bot.sendMessage(m.chat.id,
`📊 STATUS BOT
Queue : ${queue.length}
Running : ${running}
Cache : ${fs.readdirSync(FILE_DIR).length}`);
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

/* ===================== WEBHOOK ===================== */
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, async () => {
  await bot.setWebHook(`${PUBLIC_URL}/bot${BOT_TOKEN}`);
  console.log('✅ BOT WEBHOOK RUNNING');
});
