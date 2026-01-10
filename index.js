const TelegramBot = require('node-telegram-bot-api')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const BOT_TOKEN = process.env.BOT_TOKEN
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean)
const COOKIES_PATH = './cookies.txt'
const DOWNLOAD_DIR = './downloads'
const MAX_DAILY = 10

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR)

const bot = new TelegramBot(BOT_TOKEN, { polling: true })

/* ================= MEMORY ================= */
const stats = { total: 0, users: new Set() }
const userLimit = {}

/* ================= UTILS ================= */
const isAdmin = id => ADMIN_IDS.includes(String(id))
const sleep = ms => new Promise(r => setTimeout(r, ms))

const bar = p => '█'.repeat(Math.floor(p / 10)) + '░'.repeat(10 - Math.floor(p / 10))

function platform(url) {
  if (/tiktok\.com/.test(url)) return 'TikTok'
  if (/facebook\.com|fb\.watch/.test(url)) return 'Facebook'
  if (/instagram\.com/.test(url)) return 'Instagram'
  if (/youtu\.be|youtube\.com/.test(url)) return 'YouTube'
  return 'Unknown'
}

/* ================= COMMANDS ================= */
bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id, `
👋 *SocialMediaDownloader*

📥 Kirim link:
• TikTok
• Facebook
• Instagram
• YouTube

✨ Fitur:
• Auto kualitas terbaik (≤1080p)
• Auto kirim DOCUMENT
• Progress realtime
• Metadata caption
• Admin bypass limit

📊 /stats
`, { parse_mode: 'Markdown' })
})

bot.onText(/\/stats/, msg => {
  bot.sendMessage(msg.chat.id, `
📊 *STATISTIK*
• Total download: ${stats.total}
• Total user: ${stats.users.size}
`, { parse_mode: 'Markdown' })
})

/* ================= MAIN ================= */
bot.on('message', async msg => {
  if (!msg.text || msg.text.startsWith('/')) return
  if (!/^https?:\/\//.test(msg.text)) return

  const chatId = msg.chat.id
  const userId = msg.from.id
  const url = msg.text.trim()

  stats.users.add(userId)

  if (!isAdmin(userId)) {
    userLimit[userId] = (userLimit[userId] || 0) + 1
    if (userLimit[userId] > MAX_DAILY)
      return bot.sendMessage(chatId, '⛔ Limit harian tercapai')
  }

  stats.total++

  const plat = platform(url)

  const status = await bot.sendMessage(chatId, `
⏳ Memproses ${plat}...
░░░░░░░░░░ 0%
📦 --
⚡ --
⏱ --
`)

  const output = path.join(DOWNLOAD_DIR, `${Date.now()}.mp4`)

  const args = [
    url,
    '--no-playlist',
    '-f',
    'bv*[height<=1080]/best',
    '-o',
    output,
    '--progress',
    '--newline'
  ]

  if (fs.existsSync(COOKIES_PATH)) {
    args.push('--cookies', COOKIES_PATH)
  }

  const ytdlp = spawn('yt-dlp', args)

  let last = 0
  let percent = 0

  ytdlp.stdout.on('data', async d => {
    const line = d.toString()

    const m = line.match(/(\d+(?:\.\d+)?)%/)
    if (!m) return

    percent = parseFloat(m[1])
    if (Date.now() - last < 5000) return
    last = Date.now()

    try {
      await bot.editMessageText(`
⏳ Download ${plat}
${bar(percent)} ${percent.toFixed(0)}%
`, {
        chat_id: chatId,
        message_id: status.message_id
      })
    } catch {}
  })

  ytdlp.on('close', async code => {
    if (code !== 0 || !fs.existsSync(output)) {
      return bot.editMessageText('❌ Gagal download', {
        chat_id: chatId,
        message_id: status.message_id
      })
    }

    await bot.editMessageText('✅ Download selesai\n📤 Mengirim file...', {
      chat_id: chatId,
      message_id: status.message_id
    })

    await bot.sendDocument(chatId, output, {
      caption: `📥 ${plat}\n🎯 Kualitas terbaik otomatis`,
    })

    fs.unlinkSync(output)
  })
})

console.log('✅ BOT RUNNING (PRODUCTION)')
