/* ================= CONFIG ================= */
const TelegramBot = require('node-telegram-bot-api')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const BOT_TOKEN = process.env.BOT_TOKEN
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(x => x.trim())
const COOKIES_PATH = './cookies.txt'
const DOWNLOAD_DIR = './downloads'
const MAX_DAILY = 10

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR)

const bot = new TelegramBot(BOT_TOKEN, { polling: true })

/* ================= MEMORY ================= */
const stats = {
  total: 0,
  users: new Set()
}
const userLimit = {}
const metaCache = new Map()

/* ================= UTILS ================= */
const sleep = ms => new Promise(r => setTimeout(r, ms))

function isAdmin(id) {
  return ADMIN_IDS.includes(String(id))
}

function progressBar(percent, size = 10) {
  const filled = Math.round((percent / 100) * size)
  return '█'.repeat(filled) + '░'.repeat(size - filled)
}

function detectPlatform(url) {
  if (/tiktok\.com/.test(url)) return 'TikTok'
  if (/facebook\.com|fb\.watch/.test(url)) return 'Facebook'
  if (/youtu\.be|youtube\.com/.test(url)) return 'YouTube'
  if (/instagram\.com/.test(url)) return 'Instagram'
  return 'Unknown'
}

/* ================= COMMANDS ================= */
bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id, `
👋 *SocialMediaDownloader Bot*

📥 Kirim link:
• YouTube
• Facebook
• TikTok
• Instagram

✨ Fitur:
• Auto kualitas terbaik (≤1080p)
• Auto kirim DOCUMENT
• Progress bar realtime
• Metadata + caption
• Admin bypass limit

📊 /stats – Statistik bot
`, { parse_mode: 'Markdown' })
})

bot.onText(/\/stats/, msg => {
  bot.sendMessage(msg.chat.id, `
📊 *STATISTIK BOT*
• Total download: ${stats.total}
• Total user: ${stats.users.size}
`, { parse_mode: 'Markdown' })
})

/* ================= MAIN HANDLER ================= */
bot.on('message', async msg => {
  if (!msg.text || msg.text.startsWith('/')) return

  const chatId = msg.chat.id
  const userId = msg.from.id
  const url = msg.text.trim()

  if (!/^https?:\/\//.test(url)) return

  stats.users.add(userId)

  if (!isAdmin(userId)) {
    userLimit[userId] = (userLimit[userId] || 0) + 1
    if (userLimit[userId] > MAX_DAILY) {
      return bot.sendMessage(chatId, '⛔ Limit harian tercapai')
    }
  }

  stats.total++

  const platform = detectPlatform(url)

  const statusMsg = await bot.sendMessage(chatId, `
⏳ Memproses ${platform}...
░░░░░░░░░░ 0%
📦 --
⚡ --
⏱ --
`)

  const outFile = path.join(
    DOWNLOAD_DIR,
    `${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`
  )

  const args = [
    url,
    '-f',
    'bv*[height<=1080]/bv*+ba/best',
    '--merge-output-format', 'mp4',
    '--newline',
    '--cookies', COOKIES_PATH,
    '-o', outFile,
    '--print', '%(title)s',
    '--print', '%(duration)s',
    '--print', '%(uploader)s',
    '--print', '%(view_count)s'
  ]

  const ytdlp = spawn('yt-dlp', args)

  let lastUpdate = 0
  let meta = {}

  ytdlp.stdout.on('data', async data => {
    const text = data.toString()

    // METADATA CACHE
    if (!meta.title && !text.startsWith('[download]')) {
      const lines = text.trim().split('\n')
      if (lines.length >= 4) {
        meta = {
          title: lines[0],
          duration: lines[1],
          uploader: lines[2],
          views: lines[3]
        }
        metaCache.set(url, meta)
      }
    }

    // PROGRESS
    const m = text.match(
      /(\d+\.\d+)%.*?of\s+([\d.]+)(MiB|GiB).*?at\s+([\d.]+)(MiB|KiB)\/s.*?ETA\s+(\d+:\d+)/
    )
    if (!m) return

    const now = Date.now()
    if (now - lastUpdate < 5000) return
    lastUpdate = now

    const percent = parseFloat(m[1])
    const bar = progressBar(percent)

    try {
      await bot.editMessageText(`
⏳ Download ${platform}
${bar} ${percent.toFixed(0)}%
📦 ${m[2]} ${m[3]}
⚡ ${m[4]} ${m[5]}/s
⏱ ${m[6]}
`, {
        chat_id: chatId,
        message_id: statusMsg.message_id
      })
    } catch {}
  })

  ytdlp.on('close', async code => {
    if (code !== 0 || !fs.existsSync(outFile)) {
      return bot.sendMessage(chatId, '❌ Gagal download')
    }

    await bot.editMessageText(`
✅ Download selesai
██████████ 100%
📤 Mengirim file...
`, {
      chat_id: chatId,
      message_id: statusMsg.message_id
    })

    const caption = `
📥 *${meta.title || 'Video'}*
🌐 Platform: ${platform}
👤 ${meta.uploader || '-'}
👁 ${meta.views || '-'} views
⏱ ${meta.duration || '-'} detik
`

    await bot.sendDocument(chatId, outFile, {
      caption,
      parse_mode: 'Markdown'
    })

    fs.unlinkSync(outFile)
  })
})

console.log('✅ BOT RUNNING (COMMONJS)')
