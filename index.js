const TelegramBot = require("node-telegram-bot-api");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN kosong");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const DOWNLOAD_DIR = "./downloads";
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

/* ========= ADMIN & LIMIT ========= */
const ADMINS = [123456789]; // GANTI ID KAMU
const DAILY_LIMIT = 10;
const usage = new Map();

function isAdmin(id) {
  return ADMINS.includes(id);
}

function allow(id) {
  if (isAdmin(id)) return true;
  const today = new Date().toDateString();
  const u = usage.get(id) || { date: today, count: 0 };
  if (u.date !== today) {
    u.date = today;
    u.count = 0;
  }
  if (u.count >= DAILY_LIMIT) return false;
  u.count++;
  usage.set(id, u);
  return true;
}

/* ========= STAT ========= */
const STAT = {
  request: 0,
  success: 0,
  failed: 0,
  users: new Set()
};

/* ========= UTIL ========= */
function platform(url) {
  if (/youtu/.test(url)) return "YouTube";
  if (/tiktok/.test(url)) return "TikTok";
  if (/facebook|fb\.watch/.test(url)) return "Facebook";
  if (/instagram/.test(url)) return "Instagram";
  return "Unknown";
}

function size(bytes) {
  if (!bytes) return "-";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

/* ========= METADATA ========= */
function metadata(url) {
  return new Promise((resolve, reject) => {
    const y = spawn("yt-dlp", [
      "-j",
      "--no-playlist",
      "--cookies", "cookies.txt",
      url
    ]);

    let out = "";
    y.stdout.on("data", d => out += d);
    y.on("close", c => {
      if (c !== 0) return reject();
      try {
        resolve(JSON.parse(out));
      } catch {
        reject();
      }
    });
  });
}

/* ========= DOWNLOAD ========= */
function download(url) {
  return new Promise((resolve, reject) => {
    const file = path.join(DOWNLOAD_DIR, `${Date.now()}.mp4`);

    const y = spawn("yt-dlp", [
      "-f",
      "bv*[height<=1080]+ba/best[height<=1080]/best",
      "--merge-output-format", "mp4",
      "--cookies", "cookies.txt",
      "-o", file,
      url
    ]);

    y.on("close", c => {
      if (c !== 0) return reject();
      resolve(file);
    });
  });
}

/* ========= COMMAND ========= */
bot.onText(/\/start|\/help/, msg => {
  bot.sendMessage(msg.chat.id,
`👋 Social Media Downloader

📥 Kirim link video:
YouTube, Facebook, TikTok, Instagram

⚙ Fitur:
• Auto kualitas terbaik (≤1080p)
• Auto kirim DOCUMENT
• Admin bypass limit

📊 /stats`);
});

bot.onText(/\/stats/, msg => {
  bot.sendMessage(msg.chat.id,
`📊 Statistik Bot
👥 User: ${STAT.users.size}
📥 Request: ${STAT.request}
✅ Sukses: ${STAT.success}
❌ Gagal: ${STAT.failed}`);
});

/* ========= MAIN ========= */
bot.on("message", async msg => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const url = msg.text.trim();
  if (!/^https?:\/\//.test(url)) return;

  const uid = msg.from.id;
  if (!allow(uid)) {
    return bot.sendMessage(msg.chat.id, "⛔ Limit harian tercapai");
  }

  STAT.request++;
  STAT.users.add(uid);

  const p = platform(url);
  await bot.sendMessage(msg.chat.id, `⏳ Memproses ${p}...`);

  try {
    const info = await metadata(url);

    await bot.sendMessage(msg.chat.id,
`📥 ${info.title || "Tanpa Judul"}
🌍 ${p}
⏱ ${info.duration || "-"} detik`);

    const file = await download(url);
    await bot.sendDocument(msg.chat.id, file);
    fs.unlinkSync(file);

    STAT.success++;
  } catch (e) {
    console.error(e);
    STAT.failed++;
    bot.sendMessage(msg.chat.id, "❌ Gagal download video");
  }
});

console.log("✅ BOT RUNNING (FINAL FIX)");
