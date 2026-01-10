import TelegramBot from "node-telegram-bot-api";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// ================== CONFIG ==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const MAX_QUEUE = 2;
const MAX_USER_DAILY = 5;

// ================== INIT ==================
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN belum di set");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("🤖 Bot started");

// ================== STATE ==================
const queue = [];
let active = 0;

const userLimit = new Map(); // userId -> count
const stats = {
  total: 0,
  success: 0,
  failed: 0,
};

// ================== UTIL ==================
function isAdmin(id) {
  return ADMIN_IDS.includes(String(id));
}

function incLimit(userId) {
  const v = userLimit.get(userId) || 0;
  userLimit.set(userId, v + 1);
}

function overLimit(userId) {
  if (isAdmin(userId)) return false;
  return (userLimit.get(userId) || 0) >= MAX_USER_DAILY;
}

function detectPlatform(url) {
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/youtu\.be|youtube\.com/.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch/.test(url)) return "facebook";
  return null;
}

function detectFormat(platform) {
  if (platform === "tiktok") return "mp4";
  if (platform === "facebook") return "mp4";
  return "bestvideo+bestaudio/best";
}

function buildYtdlpCmd(url, out) {
  return [
    "yt-dlp",
    "--no-playlist",
    "-f",
    `"bestvideo[height<=1080]+bestaudio/best[height<=1080]"`,
    "--merge-output-format mp4",
    `"${url}"`,
    "-o",
    `"${out}"`,
  ].join(" ");
}

// ================== QUEUE ==================
function enqueue(job) {
  queue.push(job);
  processQueue();
}

async function processQueue() {
  if (active >= MAX_QUEUE) return;
  const job = queue.shift();
  if (!job) return;

  active++;
  await runJob(job).catch(() => {});
  active--;
  processQueue();
}

// ================== DOWNLOAD ==================
async function runJob({ chatId, userId, url, platform }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-"));
  const outFile = path.join(tmpDir, "video.mp4");

  try {
    console.log("⬇️ Download:", url);

    const cmd = buildYtdlpCmd(url, outFile);
    await execPromise(cmd);

    if (!fs.existsSync(outFile)) throw new Error("File tidak ada");

    await bot.sendVideo(chatId, outFile, {
      caption: `✅ Selesai\n📦 Platform: ${platform.toUpperCase()}`,
    });

    stats.success++;
  } catch (err) {
    console.error("❌ Download error:", err.message);
    stats.failed++;
    await bot.sendMessage(chatId, "❌ Download gagal");
  } finally {
    stats.total++;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ================== COMMANDS ==================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `👋 Bot Aktif

📌 Kirim link:
• TikTok
• YouTube
• Facebook

⚠️ Jika bot diam:
1️⃣ Privacy Mode OFF
2️⃣ Restart bot`
  );
});

bot.onText(/\/stats/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `📊 Statistik Bot
━━━━━━━━━━━━
📥 Total: ${stats.total}
✅ Sukses: ${stats.success}
❌ Gagal: ${stats.failed}
⏳ Queue: ${queue.length}
⚙️ Aktif: ${active}`
  );
});

// ================== MESSAGE HANDLER (PENTING) ==================
bot.on("message", async (msg) => {
  try {
    if (!msg.text) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text.trim();

    // ignore command
    if (text.startsWith("/")) return;

    console.log("📩 MESSAGE:", text);

    const match = text.match(/https?:\/\/\S+/);
    if (!match) {
      return bot.sendMessage(chatId, "❗ Kirim link video yang valid");
    }

    if (overLimit(userId)) {
      return bot.sendMessage(chatId, "🚫 Limit harian tercapai");
    }

    const url = match[0];
    const platform = detectPlatform(url);

    if (!platform) {
      return bot.sendMessage(chatId, "❌ Platform tidak didukung");
    }

    incLimit(userId);

    await bot.sendMessage(
      chatId,
      `⏳ Processing ${platform.toUpperCase()}
📥 Queue: ${queue.length + 1}`
    );

    enqueue({ chatId, userId, url, platform });
  } catch (e) {
    console.error("❌ Handler error:", e);
  }
});

// ================== SAFETY ==================
process.on("uncaughtException", (e) => console.error("🔥", e));
process.on("unhandledRejection", (e) => console.error("🔥", e));
