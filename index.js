"use strict";

/* ================= IMPORT ================= */
const TelegramBot = require("node-telegram-bot-api");
const { exec } = require("child_process");
const { LRUCache } = require("lru-cache");
const fs = require("fs");
const path = require("path");

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const TMP_DIR = "/tmp";

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN belum diset");
  process.exit(1);
}

/* ================= BOT ================= */
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/* ================= CACHE ================= */
const cache = new LRUCache({
  max: 100,
  ttl: 1000 * 60 * 30
});

/* ================= QUEUE ================= */
const queue = [];
let processing = false;

/* ================= LIMIT ================= */
const cooldown = new Map();
const USER_DELAY = 15;

/* ================= STATS (HANYA SATU) ================= */
const stats = {
  start: Date.now(),
  total: 0,
  success: 0,
  failed: 0
};

/* ================= HELPERS ================= */
const isAdmin = (id) => id === ADMIN_ID;

function canRequest(id) {
  if (isAdmin(id)) return true;
  const last = cooldown.get(id) || 0;
  if (Date.now() - last < USER_DELAY * 1000) return false;
  cooldown.set(id, Date.now());
  return true;
}

function detectPlatform(url) {
  if (/youtu\.?be/.test(url)) return "YouTube";
  if (/tiktok\.com/.test(url)) return "TikTok";
  if (/instagram\.com/.test(url)) return "Instagram";
  if (/facebook\.com|fb\.watch/.test(url)) return "Facebook";
  return "Unknown";
}

function ytCmd(url) {
  return `yt-dlp -f "bv*[height<=1080]/bv*+ba/b" --merge-output-format mp4 -o "${TMP_DIR}/%(id)s.%(ext)s" "${url}"`;
}

/* ================= QUEUE PROCESS ================= */
function runQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  const job = queue.shift();
  const chatId = job.msg.chat.id;
  const url = job.url;

  bot.sendMessage(chatId, `⏳ Processing (${detectPlatform(url)})`);

  exec(ytCmd(url), async (err) => {
    try {
      if (err) throw err;

      const file = fs.readdirSync(TMP_DIR).find(f => f.endsWith(".mp4"));
      if (!file) throw new Error("File not found");

      const filePath = path.join(TMP_DIR, file);
      cache.set(url, filePath);

      await bot.sendVideo(chatId, filePath);
      fs.unlinkSync(filePath);

      stats.success++;
    } catch (e) {
      stats.failed++;
      await bot.sendMessage(chatId, "❌ Download gagal");
      console.error(e);
    } finally {
      processing = false;
      runQueue();
    }
  });
}

/* ================= ENQUEUE ================= */
function enqueue(msg, url) {
  const userId = msg.from.id;

  if (!canRequest(userId)) {
    return bot.sendMessage(msg.chat.id, "⏳ Tunggu sebentar...");
  }

  if (cache.has(url)) {
    return bot.sendVideo(msg.chat.id, cache.get(url));
  }

  isAdmin(userId)
    ? queue.unshift({ msg, url })
    : queue.push({ msg, url });

  bot.sendMessage(msg.chat.id, `📥 Queue: ${queue.length}`);
  runQueue();
}

/* ================= COMMANDS ================= */
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "👋 Kirim link YT / FB / IG / TikTok");
});

bot.onText(/\/stats/, (msg) => {
  const up = Math.floor((Date.now() - stats.start) / 1000);
  bot.sendMessage(
    msg.chat.id,
    `📊 Statistik
⏱ Uptime: ${up}s
📥 Total: ${stats.total}
✅ Sukses: ${stats.success}
❌ Gagal: ${stats.failed}
🧠 Queue: ${queue.length}
💾 Cache: ${cache.size}`
  );
});

/* ================= MESSAGE ================= */
bot.on("message", (msg) => {
  if (!msg.text) return;
  if (msg.text.startsWith("/")) return;
  if (!msg.text.startsWith("http")) return;

  stats.total++;
  enqueue(msg, msg.text.trim());
});

/* ================= SAFETY ================= */
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

console.log("✅ Bot RUNNING — clean & stable");
