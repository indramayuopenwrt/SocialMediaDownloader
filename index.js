const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(Number);
const COOKIES = process.env.COOKIES || '';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN belum di set');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/* ================= CONFIG ================= */
const TMP_DIR = './tmp';
const MAX_QUEUE = 3;
const USER_LIMIT = 5;
const CACHE_TTL = 1000 * 60 * 60;

/* ================= STATE ================= */
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const queue = [];
let running = 0;

const userUsage = new Map();
const metaCache = new Map();
const fileCache = new Map();

/* ================= UTILS ================= */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = s => crypto.createHash('md5').update(s).digest('hex');

const SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

function isAdmin(id) {
  return ADMIN_IDS.includes(id);
}

function canUse(userId) {
  if (isAdmin(userId)) return true;
  const used = userUsage.get(userId) || 0;
  if (used >= USER_LIMIT) return false;
  userUsage.set(userId, used + 1);
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

function progressBar(percent) {
  const total = 20;
  const filled = Math.round((percent / 100) * total);
  return '█'.repeat(filled) + '░'.repeat(total - filled);
}

/* ================= PLATFORM ================= */
function detectPlatform(url) {
  if (/tiktok/i.test(url)) return 'TikTok';
  if (/facebook|fb/i.test(url)) return 'Facebook';
  if (/instagram|ig/i.test(url)) return 'Instagram';
  if (/youtu/i.test(url)) return 'YouTube';
  return 'Video';
}

/* ================= CAPTION ================= */
function buildCaption(meta) {
  const lines = [];

  lines.push(`🎬 ${meta.platform}`);
  if (meta.author) lines.push(`👤 ${meta.author}`);

  lines.push('');

  if (meta.title) lines.push(`📌 ${meta.title}`);
  if (meta.description && meta.description !== meta.title)
    lines.push(`📝 ${meta.description}`);

  lines.push('');

  if (meta.views || meta.likes) {
    lines.push(`👁️ ${meta.views || '-'}   👍 ${meta.likes || '-'}`);
  }

  lines.push(`⏱️ ${meta.duration || '-'} detik`);
  lines.push(`📦 ${meta.size || '-'}`);

  return lines.join('\n');
}

/* ================= META ================= */
function extractMeta(url) {
  if (metaCache.has(url)) return Promise.resolve(metaCache.get(url));

  return new Promise(resolve => {
    exec(`yt-dlp -j "${url}"`, (e, out) => {
      if (e) return resolve({ platform: detectPlatform(url) });

      const i = JSON.parse(out);
      const meta = {
        platform: detectPlatform(url),
        title: i.title,
        author: i.uploader || i.channel,
        description: i.description
          ? i.description.slice(0, 400)
          : null,
        views: i.view_count
          ? `${Math.round(i.view_count / 1000)}K`
          : null,
        likes: i.like_count
          ? `${Math.round(i.like_count / 1000)}K`
          : null,
        duration: i.duration || null,
        size: i.filesize_approx
          ? `${(i.filesize_approx / 1024 / 1024).toFixed(2)} MB`
          : null
      };

      metaCache.set(url, meta);
      resolve(meta);
    });
  });
}

/* ================= YT-DLP ================= */
function runYtdlp(url, isMp3, progressCb) {
  return new Promise((resolve, reject) => {
    const id = hash(url);
    const out = `${TMP_DIR}/${id}.%(ext)s`;

    const cmd = [
      'yt-dlp',
      '--newline',
      '--no-playlist',
      COOKIES ? `--cookies "${COOKIES}"` : '',
      isMp3 ? '-x --audio-format mp3' : '-f bestvideo+bestaudio/best',
      `-o "${out}"`,
      `"${url}"`
    ].join(' ');

    let lastPercent = 0;
    let lastTime = Date.now();

    const p = exec(cmd);

    p.stdout.on('data', d => {
      const line = d.toString();
      const m = line.match(/(\d+(?:\.\d+)?)%.*?([\d.]+\w+\/s).*?ETA\s+([\d:]+)/);

      if (m) {
        const percent = parseFloat(m[1]);
        const speed = m[2];
        const eta = m[3];

        if (percent !== lastPercent || Date.now() - lastTime > 4000) {
          lastPercent = percent;
          lastTime = Date.now();
          progressCb(percent, speed, eta);
        }
      }
    });

    p.on('close', code => {
      if (code !== 0) return reject();

      const file = fs
        .readdirSync(TMP_DIR)
        .find(f => f.startsWith(id));

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

    let spinnerIndex = 0;
    let lastEdit = 0;

    const msg = await bot.sendMessage(
      job.chat,
      '⏳ Downloading...\n0%'
    );

    const file = await runYtdlp(
      job.url,
      job.mp3,
      async (percent, speed, eta) => {
        if (Date.now() - lastEdit < 5000) return;
        lastEdit = Date.now();

        const spinner =
          SPINNER_FRAMES[spinnerIndex++ % SPINNER_FRAMES.length];

        await bot.editMessageText(
          `⏳ Downloading ${spinner}\n` +
          `${progressBar(percent)} ${Math.floor(percent)}%\n` +
          `📶 ${speed}\n` +
          `🧠 ETA ${eta}`,
          { chat_id: job.chat, message_id: msg.message_id }
        );
      }
    );

    await bot.sendDocument(job.chat, file, {
      caption: buildCaption(meta)
    });

    fileCache.set(job.url, file);
  } catch (e) {
    bot.sendMessage(job.chat, '❌ Gagal download');
  } finally {
    running--;
    cleanup();
    processQueue();
  }
}

/* ================= BOT ================= */
bot.onText(/\/start/, m => {
  bot.sendMessage(
    m.chat.id,
    `👋 Welcome!

📥 Kirim link TikTok / FB / IG / YT
🎵 /mp3 <link> audio only
📊 /stats statistik bot`
  );
});

bot.onText(/\/stats/, m => {
  bot.sendMessage(
    m.chat.id,
    `📊 Statistik Bot
Queue: ${queue.length}
Running: ${running}
Cache file: ${fileCache.size}`
  );
});

bot.onText(/\/mp3 (.+)/, (m, g) => {
  if (!canUse(m.from.id))
    return bot.sendMessage(m.chat.id, '❌ Limit tercapai');

  queue.push({
    chat: m.chat.id,
    url: g[1],
    mp3: true
  });

  processQueue();
});

bot.on('message', m => {
  if (!m.text || m.text.startsWith('/')) return;
  if (!canUse(m.from.id))
    return bot.sendMessage(m.chat.id, '❌ Limit tercapai');

  queue.push({
    chat: m.chat.id,
    url: m.text,
    mp3: false
  });

  processQueue();
});

/* ================= CLEANER ================= */
setInterval(cleanup, 1000 * 60 * 10);

console.log('✅ Bot RUNNING');
