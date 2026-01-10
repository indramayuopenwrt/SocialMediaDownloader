const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/* ================= CONFIG ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(v => v.trim());
const TMP = os.tmpdir();

/* cookies from ENV */
const COOKIE_PATH = process.env.YTDLP_COOKIES
  ? path.join(TMP, 'cookies.txt')
  : null;

if (process.env.YTDLP_COOKIES) {
  fs.writeFileSync(COOKIE_PATH, process.env.YTDLP_COOKIES);
}

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN kosong');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/* ================= STATE ================= */
const queue = [];
let busy = false;

/* stats */
const stats = {
  start: Date.now(),
  total: 0,
  success: 0,
  failed: 0,
  mp3: 0
};

/* cache metadata */
const META_CACHE = new Map();
const META_TTL = 1000 * 60 * 10;

/* cache file */
const FILE_CACHE = new Map();
const FILE_TTL = 1000 * 60 * 10;

/* ================= UTILS ================= */
const isAdmin = id => ADMIN_IDS.includes(String(id));

const progressBar = p => {
  const t = 10;
  const f = Math.round((p / 100) * t);
  return '█'.repeat(f) + '░'.repeat(t - f);
};

function getPlatform(url) {
  if (/tiktok/i.test(url)) return 'TikTok';
  if (/facebook|fb/i.test(url)) return 'Facebook';
  if (/instagram/i.test(url)) return 'Instagram';
  if (/youtube|youtu\.be/i.test(url)) return 'YouTube';
  return 'Media';
}

function buildCaption(meta) {
  const lines = [];
  lines.push(`🎬 ${meta.platform}`);
  lines.push('');
  lines.push(`👤 ${meta.author || '-'}`);

  if (meta.description) lines.push(`📝 ${meta.description}`);

  if (meta.views || meta.likes) {
    lines.push('');
    lines.push(`👁️ ${meta.views || '-'} • 👍 ${meta.likes || '-'}`);
  }

  lines.push('');
  lines.push(`⏱️ ${meta.duration || '-'}`);
  lines.push(`📦 ${meta.size || '-'}`);
  return lines.join('\n');
}

/* ================= CACHE ================= */
function getMetaCache(key) {
  const c = META_CACHE.get(key);
  if (!c || Date.now() > c.exp) return null;
  return c.data;
}
function setMetaCache(key, data) {
  META_CACHE.set(key, { data, exp: Date.now() + META_TTL });
}

function getFileCache(key) {
  const c = FILE_CACHE.get(key);
  if (!c || Date.now() > c.exp || !fs.existsSync(c.path)) return null;
  return c.path;
}
function setFileCache(key, filePath) {
  FILE_CACHE.set(key, { path: filePath, exp: Date.now() + FILE_TTL });
}

/* ================= CLEANUP ================= */
function cleanupTemp() {
  try {
    const now = Date.now();
    fs.readdirSync(TMP).forEach(f => {
      if (!f.match(/\.(mp4|mp3)$/)) return;
      const full = path.join(TMP, f);
      if (now - fs.statSync(full).mtimeMs > 1000 * 60 * 15) {
        fs.unlinkSync(full);
      }
    });
  } catch {}
}
setInterval(cleanupTemp, 1000 * 60 * 5);

/* ================= QUEUE ================= */
function enqueue(job) {
  queue.push(job);
  processQueue();
}

async function processQueue() {
  if (busy || queue.length === 0) return;
  busy = true;
  const job = queue.shift();
  try {
    await job();
    stats.success++;
  } catch (e) {
    console.error(e);
    stats.failed++;
  }
  busy = false;
  processQueue();
}

