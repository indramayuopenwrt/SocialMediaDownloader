/**
 * SOCIAL MEDIA DOWNLOADER BOT
 * FINAL STABLE WEBHOOK VERSION
 * Railway-ready
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

/* ================== ENV ================== */
const TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // https://xxx.up.railway.app
const PORT = process.env.PORT || 8080;

if (!TOKEN || !WEBHOOK_URL) {
  console.error('❌ BOT_TOKEN / WEBHOOK_URL belum di-set');
  process.exit(1);
}

/* ================== BOT ================== */
const bot = new TelegramBot(TOKEN);
bot.setWebHook(`${WEBHOOK_URL}/bot${TOKEN}`);

/* ================== EXPRESS ================== */
const app = express();
app.use(express.json());

app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log('✅ BOT WEBHOOK FINAL RUNNING');
  console.log('🌐 Webhook aktif di', PORT);
});

/* ================== GLOBAL ================== */
const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

const userQueue = new Map();

/* ================== SAFE GUARD ================== */
process.on('unhandledRejection', err => {
  console.error('Unhandled rejection ignored:', err?.message);
});

/* ================== UTIL ================== */
function isAdmin(id) {
  return ADMIN_IDS.includes(String(id));
}

function bar(percent) {
  const total = 10;
  const filled = Math.round((percent / 100) * total);
  return '█'.repeat(filled) + '░'.repeat(total - filled);
}

/* ====== TELEGRAM SAFE EDIT (ANTI 429) ====== */
let lastEditTime = 0;
let lastPercentSent = -1;

async function safeEdit(chatId, messageId, text) {
  const now = Date.now();
  if (now - lastEditTime < 1100) return;
  lastEditTime = now;

  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId
    });
  } catch (e) {
    if (e.response?.body?.error_code === 429) return;
  }
}

/* ================== START ================== */
bot.onText(/\/start/, msg => {
  bot.sendMessage(
    msg.chat.id,
    `👋 Welcome SocialMediaDownloader\n\n` +
    `📥 Kirim link TikTok / FB / IG / YT\n` +
    `🎧 /mp3 <link> → audio only`
  );
});

/* ================== MP3 ================== */
bot.onText(/\/mp3 (.+)/, (msg, match) => {
  handleDownload(msg, match[1], true);
});

/* ================== LINK HANDLER ================== */
bot.on('message', msg => {
  if (!msg.text) return;
  if (msg.text.startsWith('/')) return;

  const url = msg.text.trim();
  if (!/^https?:\/\//i.test(url)) return;

  handleDownload(msg, url, false);
});

/* ================== CORE ================== */
async function handleDownload(msg, url, audioOnly) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (userQueue.get(userId)) {
    return bot.sendMessage(chatId, '⏳ Masih ada proses berjalan...');
  }

  userQueue.set(userId, true);

  let progressMsg;
  try {
    progressMsg = await bot.sendMessage(chatId, '⏳ Downloading...\n0%\n░░░░░░░░░░');
  } catch {
    userQueue.delete(userId);
    return;
  }

  const outFile = path.join(
    TMP_DIR,
    `${Date.now()}_${userId}.${audioOnly ? 'mp3' : 'mp4'}`
  );

  const args = [
    '-f', audioOnly ? 'bestaudio' : 'best',
    '--newline',
    '-o', outFile,
    url
  ];

  if (audioOnly) {
    args.push('-x', '--audio-format', 'mp3');
  }

  const ytdlp = spawn('yt-dlp', args);

  ytdlp.stdout.on('data', data => {
    const line = data.toString();
    const m = line.match(/(\d+(?:\.\d+)?)%/);
    if (!m) return;

    const percent = Math.floor(parseFloat(m[1]));
    if (percent === lastPercentSent) return;
    lastPercentSent = percent;

    if (percent >= 100) return;

    safeEdit(
      chatId,
      progressMsg.message_id,
      `⏳ Downloading...\n${percent}%\n${bar(percent)}`
    );
  });

  ytdlp.on('close', async code => {
    lastPercentSent = -1;

    if (code !== 0 || !fs.existsSync(outFile)) {
      await bot.sendMessage(chatId, '❌ Gagal download');
      cleanup(outFile);
      userQueue.delete(userId);
      return;
    }

    try {
      await bot.deleteMessage(chatId, progressMsg.message_id);
    } catch {}

    if (audioOnly) {
      await bot.sendAudio(chatId, outFile);
    } else {
      await bot.sendVideo(chatId, outFile);
    }

    cleanup(outFile);
    userQueue.delete(userId);
  });
}

/* ================== CLEANUP ================== */
function cleanup(file) {
  fs.existsSync(file) && fs.unlinkSync(file);
   }
