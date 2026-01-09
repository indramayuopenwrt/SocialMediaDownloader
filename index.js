"use strict";

const TelegramBot = require("node-telegram-bot-api");
const YTDlpWrap = require("yt-dlp-wrap").default;
const { LRUCache } = require("lru-cache");
const fs = require("fs");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const TMP = "/tmp";

if (!BOT_TOKEN) process.exit(1);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const yt = new YTDlpWrap();

const cache = new LRUCache({ max: 50, ttl: 1000 * 60 * 20 });
const queue = [];
let busy = false;

const stats = { total: 0, ok: 0, fail: 0 };

const isAdmin = (id) => id === ADMIN_ID;

function platform(url) {
  if (/tiktok/.test(url)) return "TikTok";
  if (/youtu/.test(url)) return "YouTube";
  if (/instagram/.test(url)) return "Instagram";
  if (/facebook|fb/.test(url)) return "Facebook";
  return "Unknown";
}

async function processQueue() {
  if (busy || queue.length === 0) return;
  busy = true;

  const { msg, url } = queue.shift();
  const chatId = msg.chat.id;
  const file = path.join(TMP, `${Date.now()}.mp4`);

  try {
    await bot.sendMessage(chatId, `⏳ Processing ${platform(url)}`);

    await yt.exec([
      url,
      "-f",
      "bv*[height<=1080]/bv*+ba/b",
      "--merge-output-format",
      "mp4",
      "-o",
      file,
      "--no-playlist",
      "--geo-bypass"
    ]);

    await bot.sendVideo(chatId, file);
    cache.set(url, file);
    stats.ok++;
  } catch (e) {
    stats.fail++;
    await bot.sendMessage(chatId, "❌ Download gagal");
    console.error(e);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    busy = false;
    processQueue();
  }
}

bot.on("message", (msg) => {
  if (!msg.text || !msg.text.startsWith("http")) return;

  stats.total++;
  const job = { msg, url: msg.text.trim() };
  isAdmin(msg.from.id) ? queue.unshift(job) : queue.push(job);

  bot.sendMessage(msg.chat.id, `📥 Queue: ${queue.length}`);
  processQueue();
});

bot.onText(/\/stats/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `📊 Stats
📥 Total: ${stats.total}
✅ OK: ${stats.ok}
❌ Fail: ${stats.fail}
🧠 Queue: ${queue.length}`
  );
});

console.log("✅ BOT READY (yt-dlp-wrap)");