/* ================= yt-dlp ================= */
function runYTDLP({ url, mp3 }, onProgress) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const out = path.join(TMP, `${id}.%(ext)s`);

    const args = [
      url,
      '-o', out,
      '--no-playlist',
      '--newline',
      '--progress-template',
      'download:%(progress._percent_str)s|%(progress.speed)s|%(progress.eta)s',
      '--print-json'
    ];

    if (COOKIE_PATH) args.push('--cookies', COOKIE_PATH);
    if (mp3) args.push('-x', '--audio-format', 'mp3');
    else args.push('-f', 'bv*+ba/best');

    const proc = spawn('yt-dlp', args);

    let info = null;
    proc.stdout.on('data', d => {
      const t = d.toString().trim();
      if (t.startsWith('{')) {
        try { info = JSON.parse(t); } catch {}
        return;
      }
      if (t.startsWith('download:')) {
        const [, payload] = t.split(':');
        const [p, s, e] = payload.split('|');
        onProgress({
          percent: parseFloat(p),
          speed: s,
          eta: e
        });
      }
    });

    proc.on('close', code => {
      if (code !== 0 || !info) return reject(new Error('yt-dlp gagal'));
      const file = fs.readdirSync(TMP).find(f => f.startsWith(id));
      resolve({ file: path.join(TMP, file), info });
    });
  });
}

/* ================= COMMANDS ================= */
bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id,
`👋 Downloader Bot

Kirim link:
• TikTok / IG / FB / YouTube

🎵 /mp3 <url>
📊 /stats`
  );
});

bot.onText(/\/stats/, msg => {
  bot.sendMessage(msg.chat.id,
`📊 Statistik
• Total: ${stats.total}
• Sukses: ${stats.success}
• Gagal: ${stats.failed}
• MP3: ${stats.mp3}
• Queue: ${queue.length}`
  );
});

bot.onText(/\/mp3 (.+)/, (msg, m) => {
  enqueue(() => handleDownload(msg, m[1], true));
});

bot.on('message', msg => {
  if (!msg.text || msg.text.startsWith('/')) return;
  if (/https?:\/\//i.test(msg.text)) {
    enqueue(() => handleDownload(msg, msg.text, false));
  }
});

/* ================= CORE ================= */
async function handleDownload(msg, url, mp3) {
  stats.total++;
  const chatId = msg.chat.id;
  const platform = getPlatform(url);
  const cacheKey = url + (mp3 ? ':mp3' : ':video');

  const cachedFile = getFileCache(cacheKey);
  if (cachedFile) {
    await bot.sendDocument(chatId, cachedFile, {
      caption: buildCaption({
        platform,
        author: 'Cache',
        size: `${(fs.statSync(cachedFile).size / 1024 / 1024).toFixed(2)} MB`
      })
    });
    return;
  }

  const status = await bot.sendMessage(chatId,
`⏳ ${platform}
${progressBar(0)} 0%`
  );

  const { file, info } = await runYTDLP(
    { url, mp3 },
    p => {
      bot.editMessageText(
`⏳ ${platform}
${progressBar(p.percent)} ${p.percent.toFixed(1)}%
⚡ ${p.speed} | 🕒 ${p.eta}s`,
        { chat_id: chatId, message_id: status.message_id }
      ).catch(()=>{});
    }
  );

  setFileCache(cacheKey, file);

  const meta = {
    platform,
    author: info.uploader || info.channel,
    description: info.description || info.title,
    views: info.view_count ? `${Math.round(info.view_count / 1000)}K` : null,
    likes: info.like_count ? `${Math.round(info.like_count / 1000)}K` : null,
    duration: info.duration ? `${info.duration}s` : null,
    size: info.filesize_approx
      ? `${(info.filesize_approx / 1024 / 1024).toFixed(2)} MB`
      : null
  };

  const caption = buildCaption(meta);

  if (mp3) {
    stats.mp3++;
    await bot.sendAudio(chatId, file, { caption });
  } else {
    const size = fs.statSync(file).size;
    if (size < 49 * 1024 * 1024) {
      await bot.sendVideo(chatId, file, { caption, supports_streaming: true });
    } else {
      await bot.sendDocument(chatId, file, { caption });
    }
  }
}

console.log('✅ BOT PRODUKSI AKTIF');
