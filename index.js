import TelegramBot from "node-telegram-bot-api";
import { exec } from "child_process";
import fs from "fs";
import crypto from "crypto";

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_ID = Number(process.env.ADMIN_ID);
const CACHE_DIR = "./cache";

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

// ================= DATA =================
const cooldown = new Map();
const userLinks = new Map();

const stats = {
  totalRequest: 0,
  success: 0,
  cacheHit: 0,
  users: new Set(),
  platform: { YouTube: 0, TikTok: 0, Instagram: 0, Facebook: 0 },
  startTime: Date.now()
};

let errorCount = 0;
let errorWindowStart = Date.now();
let alertSent = false;
let dynamicCooldown = 15000;

// ================= UTILS =================
const detectPlatform = (url) => {
  if (/youtube\.com|youtu\.be/.test(url)) return "YouTube";
  if (/tiktok\.com/.test(url)) return "TikTok";
  if (/instagram\.com/.test(url)) return "Instagram";
  if (/facebook\.com|fb\.watch/.test(url)) return "Facebook";
  return null;
};

const hash = (s) =>
  crypto.createHash("md5").update(s).digest("hex");

const uptime = () => {
  const s = Math.floor((Date.now() - stats.startTime) / 1000);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

function updateCooldown() {
  const errorRate = stats.totalRequest
    ? (errorCount / stats.totalRequest) * 100
    : 0;

  if (stats.totalRequest > 50) dynamicCooldown = 30000;
  else if (errorRate > 20) dynamicCooldown = 60000;
  else dynamicCooldown = 15000;
}

function checkErrorAlert() {
  const now = Date.now();
  if (now - errorWindowStart > 10 * 60 * 1000) {
    errorCount = 0;
    errorWindowStart = now;
    alertSent = false;
    return;
  }

  const errorRate = stats.totalRequest
    ? (errorCount / stats.totalRequest) * 100
    : 0;

  if (!alertSent && (errorCount >= 5 || errorRate >= 30)) {
    alertSent = true;
    bot.sendMessage(
      ADMIN_ID,
      `🚨 ALERT BOT ERROR\n\n❌ Error: ${errorCount}\n📥 Request: ${stats.totalRequest}\n📊 Error Rate: ${errorRate.toFixed(
        1
      )}%\n⏱ Window: 10 menit`
    );
  }
}

// ================= MESSAGE =================
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!text) return;

  // ===== ADMIN STATS =====
  if (text === "/stats" && userId === ADMIN_ID) {
    return bot.sendMessage(
      chatId,
      `📊 BOT STATS

👥 Users: ${stats.users.size}
📥 Total: ${stats.totalRequest}
✅ Success: ${stats.success}
⚡ Cache: ${stats.cacheHit}
🚨 Error: ${errorCount}

🌍 Platform:
YT ${stats.platform.YouTube}
TT ${stats.platform.TikTok}
IG ${stats.platform.Instagram}
FB ${stats.platform.Facebook}

⏱ Uptime: ${uptime()}
⛔ Cooldown: ${dynamicCooldown / 1000}s`
    );
  }

  if (!text.startsWith("http")) return;

  updateCooldown();
  const last = cooldown.get(userId);
  if (last && Date.now() - last < dynamicCooldown) {
    return bot.sendMessage(
      chatId,
      `⛔ Slow down\n⏱ ${dynamicCooldown / 1000}s`
    );
  }
  cooldown.set(userId, Date.now());

  const platform = detectPlatform(text);
  if (!platform) return bot.sendMessage(chatId, "❌ Platform tidak didukung");

  stats.totalRequest++;
  stats.platform[platform]++;
  stats.users.add(userId);
  userLinks.set(userId, text);

  bot.sendMessage(chatId, `📥 ${platform}\nPilih resolusi:`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "360p", callback_data: "360" }, { text: "480p", callback_data: "480" }],
        [{ text: "720p", callback_data: "720" }, { text: "1080p", callback_data: "1080" }]
      ]
    }
  });
});

// ================= CALLBACK =================
bot.on("callback_query", (q) => {
  const userId = q.from.id;
  const chatId = q.message.chat.id;
  const res = q.data;

  const link = userLinks.get(userId);
  if (!link) return;

  const platform = detectPlatform(link);
  const key = hash(link + res);
  const output = `${CACHE_DIR}/${key}.mp4`;

  if (fs.existsSync(output)) {
    stats.cacheHit++;
    stats.success++;
    bot.answerCallbackQuery(q.id);
    return bot.sendVideo(chatId, fs.createReadStream(output), {
      caption: `⚡ Cache | ${platform} ${res}p`
    });
  }

  bot.answerCallbackQuery(q.id, { text: "⏳ Downloading..." });

  exec(
    `yt-dlp -f "bestvideo[height<=${res}]+bestaudio/best" --merge-output-format mp4 -o "${output}" "${link}"`,
    (err) => {
      if (err) {
        errorCount++;
        checkErrorAlert();
        return bot.sendMessage(chatId, "❌ Gagal download");
      }
      stats.success++;
      bot.sendVideo(chatId, fs.createReadStream(output), {
        caption: `✅ ${platform} ${res}p | No Watermark`
      });
    }
  );
});

console.log("🚀 Bot aktif");