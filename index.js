const TelegramBot = require("node-telegram-bot-api")
const { LRUCache } = require("lru-cache")
const YTDlpWrap = require("ytdlp-wrap").default
const fs = require("fs")
const path = require("path")

/* ================= CONFIG ================= */
const BOT_TOKEN = process.env.BOT_TOKEN
const ADMIN_ID = Number(process.env.ADMIN_ID || 0)
const DOWNLOAD_DIR = "./downloads"
/* ========================================== */

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN belum di-set")
  process.exit(1)
}

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR)
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true })
const ytdlp = new YTDlpWrap()

/* ================= CACHE ================= */
const cache = new LRUCache({
  max: 100,
  ttl: 1000 * 60 * 30 // 30 menit
})

const userCooldown = new Map()
let globalCooldown = 5 // detik

/* ============== UTILITIES ================ */
function isAdmin(id) {
  return id === ADMIN_ID
}

function detectPlatform(url) {
  if (/youtube|youtu\.be/.test(url)) return "YouTube"
  if (/tiktok/.test(url)) return "TikTok"
  if (/instagram/.test(url)) return "Instagram"
  if (/facebook|fb\.watch/.test(url)) return "Facebook"
  return "Unknown"
}

function canDownload(userId) {
  if (isAdmin(userId)) return true
  const last = userCooldown.get(userId) || 0
  return Date.now() - last > globalCooldown * 1000
}

function setCooldown(userId) {
  if (!isAdmin(userId)) {
    userCooldown.set(userId, Date.now())
  }
}

/* ============== BOT COMMANDS ============== */
bot.onText(/\/start/, msg => {
  bot.sendMessage(
    msg.chat.id,
    `🤖 *Downloader Bot*\n\nKirim link:\nYouTube / TikTok / Instagram / Facebook\n\n🎥 Auto HD • No Watermark`,
    { parse_mode: "Markdown" }
  )
})

bot.on("message", async msg => {
  const chatId = msg.chat.id
  const userId = msg.from.id
  const text = msg.text

  if (!text || text.startsWith("/")) return
  if (!/^https?:\/\//.test(text)) return

  if (!canDownload(userId)) {
    return bot.sendMessage(chatId, "⏳ Tunggu sebentar sebelum download lagi")
  }

  setCooldown(userId)

  if (cache.has(text)) {
    return bot.sendMessage(chatId, "⚡ Video sudah diproses sebelumnya (cache aktif)")
  }

  const platform = detectPlatform(text)
  bot.sendMessage(chatId, `📥 Memproses ${platform}...`)

  try {
    const filename = `${Date.now()}.mp4`
    const filepath = path.join(DOWNLOAD_DIR, filename)

    // Auto resolusi terbaik ≤1080p
    await ytdlp.exec([
      text,
      "-f",
      "bv*[height<=1080]+ba/best",
      "--merge-output-format",
      "mp4",
      "-o",
      filepath
    ])

    await bot.sendVideo(chatId, filepath, {
      caption: `✅ Download selesai\n🎞 Platform: ${platform}`
    })

    cache.set(text, true)
    fs.unlinkSync(filepath)
  } catch (err) {
    console.error(err)
    bot.sendMessage(chatId, "❌ Gagal download video")

    if (!isAdmin(userId)) {
      globalCooldown = Math.min(globalCooldown + 5, 60)
    }
  }
})

console.log("🤖 Bot berjalan...")
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
