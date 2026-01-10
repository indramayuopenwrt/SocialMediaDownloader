/**
 * AutoClipYT Telegram Downloader Bot
 * FINAL FIX VERSION
 * Node.js + yt-dlp
 */

const TelegramBot = require("node-telegram-bot-api");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const LRU = require("lru-cache");
const PQueue = require("p-queue").default;

// ================= CONFIG =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(Number);
const DOWNLOAD_DIR = "/tmp";

// ================= BOT =================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ================= CACHE =================
const cache = new LRU({
  max: 500,
  ttl: 1000 * 60 * 30, // 30 menit
});

// ================= QUEUE =================
const queue = new PQueue({
  concurrency: 1,
  intervalCap: 5,
  interval: 1000,
});

// ================= STATS =================
const botStats = {
  total: 0,
  success: 0,
  failed: 0,
};

// ================= UTILS =================
function isAdmin(id) {
  return ADMIN_IDS.includes(id);
}

function detectPlatform(url) {
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/youtu\.be|youtube\.com/.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch/.test(url)) return "facebook";
  if (/instagram\.com/.test(url)) return "instagram";
  return "unknown";
}

function checkPrivate(url) {
  return new Promise((resolve) => {
    execFile(
      "yt-dlp",
      ["--dump-json", "--no-playlist", url],
      (err, stdout, stderr) => {
        if (!err) return resolve(false);

        const msg = (stderr || "").toLowerCase();
        if (
          msg.includes("private") ||
          msg.includes("login") ||
          msg.includes("not available") ||
          msg.includes("content isn't available")
        ) {
          return resolve(true);
        }
        resolve(false);
      }
    );
  });
}

function autoFormat(platform) {
  if (platform === "youtube")
    return "bestvideo[height<=1080]+bestaudio/best";
  return "best";
}

// ================= DOWNLOAD =================
async function downloadVideo(url, platform) {
  const out = path.join(DOWNLOAD_DIR, `${Date.now()}.mp4`);
  const format = autoFormat(platform);

  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      [
        "-f",
        format,
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "-o",
        out,
        url,
      ],
      { timeout: 1000 * 60 * 5 },
      (err) => {
        if (err) return reject(err);
        resolve(out);
      }
    );
  });
}

// ================= BOT COMMANDS =================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 *AutoClipYT*\n\n" +
      "📥 Kirim link:\n" +
      "YouTube / TikTok / Facebook / Instagram\n\n" +
      "⚡ Auto detect platform & resolusi",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/stats/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  bot.sendMessage(
    msg.chat.id,
    `📊 *BOT STATS*\n\n` +
      `📥 Total: ${botStats.total}\n` +
      `✅ Success: ${botStats.success}\n` +
      `❌ Failed: ${botStats.failed}\n` +
      `🧠 Queue: ${queue.size}`,
    { parse_mode: "Markdown" }
  );
});

// ================= MESSAGE HANDLER =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (!/^https?:\/\//.test(text)) return;

  const userId = msg.from.id;
  const platform = detectPlatform(text);

  if (platform === "unknown") {
    bot.sendMessage(chatId, "❌ Platform tidak didukung");
    return;
  }

  // Cache anti spam
  if (!isAdmin(userId) && cache.has(text)) {
    bot.sendMessage(chatId, "⏳ Link ini sedang / sudah diproses");
    return;
  }
  cache.set(text, true);

  bot.sendMessage(chatId, `⏳ Processing *${platform}*\n📦 Queue: ${queue.size}`, {
    parse_mode: "Markdown",
  });

  queue.add(async () => {
    botStats.total++;

    try {
      if (platform === "facebook") {
        const isPrivate = await checkPrivate(text);
        if (isPrivate) {
          bot.sendMessage(
            chatId,
            "🔒 Video Facebook *PRIVATE / LOGIN REQUIRED*\n\n" +
              "❌ Tidak bisa di-download oleh bot.\n" +
              "✅ Pastikan video *Public*",
            { parse_mode: "Markdown" }
          );
          botStats.failed++;
          return;
        }
      }

      const file = await downloadVideo(text, platform);
      await bot.sendVideo(chatId, fs.createReadStream(file));
      fs.unlinkSync(file);

      botStats.success++;
    } catch (e) {
      botStats.failed++;
      bot.sendMessage(chatId, "❌ Download gagal (sumber membatasi akses)");
    }
  });
});
