const TelegramBot = require("node-telegram-bot-api");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

/* ================= CONFIG ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN belum di set");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const DOWNLOAD_DIR = "./downloads";
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

/* ============== ADMIN & LIMIT ============== */
const ADMINS = [
  123456789 // GANTI DENGAN TELEGRAM ID KAMU
];
const DAILY_LIMIT = 10;
const userUsage = new Map();

function isAdmin(id) {
  return ADMINS.includes(id);
}

function canDownload(id) {
  if (isAdmin(id)) return true;

  const today = new Date().toDateString();
  const data = userUsage.get(id) || { date: today, count: 0 };

  if (data.date !== today) {
    data.date = today;
    data.count = 0;
  }

  if (data.count >= DAILY_LIMIT) return false;

  data.count++;
  userUsage.set(id, data);
  return true;
}

/* ================= STATISTIC ================= */
const STATS = {
  request: 0,
  success: 0,
  failed: 0,
  users: new Set(),
  cacheHit: 0
};

/* ================= CACHE ================= */
const META_CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCache(key) {
  const c = META_CACHE.get(key);
  if (!c) return null;
  if (Date.now() - c.time > CACHE_TTL) {
    META_CACHE.delete(key);
    return null;
  }
  STATS.cacheHit++;
  return c.data;
}

function setCache(key, data) {
  META_CACHE.set(key, { data, time: Date.now() });
}

/* ================= UTIL ================= */
function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return "YouTube";
  if (/tiktok\.com/.test(url)) return "TikTok";
  if (/facebook\.com|fb\.watch/.test(url)) return "Facebook";
  if (/instagram\.com/.test(url)) return "Instagram";
  return null;
}

function formatSize(bytes = 0) {
  if (!bytes) return "-";
  const mb = bytes / 1024 / 1024;
  return mb >= 1024
    ? (mb / 1024).toFixed(2) + " GB"
    : mb.toFixed(2) + " MB";
}

function formatDuration(sec = 0) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ================= METADATA ================= */
function getMetadata(url) {
  return new Promise((resolve, reject) => {
    const cached = getCache(url);
    if (cached) return resolve(cached);

    const ytdlp = spawn("yt-dlp", [
      "-j",
      "--no-playlist",
      "--cookies", "cookies.txt",
      url
    ]);

    let out = "";
    ytdlp.stdout.on("data", d => out += d.toString());
    ytdlp.on("close", code => {
      if (code !== 0) return reject("metadata error");
      try {
        const json = JSON.parse(out);
        setCache(url, json);
        resolve(json);
      } catch {
        reject("parse error");
      }
    });
  });
}

/* ================= FORMAT ================= */
function pickBestFormat(info) {
  if (!info.formats) return null;
  return info.formats
    .filter(f =>
      f.ext === "mp4" &&
      f.vcodec !== "none" &&
      f.height &&
      f.filesize
    )
    .sort((a, b) => b.height - a.height)
    .find(f => f.height <= 1080);
}

/* ================= DOWNLOAD ================= */
function downloadVideo(url, format) {
  return new Promise((resolve, reject) => {
    const file = path.join(DOWNLOAD_DIR, `${Date.now()}.mp4`);

    const ytdlp = spawn("yt-dlp", [
      "-f", format.format_id,
      "--merge-output-format", "mp4",
      "--cookies", "cookies.txt",
      "-o", file,
      url
    ]);

    ytdlp.on("close", code => {
      if (code !== 0) return reject("download error");
      resolve(file);
    });
  });
}

/* ================= WELCOME ================= */
const WELCOME = `
👋 Welcome Social Downloader Bot

📥 Kirim link video untuk download otomatis

🌍 Platform:
• YouTube
• Facebook
• Instagram
• TikTok

⚙ Fitur:
• Auto resolusi terbaik (≤1080p)
• Kirim sebagai DOCUMENT
• Cache metadata
• Admin bypass limit

📊 Command:
/start /help
/stats
`;

/* ================= COMMAND ================= */
bot.onText(/\/start|\/help/, msg => {
  bot.sendMessage(msg.chat.id, WELCOME);
});

bot.onText(/\/stats/, msg => {
  bot.sendMessage(msg.chat.id,
`📊 Statistik Bot

👥 User: ${STATS.users.size}
📥 Request: ${STATS.request}
✅ Sukses: ${STATS.success}
❌ Gagal: ${STATS.failed}
🧠 Cache hit: ${STATS.cacheHit}`);
});

/* ================= MAIN ================= */
bot.on("message", async msg => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const url = msg.text.trim();
  const platform = detectPlatform(url);
  if (!platform) return;

  const userId = msg.from.id;
  if (!canDownload(userId)) {
    return bot.sendMessage(msg.chat.id,
      "⛔ Limit harian tercapai (10/hari)");
  }

  STATS.request++;
  STATS.users.add(userId);

  await bot.sendMessage(msg.chat.id, "⏳ Memproses video...");

  try {
    const info = await getMetadata(url);
    const format = pickBestFormat(info);
    if (!format) throw "format kosong";

    await bot.sendMessage(msg.chat.id,
`📥 ${info.title || "Tanpa Judul"}
🌍 ${platform}
🎞 ${format.height}p
📦 ${formatSize(format.filesize)}
⏱ ${formatDuration(info.duration)}`);

    const file = await downloadVideo(url, format);
    await bot.sendDocument(msg.chat.id, file);
    fs.unlinkSync(file);

    STATS.success++;
  } catch (e) {
    console.error(e);
    STATS.failed++;
    bot.sendMessage(msg.chat.id, "❌ Gagal memproses video");
  }
});

console.log("✅ BOT RUNNING (COMMONJS)");
