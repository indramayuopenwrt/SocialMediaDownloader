/**
 * SocialMediaDownloader BOT
 * CommonJS Version (Railway SAFE)
 */

const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ================= CONFIG =================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN belum di set');
  process.exit(1);
}

const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// ================= BOT =================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ================= UTIL =================
function uid() {
  return crypto.randomBytes(6).toString('hex');
}

function formatSize(bytes) {
  if (!bytes) return '-';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? mb.toFixed(2) + ' MB' : (bytes / 1024).toFixed(2) + ' KB';
}

function bar(percent) {
  const total = 10;
  const filled = Math.round((percent / 100) * total);
  return '█'.repeat(filled) + '░'.repeat(total - filled);
}

// ================= QUEUE =================
const queue = [];
let running = false;

async function runQueue() {
  if (running || queue.length === 0) return;
  running = true;

  const job = queue.shift();
  try {
    await job();
  } catch (e) {
    console.error(e);
  }

  running = false;
  runQueue();
}

// ================= DOWNLOAD =================
function download(chatId, url) {
  return new Promise((resolve) => {
    const id = uid();
    const out = path.join(TMP_DIR, `${id}.mp4`);

    let progressMsg;
    bot.sendMessage(chatId, '📥 Memulai download...').then(m => {
      progressMsg = m;
    });

    const ytdlp = spawn('yt-dlp', [
      '-f', 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--newline',
      '-o', out,
      url
    ]);

    ytdlp.stdout.on('data', d => {
      const line = d.toString();
      const match = line.match(/(\d+\.\d+)%/);
      if (match && progressMsg) {
        const pct = parseFloat(match[1]);
        bot.editMessageText(
          `⬇️ Downloading...\n${bar(pct)} ${pct.toFixed(1)}%`,
          { chat_id: chatId, message_id: progressMsg.message_id }
        ).catch(() => {});
      }
    });

    ytdlp.on('close', async () => {
      if (!fs.existsSync(out)) {
        bot.sendMessage(chatId, '❌ Download gagal');
        return resolve();
      }

      const size = fs.statSync(out).size;

      await bot.sendDocument(chatId, out, {
        caption:
`🎬 Video
📦 Size: ${formatSize(size)}
🔗 ${url}`
      });

      fs.unlinkSync(out);
      resolve();
    });
  });
}

// ================= HANDLER =================
bot.on('message', msg => {
  if (!msg.text) return;
  if (!msg.text.startsWith('http')) return;

  const chatId = msg.chat.id;
  queue.push(() => download(chatId, msg.text));

  bot.sendMessage(chatId, '🧠 Link diterima, masuk antrian...');
  runQueue();
});

// ================= START =================
console.log('✅ Bot jalan (CommonJS)');
