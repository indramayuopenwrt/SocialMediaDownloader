const TelegramBot = require("node-telegram-bot-api");
const ytdlp = require("yt-dlp-exec");
const fs = require("fs");
const LRU = require("lru-cache");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

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

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || "";

  if (!text.startsWith("http")) return;

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

    fs.mkdirSync("downloads", { recursive: true });
    const output = `downloads/${Date.now()}.mp4`;

    await ytdlp(text, {
      output,
      format: "bv*+ba/b",
      mergeOutputFormat: "mp4"
    });

    await bot.sendVideo(chatId, fs.createReadStream(output));
    cache.set(text, fs.createReadStream(output));

  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, "❌ Gagal download");
  }
});

bot.onText(/\/stats/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, "📊 Bot aktif & stabil");
});

console.log("🤖 Bot berjalan...");    );
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
