// =====================
// CONFIG
// =====================
const TelegramBot = require("node-telegram-bot-api")
const { exec } = require("child_process")
const LRU = require("lru-cache")
const fs = require("fs")
const path = require("path")

const TOKEN = process.env.BOT_TOKEN
const ADMIN_ID = Number(process.env.ADMIN_ID) // telegram user id admin
const DOWNLOAD_DIR = "/tmp"

// =====================
// BOT INIT
// =====================
const bot = new TelegramBot(TOKEN, { polling: true })

// =====================
// CACHE & LIMITER
// =====================
const cache = new LRU({
  max: 100,
  ttl: 1000 * 60 * 30 // 30 menit
})

const userCooldown = new Map()
let globalCooldown = 10 // detik (auto scale)

// =====================
// UTILS
// =====================
function isAdmin(id) {
  return id === ADMIN_ID
}

function detectPlatform(url) {
  if (/youtu\.?be/.test(url)) return "YouTube"
  if (/tiktok\.com/.test(url)) return "TikTok"
  if (/instagram\.com/.test(url)) return "Instagram"
  if (/facebook\.com|fb\.watch/.test(url)) return "Facebook"
  return "Unknown"
}

function canRequest(userId) {
  if (isAdmin(userId)) return true

  const last = userCooldown.get(userId) || 0
  const now = Date.now()

  if (now - last < globalCooldown * 1000) return false

  userCooldown.set(userId, now)
  return true
}

// =====================
// AUTO RESOLUTION (≤1080p)
// =====================
function buildYtDlpCommand(url) {
  return `
yt-dlp \
-f "bv*[height<=1080]+ba/b[height<=1080]" \
--merge-output-format mp4 \
--no-playlist \
--no-warnings \
-o "${DOWNLOAD_DIR}/%(id)s.%(ext)s" \
"${url}"
`
}

// =====================
// DOWNLOAD HANDLER
// =====================
async function handleDownload(msg, url) {
  const chatId = msg.chat.id
  const userId = msg.from.id

  if (!canRequest(userId)) {
    return bot.sendMessage(chatId, "⏳ Slow down, tunggu sebentar...")
  }

  if (cache.has(url)) {
    return bot.sendVideo(chatId, cache.get(url))
  }

  const platform = detectPlatform(url)
  await bot.sendMessage(chatId, `📥 ${platform} terdeteksi\n⚙️ Memproses...`)

  exec(buildYtDlpCommand(url), async (err, stdout, stderr) => {
    if (err) {
      console.error(err)
      globalCooldown = Math.min(globalCooldown + 10, 60)
      return bot.sendMessage(chatId, "❌ Gagal download")
    }

    const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.endsWith(".mp4"))
    if (!files.length) return bot.sendMessage(chatId, "❌ File tidak ditemukan")

    const filePath = path.join(DOWNLOAD_DIR, files[0])
    cache.set(url, filePath)

    await bot.sendVideo(chatId, filePath)
    fs.unlinkSync(filePath)
  })
}

// =====================
// COMMANDS
// =====================
bot.onText(/\/start/, async msg => {
  await bot.sendMessage(
    msg.chat.id,
    "👋 Kirim link YouTube / FB / IG / TikTok untuk download HD"
  )
})

bot.onText(/\/stats/, async msg => {
  const text = `
📊 *Statistik Bot*
👥 User aktif: ${userCooldown.size}
💾 Cache: ${cache.size}
⏱ Cooldown global: ${globalCooldown}s
  `
  await bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" })
})

// =====================
// URL HANDLER
// =====================
bot.on("message", async msg => {
  if (!msg.text) return
  if (msg.text.startsWith("/")) return

  const url = msg.text.trim()
  if (!/^https?:\/\//.test(url)) return

  await handleDownload(msg, url)
})

// =====================
// ERROR SAFETY
// =====================
process.on("unhandledRejection", err => console.error(err))
process.on("uncaughtException", err => console.error(err))

console.log("✅ Bot running...")}

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
