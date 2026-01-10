/**
 * SocialMediaDownloader Bot
 * FINAL – Webhook Mode (Railway)
 * CommonJS – single file
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');
const crypto = require('crypto');

/* =======================
   ENV
======================= */
const TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // https://xxx.up.railway.app
const PORT = process.env.PORT || 3000;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean);

/* =======================
   PATHS
======================= */
const BASE_DIR = __dirname;
const TMP_DIR = path.join(BASE_DIR, 'tmp');
const CACHE_DIR = path.join(BASE_DIR, 'cache');

for (const d of [TMP_DIR, CACHE_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

/* =======================
   BOT INIT (WEBHOOK)
======================= */
const bot = new TelegramBot(TOKEN, { webHook: true });
const app = express();
app.use(express.json());

bot.setWebHook(`${WEBHOOK_URL}/bot${TOKEN}`);

app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (_, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log('Webhook server running on', PORT));

/* =======================
   SIMPLE CACHE
======================= */
function hash(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function getCache(key) {
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function setCache(key, data) {
  const file = path.join(CACHE_DIR, `${key}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
}

/* =======================
   LIMIT (SIMPLE)
======================= */
const userHits = new Map();
const LIMIT_PER_HOUR = 10;

function isLimited(userId) {
  if (ADMIN_IDS.includes(String(userId))) return false;

  const now = Date.now();
  const hour = 60 * 60 * 1000;

  const data = userHits.get(userId) || [];
  const filtered = data.filter(t => now - t < hour);
  filtered.push(now);
  userHits.set(userId, filtered);

  return filtered.length > LIMIT_PER_HOUR;
}

/* =======================
   ANIMATED BAR
======================= */
const BAR_FRAMES = ['⏳', '⌛'];
let barFrame = 0;

function animatedBar(percent, width = 10) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  barFrame = (barFrame + 1) % BAR_FRAMES.length;
  return `${BAR_FRAMES[barFrame]} ${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

/* =======================
   CLEANUP
======================= */
function cleanup(file) {
  if (fs.existsSync(file)) {
    fs.unlink(file, () => {});
  }
}

/* =======================
   DOWNLOAD CORE
======================= */
async function downloadMedia({ chatId, url, audioOnly }) {
  const key = hash(url + (audioOnly ? ':mp3' : ':video'));
  const cached = getCache(key);

  if (cached && fs.existsSync(cached.file)) {
    return cached.file;
  }

  const outFile = path.join(
    TMP_DIR,
    `${Date.now()}-${Math.random().toString(36).slice(2)}.${audioOnly ? 'mp3' : 'mp4'}`
  );

  const args = [
    url,
    '-o', outFile,
    '--newline',
    '--progress-template', '%(progress._percent_str)s'
  ];

  if (audioOnly) {
    args.unshift('-x', '--audio-format', 'mp3');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);

    let lastPercent = 0;

    proc.stdout.on('data', async data => {
      const text = data.toString();
      const match = text.match(/(\d+(?:\.\d+)?)%/);
      if (match) {
        lastPercent = parseFloat(match[1]);
        if (lastPercent > 100) lastPercent = 100;
        try {
          await bot.editMessageText(
            `Downloading...\n${lastPercent.toFixed(1)}%\n${animatedBar(lastPercent)}`,
            {
              chat_id: chatId,
              message_id: currentProgressMsg
            }
          );
        } catch {}
      }
    });

    proc.on('close', code => {
      if (code === 0 && fs.existsSync(outFile)) {
        setCache(key, { file: outFile, at: Date.now() });
        resolve(outFile);
      } else {
        cleanup(outFile);
        reject(new Error('Download failed'));
      }
    });
  });
}

/* =======================
   HANDLERS
======================= */
let currentProgressMsg = null;

bot.onText(/\/start/, msg => {
  bot.sendMessage(
    msg.chat.id,
    `👋 Welcome SocialMediaDownloader

📥 Kirim link TikTok / FB / IG / YT
🎵 /mp3 <link> → audio only
📊 /stats → statistik`
  );
});

bot.onText(/\/mp3 (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1];

  if (isLimited(msg.from.id)) {
    return bot.sendMessage(chatId, '❌ Limit tercapai');
  }

  currentProgressMsg = (await bot.sendMessage(chatId, 'Downloading...\n0%\n⏳ ░░░░░░░░░░')).message_id;

  try {
    const file = await downloadMedia({ chatId, url, audioOnly: true });

    // auto-hide progress
    try { await bot.deleteMessage(chatId, currentProgressMsg); } catch {}

    await bot.sendAudio(chatId, fs.createReadStream(file));
  } catch {
    try { await bot.deleteMessage(chatId, currentProgressMsg); } catch {}
    bot.sendMessage(chatId, '❌ Gagal download');
  }
});

bot.on('message', async msg => {
  if (!msg.text) return;
  if (msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const url = msg.text.trim();

  if (!/^https?:\/\//i.test(url)) return;

  if (isLimited(msg.from.id)) {
    return bot.sendMessage(chatId, '❌ Limit tercapai');
  }

  currentProgressMsg = (await bot.sendMessage(chatId, 'Downloading...\n0%\n⏳ ░░░░░░░░░░')).message_id;

  try {
    const file = await downloadMedia({ chatId, url, audioOnly: false });

    // auto-hide progress
    try { await bot.deleteMessage(chatId, currentProgressMsg); } catch {}

    await bot.sendVideo(chatId, fs.createReadStream(file), {
      caption: '🎬 Video'
    });
  } catch {
    try { await bot.deleteMessage(chatId, currentProgressMsg); } catch {}
    bot.sendMessage(chatId, '❌ Gagal download');
  }
});
