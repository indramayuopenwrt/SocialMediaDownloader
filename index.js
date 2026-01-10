const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(v => Number(v.trim()))
  .filter(Boolean);
const BASE_URL = process.env.BASE_URL; // https://xxxxx.up.railway.app
const COOKIES = process.env.COOKIES || '';
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !BASE_URL) {
  console.error('❌ BOT_TOKEN / BASE_URL belum diset');
  process.exit(1);
}

/* ================= BOT ================= */
const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

const WEBHOOK_PATH = `/webhook/${BOT_TOKEN}`;
bot.setWebHook(`${BASE_URL}${WEBHOOK_PATH}`);

app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (_, res) => res.send('🤖 Bot Running'));
app.listen(PORT, () => console.log(`🌐 Webhook aktif di ${PORT}`));

/* ================= CONFIG ================= */
const TMP_DIR = './tmp';
const MAX_QUEUE = 3;
const USER_LIMIT = 5;
const CACHE_TTL = 1000 * 60 * 60 * 6;

/* ================= STATE ================= */
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const queue = [];
let running = 0;

const userUsage = new Map();
const metaCache = new Map();
const fileCache = new Map();

/* ================= UTILS ================= */
const hash = s => crypto.createHash('md5').update(s).digest('hex');

const isAdmin = id => ADMIN_IDS.includes(id);

function canUse(id) {
  if (isAdmin(id)) return true;
  return (userUsage.get(id) || 0) < USER_LIMIT;
}

function incUsage(id) {
  if (isAdmin(id)) return;
  userUsage.set(id, (userUsage.get(id) || 0) + 1);
}

/* ================= CLEANUP ================= */
function cleanup() {
  for (const f of fs.readdirSync(TMP_DIR)) {
    const p = path.join(TMP_DIR, f);
    if (Date.now() - fs.statSync(p).mtimeMs > CACHE_TTL) {
      fs.unlinkSync(p);
    }
  }
}
setInterval(cleanup, 1000 * 60 * 10);

/* ================= META ================= */
function platform(url) {
  if (/tiktok/i.test(url)) return 'TikTok';
  if (/facebook|fb/i.test(url)) return 'Facebook';
  if (/instagram|ig/i.test(url)) return 'Instagram';
  if (/youtu/i.test(url)) return 'YouTube';
  return 'Video';
}

function extractMeta(url) {
  if (metaCache.has(url)) return Promise.resolve(metaCache.get(url));

  return new Promise(r => {
    exec(`yt-dlp -j "${url}"`, (e, out) => {
      if (e) return r({ platform: platform(url) });
      const i = JSON.parse(out);
      const m = {
        platform: platform(url),
        author: i.uploader || i.channel,
        description:
          i.description && i.description.length < 300
            ? i.description
            : i.title,
        views: i.view_count ? `${Math.round(i.view_count / 1000)}K` : null,
        likes: i.like_count ? `${Math.round(i.like_count / 1000)}K` : null,
        duration: i.duration || null,
        size: i.filesize_approx
          ? `${(i.filesize_approx / 1024 / 1024).toFixed(2)} MB`
          : null
      };
      metaCache.set(url, m);
      r(m);
    });
  });
}

/* ================= CAPTION ================= */
function caption(m) {
  return [
    `🎬 ${m.platform}`,
    '',
    m.author ? `👤 ${m.author}` : '',
    m.description ? `📝 ${m.description}` : '',
    '',
    m.views ? `👁️ ${m.views}` : '',
    m.likes ? `👍 ${m.likes}` : '',
    m.duration ? `⏱️ ${m.duration} detik` : '',
    m.size ? `📦 ${m.size}` : ''
  ].filter(Boolean).join('\n');
}

/* ================= PROGRESS ================= */
const bar = p =>
  '█'.repeat(Math.round(p / 10)) +
  '░'.repeat(10 - Math.round(p / 10));

/* ================= YT-DLP ================= */
function runYtdlp(url, mp3, onProg) {
  return new Promise((res, rej) => {
    const id = hash(url);
    if (fileCache.has(id)) return res(fileCache.get(id));

    const out = `${TMP_DIR}/${id}.%(ext)s`;
    const cmd = [
      'yt-dlp',
      COOKIES ? `--cookies "${COOKIES}"` : '',
      '--newline',
      '--no-playlist',
      mp3 ? '-x --audio-format mp3' : '-f bestvideo+bestaudio/best',
      `-o "${out}"`,
      `"${url}"`
    ].join(' ');

    let emaEta = null;
    const alpha = 0.2;

    const p = exec(cmd);
    p.stdout.on('data', d => {
      const s = d.toString();
      const m = s.match(/(\d+\.\d+)%.*?ETA\s+([\d:]+)/);
      const sp = s.match(/(\d+\.\d+)(MiB|KiB)\/s/);

      if (m) {
        const eta = m[2];
        emaEta = emaEta
          ? alpha * eta + (1 - alpha) * emaEta
          : eta;

        onProg({
          percent: +m[1],
          eta: emaEta,
          speed: sp ? `${sp[1]} ${sp[2]}/s` : '-'
        });
      }
    });

    p.on('close', c => {
      if (c !== 0) return rej();
      const f = fs.readdirSync(TMP_DIR).find(v => v.startsWith(id));
      const fp = path.join(TMP_DIR, f);
      fileCache.set(id, fp);
      res(fp);
    });
  });
}

/* ================= QUEUE ================= */
async function processQueue() {
  if (running >= MAX_QUEUE || !queue.length) return;
  running++;

  const j = queue.shift();
  try {
    const meta = await extractMeta(j.url);
    let last = 0;

    const msg = await bot.sendMessage(
      j.chat,
      `⏳ Downloading...\n0%\n${bar(0)}`
    );

    const file = await runYtdlp(j.url, j.mp3, async p => {
      if (Date.now() - last < 4000) return;
      last = Date.now();
      await bot.editMessageText(
        `⏳ Downloading...\n${p.percent.toFixed(1)}%\n${bar(
          p.percent
        )}\n📶 ${p.speed}\nETA ${p.eta}`,
        { chat_id: j.chat, message_id: msg.message_id }
      );
    });

    await bot.sendDocument(j.chat, file, { caption: caption(meta) });
    incUsage(j.user);
  } catch {
    bot.sendMessage(j.chat, '❌ Gagal download');
  } finally {
    running--;
    cleanup();
    processQueue();
  }
}

/* ================= COMMANDS ================= */
bot.onText(/\/start/, m =>
  bot.sendMessage(
    m.chat.id,
    `👋 Welcome SocialMediaDownloader
📥 Kirim link TikTok / FB / IG / YT
🎵 /mp3 <link>
📊 /stats`
  )
);

bot.onText(/\/stats/, m =>
  bot.sendMessage(
    m.chat.id,
    `📊 Queue ${queue.length}
⚙️ Running ${running}
📦 Cache ${fileCache.size}`
  )
);

bot.onText(/\/mp3 (.+)/, (m, g) => {
  if (!canUse(m.from.id))
    return bot.sendMessage(m.chat.id, '❌ Limit tercapai');

  queue.push({ chat: m.chat.id, user: m.from.id, url: g[1], mp3: true });
  processQueue();
});

bot.on('message', m => {
  if (!m.text || m.text.startsWith('/')) return;
  if (!canUse(m.from.id))
    return bot.sendMessage(m.chat.id, '❌ Limit tercapai');

  queue.push({ chat: m.chat.id, user: m.from.id, url: m.text, mp3: false });
  processQueue();
});

console.log('✅ BOT WEBHOOK FINAL RUNNING');
