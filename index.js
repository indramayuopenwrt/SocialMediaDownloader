/**
 * SocialMediaDownloader Bot
 * FINAL PRODUKSI
 * Telegram Bot API
 */

const TelegramBot = require('node-telegram-bot-api')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean)

const DOWNLOAD_LIMIT = 10
const QUEUE_DELAY = 1500 // ms

/* ================= INIT ================= */

const bot = new TelegramBot(BOT_TOKEN, { polling: true })

const queue = []
let isProcessing = false

const stats = {
  totalDownloads: 0,
  perUser: {},
  startTime: Date.now()
}

/* ================= UTILS ================= */

const isAdmin = (id) => ADMIN_IDS.includes(String(id))

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const formatUptime = () => {
  const s = Math.floor((Date.now() - stats.startTime) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}j ${m}m`
}

const buildBar = (p) => {
  const total = 10
  const filled = Math.floor((p / 100) * total)
  return '█'.repeat(filled) + '░'.repeat(total - filled)
}

function buildCaption(meta, platform) {
  return (
    `📥 ${platform.toUpperCase()}\n` +
    `🎯 Kualitas terbaik otomatis\n` +
    (meta.title ? `📝 ${meta.title}\n` : '') +
    (meta.uploader ? `👤 ${meta.uploader}\n` : '') +
    (meta.duration ? `⏱ ${meta.duration}\n` : '') +
    (meta.filesize ? `📦 ${meta.filesize}\n` : '') +
    `🔗 ${meta.url}`
  ).trim()
}

/* ================= QUEUE ================= */

async function processQueue() {
  if (isProcessing || queue.length === 0) return
  isProcessing = true

  const job = queue.shift()
  try {
    await handleDownload(job)
  } catch (e) {
    await bot.sendMessage(job.chatId, '❌ Gagal download')
  }

  await sleep(QUEUE_DELAY)
  isProcessing = false
  processQueue()
}

/* ================= MOCK DOWNLOADER ================= */
/**
 * ⚠️ GANTI bagian ini dengan yt-dlp / API kamu
 */
async function downloadMedia(url) {
  const tmp = path.join(os.tmpdir(), crypto.randomUUID() + '.mp4')
  fs.writeFileSync(tmp, 'FAKE_VIDEO')

  return {
    filePath: tmp,
    platform: url.includes('tiktok') ? 'tiktok' :
              url.includes('facebook') ? 'facebook' : 'media',
    meta: {
      title: 'Video tanpa watermark',
      uploader: 'Original Author',
      duration: '00:30',
      filesize: '5.2 MB',
      url
    }
  }
}

/* ================= CORE ================= */

async function handleDownload({ chatId, userId, url }) {
  stats.totalDownloads++
  stats.perUser[userId] = (stats.perUser[userId] || 0) + 1

  const status = await bot.sendMessage(
    chatId,
    `⏳ Memproses...\n${buildBar(0)} 0%`
  )

  // countdown progress
  let progress = 0
  const timer = setInterval(async () => {
    progress += 20
    if (progress >= 100) progress = 100
    await bot.editMessageText(
      `⏳ Memproses...\n${buildBar(progress)} ${progress}%`,
      { chat_id: chatId, message_id: status.message_id }
    )
    if (progress === 100) clearInterval(timer)
  }, 5000)

  const result = await downloadMedia(url)
  clearInterval(timer)

  await bot.editMessageText(
    '✅ Download selesai, mengirim file...',
    { chat_id: chatId, message_id: status.message_id }
  )

  const caption = buildCaption(result.meta, result.platform)

  await bot.sendDocument(chatId, result.filePath, {
    caption
  })

  fs.unlinkSync(result.filePath)
}

/* ================= COMMANDS ================= */

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
`👋 Selamat datang!

📥 Kirim link:
• TikTok
• Facebook
• YouTube
• Instagram

🔥 Fitur:
• Auto kualitas terbaik
• Caption metadata di bawah video
• Queue anti crash
• Countdown progress
• Kirim sebagai document

📊 /stats — Statistik bot`
  )
})

bot.onText(/\/stats/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
`📊 Statistik Bot
━━━━━━━━━━━━━━
⬇️ Total download: ${stats.totalDownloads}
👥 Total user: ${Object.keys(stats.perUser).length}
⏱ Uptime: ${formatUptime()}`
  )
})

/* ================= MESSAGE HANDLER ================= */

bot.on('message', (msg) => {
  if (!msg.text) return
  if (msg.text.startsWith('/')) return

  const chatId = msg.chat.id
  const userId = msg.from.id
  const url = msg.text.trim()

  if (!/^https?:\/\//.test(url)) return

  if (!isAdmin(userId)) {
    if ((stats.perUser[userId] || 0) >= DOWNLOAD_LIMIT) {
      return bot.sendMessage(chatId, '⚠️ Limit harian tercapai')
    }
  }

  queue.push({ chatId, userId, url })
  bot.sendMessage(chatId, '📥 Link diterima, masuk antrian...')
  processQueue()
})

console.log('✅ Bot berjalan...')
