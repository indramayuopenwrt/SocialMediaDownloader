const TelegramBot = require("node-telegram-bot-api");
const ytdlp = require("yt-dlp-exec");
const fs = require("fs");
const LRU = require("lru-cache");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const cache = new LRU({ max: 50, ttl: 1000 * 60 * 10 });
const cooldown = new Map();
const COOLDOWN = 60000;

function detectPlatform(url) {
  if (/tiktok/.test(url)) return "TikTok";
  if (/facebook|fb/.test(url)) return "Facebook";
  if (/instagram|ig/.test(url)) return "Instagram";
  if (/youtu/.test(url)) return "YouTube";
  return "Unknown";
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const url = msg.text;

  if (!url || !url.startsWith("http")) return;

  if (userId !== ADMIN_ID) {
    const last = cooldown.get(userId);
    if (last && Date.now() - last < COOLDOWN) {
      return bot.sendMessage(chatId, "⏳ Tunggu 60 detik");
    }
    cooldown.set(userId, Date.now());
  }

  try {
    if (cache.has(url)) {
      return bot.sendVideo(chatId, cache.get(url));
    }

    await bot.sendMessage(
      chatId,
      `⬇️ ${detectPlatform(url)}\n🎞 Auto detect resolusi`
    );

    fs.mkdirSync("downloads", { recursive: true });
    const file = `downloads/${Date.now()}.mp4`;

    await ytdlp(url, {
      output: file,
      format: "bv*+ba/b",
      mergeOutputFormat: "mp4"
    });

    await bot.sendVideo(chatId, fs.createReadStream(file));
    cache.set(url, fs.createReadStream(file));

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Gagal memproses video");
  }
});

bot.onText(/\/stats/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, "📊 Bot aktif & stabil");
});

console.log("🤖 Bot berjalan...");
