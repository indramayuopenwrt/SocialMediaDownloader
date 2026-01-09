import TelegramBot from "node-telegram-bot-api";
import YTDlpWrap from "ytdlp-wrap";
import fs from "fs";
import path from "path";
import LRU from "lru-cache";

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const ytdlp = new YTDlpWrap("/usr/bin/yt-dlp");

const cooldown = new Map();
const stats = {
  total: 0,
  error: 0,
  window: []
};

const cache = new LRU({ max: 50, ttl: 1000 * 60 * 10 });

let dynamicCooldown = 60000;

function detectPlatform(url) {
  if (/facebook|fb/.test(url)) return "Facebook";
  if (/tiktok/.test(url)) return "TikTok";
  if (/instagram|ig/.test(url)) return "Instagram";
  if (/youtube|youtu/.test(url)) return "YouTube";
  return "Unknown";
}

function pickBestFormat(formats) {
  const priorities = [1080, 720, 480, 360];
  for (const res of priorities) {
    const f = formats.find(v =>
      v.height === res &&
      v.vcodec !== "none" &&
      v.acodec !== "none"
    );
    if (f) return f;
  }
  return formats.find(v => v.vcodec !== "none" && v.acodec !== "none");
}

function updateStats(error = false) {
  const now = Date.now();
  stats.total++;
  if (error) stats.error++;
  stats.window.push({ time: now, error });
  stats.window = stats.window.filter(x => now - x.time < 600000);

  const errors = stats.window.filter(x => x.error).length;
  const total = stats.window.length;
  const rate = total ? (errors / total) * 100 : 0;

  if (rate > 50) dynamicCooldown = 120000;
  else dynamicCooldown = 60000;

  if (rate > 70) {
    bot.sendMessage(ADMIN_ID,
      `🚨 ALERT BOT ERROR\n❌ Error: ${errors}\n📦 Request: ${total}\n📊 Error Rate: ${rate.toFixed(1)}%\n⏱ Window: 10 menit`
    );
  }
}

bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || "";

  if (!text.startsWith("http")) return;

  // ADMIN BYPASS SLOW DOWN
  if (userId !== ADMIN_ID) {
    const last = cooldown.get(userId);
    if (last && Date.now() - last < dynamicCooldown) {
      return bot.sendMessage(chatId, `⛔ Slow down\n⏱ ${dynamicCooldown / 1000}s`);
    }
    cooldown.set(userId, Date.now());
  }

  try {
    const platform = detectPlatform(text);
    await bot.sendMessage(chatId, `⬇️ Memproses ${platform}\n🎞 Resolusi terbaik dipilih otomatis`);

    if (cache.has(text)) {
      return bot.sendVideo(chatId, cache.get(text));
    }

    const info = await ytdlp.getInfo(text);
    const format = pickBestFormat(info.formats);
    if (!format) throw new Error("Format tidak ditemukan");

    const file = `downloads/${Date.now()}.mp4`;
    fs.mkdirSync("downloads", { recursive: true });

    await ytdlp.exec([
      text,
      "-f", format.format_id,
      "--merge-output-format", "mp4",
      "-o", file
    ]);

    await bot.sendVideo(chatId, fs.createReadStream(file));
    cache.set(text, fs.createReadStream(file));

    updateStats(false);
  } catch (e) {
    updateStats(true);
    bot.sendMessage(chatId, "❌ Gagal download");
  }
});

bot.onText(/\/stats/, msg => {
  if (msg.from.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id,
    `📊 Statistik Bot\n📦 Total: ${stats.total}\n❌ Error: ${stats.error}\n👑 Admin bypass: ON`
  );
});
