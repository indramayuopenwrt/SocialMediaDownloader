const TelegramBot = require("node-telegram-bot-api");
const YTDlpWrap = require("ytdlp-wrap").default;
const fs = require("fs");
const LRU = require("lru-cache");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN belum di set");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const ytdlp = new YTDlpWrap("/usr/bin/yt-dlp");

const cooldown = new Map();
const cache = new LRU({ max: 50, ttl: 1000 * 60 * 10 });

const COOLDOWN_TIME = 60000;

function detectPlatform(url) {
  if (/facebook|fb/.test(url)) return "Facebook";
  if (/tiktok/.test(url)) return "TikTok";
  if (/instagram|ig/.test(url)) return "Instagram";
  if (/youtube|youtu/.test(url)) return "YouTube";
  return "Unknown";
}

function pickBestFormat(formats) {
  const priority = [1080, 720, 480, 360];
  for (const r of priority) {
    const f = formats.find(x =>
      x.height === r &&
      x.vcodec !== "none" &&
      x.acodec !== "none"
    );
    if (f) return f;
  }
  return formats.find(x => x.vcodec !== "none" && x.acodec !== "none");
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || "";

  if (!text.startsWith("http")) return;

  // Slow down (ADMIN BYPASS)
  if (userId !== ADMIN_ID) {
    const last = cooldown.get(userId);
    if (last && Date.now() - last < COOLDOWN_TIME) {
      return bot.sendMessage(chatId, "⛔ Slow down 60 detik");
    }
    cooldown.set(userId, Date.now());
  }

  try {
    if (cache.has(text)) {
      return bot.sendVideo(chatId, cache.get(text));
    }

    await bot.sendMessage(
      chatId,
      `⬇️ ${detectPlatform(text)}\n🎞 Auto detect resolusi`
    );

    const info = await ytdlp.getInfo(text);
    const format = pickBestFormat(info.formats);
    if (!format) throw new Error("Format tidak ditemukan");

    fs.mkdirSync("downloads", { recursive: true });
    const filePath = `downloads/${Date.now()}.mp4`;

    await ytdlp.exec([
      text,
      "-f", format.format_id,
      "--merge-output-format", "mp4",
      "-o", filePath
    ]);

    await bot.sendVideo(chatId, fs.createReadStream(filePath));
    cache.set(text, fs.createReadStream(filePath));

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Gagal download");
  }
});

bot.onText(/\/stats/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, "📊 Bot aktif & stabil");
});

console.log("🤖 Bot Telegram berjalan...");
