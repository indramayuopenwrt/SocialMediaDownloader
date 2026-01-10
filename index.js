const TelegramBot = require("node-telegram-bot-api");
const { spawn } = require("child_process");
const fs = require("fs");
const PQueue = require("p-queue").default;

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID; // optional

if (!TOKEN) {
  console.error("BOT_TOKEN kosong");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// ===== QUEUE (ANTI CRASH) =====
const queue = new PQueue({
  concurrency: 1,
  intervalCap: 2,
  interval: 5000
});

// ===== STATS =====
const stats = {
  total: 0,
  success: 0,
  failed: 0,
  startTime: Date.now()
};

// ===== UTIL =====
function detectPlatform(url) {
  if (/tiktok\.com/.test(url)) return "TikTok";
  if (/youtu\.be|youtube\.com/.test(url)) return "YouTube";
  if (/facebook\.com|fb\.watch/.test(url)) return "Facebook";
  return "Unknown";
}

// ===== COMMANDS =====
bot.onText(/\/start/, msg => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Kirim link YouTube / TikTok / Facebook\n\n⚡ Auto detect • Queue aman • Anti hang"
  );
});

bot.onText(/\/stats/, msg => {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  bot.sendMessage(
    msg.chat.id,
    `📊 BOT STATS
━━━━━━━━━━━━━━
📥 Total: ${stats.total}
✅ Success: ${stats.success}
❌ Failed: ${stats.failed}
⏱ Uptime: ${uptime}s
📦 Queue: ${queue.size}`
  );
});

// ===== MAIN HANDLER =====
bot.on("message", msg => {
  if (!msg.text) return;
  if (msg.text.startsWith("/")) return;

  const url = msg.text.trim();
  if (!/^https?:\/\//.test(url)) return;

  queue.add(() => handleDownload(msg, url));
});

// ===== DOWNLOAD LOGIC =====
async function handleDownload(msg, url) {
  const chatId = msg.chat.id;
  const platform = detectPlatform(url);

  stats.total++;

  await bot.sendMessage(chatId, `⏳ Processing ${platform}...\n📦 Queue: ${queue.size}`);

  const outFile = `video_${Date.now()}.mp4`;

  const args = [
    "-f",
    "bv*[height<=720]+ba/b[height<=720]",
    "--merge-output-format",
    "mp4",
    "--max-filesize",
    "90M",
    "-o",
    outFile,
    url
  ];

  // ===== SPAWN (ANTI HANG) =====
  const proc = spawn("yt-dlp", args);

  let killed = false;

  const timeout = setTimeout(() => {
    killed = true;
    proc.kill("SIGKILL");
  }, 60000); // 60s MAX

  proc.on("close", async code => {
    clearTimeout(timeout);

    if (killed || code !== 0 || !fs.existsSync(outFile)) {
      stats.failed++;
      await bot.sendMessage(chatId, "❌ Download gagal / timeout");
      cleanup(outFile);
      return;
    }

    try {
      await bot.sendVideo(chatId, outFile, { caption: "✅ Download selesai" });
      stats.success++;
    } catch (e) {
      stats.failed++;
      await bot.sendMessage(chatId, "❌ Gagal kirim ke Telegram (size limit)");
    }

    cleanup(outFile);
  });
}

// ===== CLEANUP =====
function cleanup(file) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

console.log("✅ Bot running...");
