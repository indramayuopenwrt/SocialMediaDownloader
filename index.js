const TelegramBot = require("node-telegram-bot-api")
const { exec } = require("child_process")
const fs = require("fs")
const path = require("path")
const LRU = require("lru-cache")

// ===== ENV =====
const TOKEN = process.env.BOT_TOKEN
const ADMIN_ID = Number(process.env.ADMIN_ID)
const DOWNLOAD_DIR = "/tmp"

// ===== BOT =====
const bot = new TelegramBot(TOKEN, { polling: true })

// ===== CACHE =====
const cache = new LRU({
  max: 100,
  ttl: 1000 * 60 * 30
})

// ===== COOLDOWN =====
const userCooldown = new Map()
let globalCooldown = 10

// ===== QUEUE =====
const queue = []
let isProcessing = false

// ===== UTILS =====
const isAdmin = id => id === ADMIN_ID

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

function buildCmd(url) {
  return `yt-dlp -f "bv*[height<=1080]+ba/b[height<=1080]" --merge-output-format mp4 -o "${DOWNLOAD_DIR}/%(id)s.%(ext)s" "${url}"`
}

// ===== QUEUE PROCESSOR =====
async function processQueue() {
  if (isProcessing || queue.length === 0) return

  isProcessing = true
  const job = queue.shift()

  const { msg, url } = job
  const chatId = msg.chat.id
  const platform = detectPlatform(url)

  try {
    await bot.sendMessage(chatId, `⏳ Memproses (${platform})...\n📥 Antrian tersisa: ${queue.length}`)

    exec(buildCmd(url), async err => {
      if (err) {
        globalCooldown = Math.min(globalCooldown + 10, 60)
        await bot.sendMessage(chatId, "❌ Gagal download")
        isProcessing = false
        processQueue()
        return
      }

      const file = fs.readdirSync(DOWNLOAD_DIR).find(f => f.endsWith(".mp4"))
      if (!file) {
        await bot.sendMessage(chatId, "❌ File tidak ditemukan")
        isProcessing = false
        processQueue()
        return
      }

      const filePath = path.join(DOWNLOAD_DIR, file)
      cache.set(url, filePath)

      await bot.sendVideo(chatId, filePath)
      fs.unlinkSync(filePath)

      isProcessing = false
      processQueue()
    })
  } catch (e) {
    console.error(e)
    isProcessing = false
    processQueue()
  }
}

// ===== HANDLER =====
async function enqueueDownload(msg, url) {
  const chatId = msg.chat.id
  const userId = msg.from.id

  if (!canRequest(userId)) {
    return bot.sendMessage(chatId, "⏳ Slow down...")
  }

  if (cache.has(url)) {
    return bot.sendVideo(chatId, cache.get(url))
  }

  queue.push({ msg, url })
  await bot.sendMessage(chatId, `📥 Ditambahkan ke antrian\n🧠 Posisi: ${queue.length}`)

  processQueue()
}

// ===== COMMANDS =====
bot.onText(/\/start/, async msg => {
  await bot.sendMessage(msg.chat.id, "👋 Kirim link video (YT / FB / IG / TikTok)")
})

bot.onText(/\/stats/, async msg => {
  await bot.sendMessage(
    msg.chat.id,
    `📊 *Statistik Bot*
👥 User aktif: ${userCooldown.size}
🧠 Antrian: ${queue.length}
💾 Cache: ${cache.size}
⏱ Cooldown: ${globalCooldown}s`,
    { parse_mode: "Markdown" }
  )
})

// ===== MESSAGE =====
bot.on("message", async msg => {
  if (!msg.text) return
  if (msg.text.startsWith("/")) return
  if (!msg.text.startsWith("http")) return

  await enqueueDownload(msg, msg.text.trim())
})

// ===== SAFETY =====
process.on("unhandledRejection", console.error)
process.on("uncaughtException", console.error)

console.log("✅ Bot running with QUEUE...")
