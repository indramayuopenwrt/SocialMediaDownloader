const TelegramBot = require("node-telegram-bot-api");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID; // contoh: 123456789
const DOWNLOAD_DIR = "./downloads";
const MAX_QUEUE = 2;
/* ========================================== */

if (!TOKEN) {
  console.error("❌ BOT_TOKEN TIDAK ADA");
  process.exit(1);
}

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR);
}

console.log("🚀 BOT STARTING...");

const bot = new TelegramBot(TOKEN, { polling: true });

console.log("✅ BOT STARTED & POLLING");

/* ================= QUEUE ================= */
const queue = [];
let running = 0;

function runQueue() {
  if (running >= MAX_QUEUE || queue.length === 0) return;
  const job = queue.shift();
  running++;
  job()
    .catch(console.error)
    .finally(() => {
      running--;
      runQueue();
    });
}
/* ========================================= */

/* ================= UTILS ================= */
function isAdmin(id) {
  return ADMIN_ID && String(id) === String(ADMIN_ID);
}

function detectPlatform(url) {
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/youtu\.be|youtube\.com/i.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch/i.test(url)) return "facebook";
  return "unknown";
}
/* ========================================= */

/* ================= COMMAND ================= */
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 **Downloader Bot Aktif**\n\nKirim link:\n• YouTube\n• TikTok\n• Facebook",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/stats/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `📊 STATUS\nQueue: ${queue.length}\nRunning: ${running}`
  );
});
/* ========================================== */

/* ================= MESSAGE ================= */
bot.on("message", async (msg) => {
  if (!msg.text) return;
  if (msg.text.startsWith("/")) return;

  const url = msg.text.trim();
  const platform = detectPlatform(url);

  if (platform === "unknown") {
    return bot.sendMessage(msg.chat.id, "❌ Link tidak didukung");
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🎥 720p", callback_data: `dl|720|${url}` },
          { text: "🎬 1080p", callback_data: `dl|1080|${url}` }
        ],
        [{ text: "🎧 Audio (MP3)", callback_data: `dl|audio|${url}` }]
      ]
    }
  };

  bot.sendMessage(
    msg.chat.id,
    `📥 **Link terdeteksi:** ${platform}\nPilih format:`,
    { parse_mode: "Markdown", ...keyboard }
  );
});
/* ========================================== */

/* ================= CALLBACK ================= */
bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;

  const [cmd, quality, url] = q.data.split("|");
  if (cmd !== "dl") return;

  bot.answerCallbackQuery(q.id, { text: "⏳ Diproses..." });

  queue.push(async () => {
    const ext = quality === "audio" ? "mp3" : "mp4";
    const filename = `${Date.now()}.${ext}`;
    const filepath = path.join(DOWNLOAD_DIR, filename);

    let args = [
      "-o", filepath,
      "--no-playlist",
      url
    ];

    if (quality === "audio") {
      args.unshift("-x", "--audio-format", "mp3");
    } else {
      args.unshift("-f", `bv*[height<=${quality}]+ba/b`);
    }

    console.log("⬇️ DOWNLOAD:", url);

    await new Promise((resolve, reject) => {
      const ytdlp = spawn("yt-dlp", args);

      ytdlp.stderr.on("data", d => console.log(d.toString()));
      ytdlp.on("error", reject);
      ytdlp.on("close", code => {
        if (code === 0) resolve();
        else reject(new Error("yt-dlp error"));
      });
    });

    await bot.sendDocument(chatId, filepath);
    fs.unlinkSync(filepath);
  });

  runQueue();
});
/* ========================================== */

/* ================= ERROR ================= */
bot.on("polling_error", (e) => {
  console.error("❌ POLLING ERROR:", e.message);
});
/* ========================================== */
