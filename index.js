const TelegramBot = require('node-telegram-bot-api')
const { spawn } = require('child_process')
const fs = require('fs')
const crypto = require('crypto')

/* ================= CONFIG ================= */
const BOT_TOKEN = process.env.BOT_TOKEN
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(x=>x.trim())
const COOKIES_PATH = process.env.COOKIES_PATH || ''
const MAX_USER_DAILY = 20
const TMP = '/tmp'

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN kosong')
  process.exit(1)
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true })

/* ================= STATE ================= */
const queue = []
let busy = false

const stats = {
  start: Date.now(),
  downloads: 0,
  mp3: 0,
  users: new Set()
}

const userUsage = {}

/* ================= UTIL ================= */
const isAdmin = id => ADMIN_IDS.includes(String(id))

const limitReached = id =>
  !isAdmin(id) && (userUsage[id] || 0) >= MAX_USER_DAILY

const incUser = id => {
  stats.users.add(id)
  userUsage[id] = (userUsage[id] || 0) + 1
}

const progressBar = p => {
  const t = 10
  const f = Math.round((p / 100) * t)
  return '█'.repeat(f) + '░'.repeat(t - f)
}

/* ================= QUEUE ================= */
async function processQueue() {
  if (busy || queue.length === 0) return
  busy = true
  const job = queue.shift()
  try { await job() } catch(e){ console.error(e) }
  busy = false
  processQueue()
}

/* ================= yt-dlp REAL PROGRESS ================= */
function downloadMedia({ url, audioOnly, chatId, statusMsg }) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const out = audioOnly ? `${TMP}/${id}.mp3` : `${TMP}/${id}.mp4`
    const info = `${TMP}/${id}.info.json`

    const args = audioOnly
      ? [
          '-x','--audio-format','mp3','--audio-quality','0',
          '--embed-metadata','--write-info-json','--no-playlist',
          ...(COOKIES_PATH ? ['--cookies', COOKIES_PATH] : []),
          '-o', out, url
        ]
      : [
          '-f','bv*[height<=1080]+ba/best/best',
          '--merge-output-format','mp4',
          '--embed-metadata','--write-info-json','--no-playlist',
          ...(COOKIES_PATH ? ['--cookies', COOKIES_PATH] : []),
          '-o', out, url
        ]

    const ytdlp = spawn('yt-dlp', args)
    let lastEdit = 0

    ytdlp.stdout.on('data', async data => {
      const t = data.toString()
      const m = t.match(/(\d{1,3}\.\d)%.*?at\s+([^\s]+).*?ETA\s+([0-9:]+)/)
      if (m && Date.now() - lastEdit > 1200) {
        lastEdit = Date.now()
        const p = parseFloat(m[1])
        await bot.editMessageText(
          `📥 Downloading...\n⏳ ${p}%\n${progressBar(p)}\n⚡ ${m[2]}\n🕒 ETA ${m[3]}`,
          { chat_id: chatId, message_id: statusMsg.message_id }
        ).catch(()=>{})
      }
    })

    ytdlp.on('close', () => {
      if (!fs.existsSync(out) || fs.statSync(out).size < 200_000)
        return reject(new Error('File rusak / 0B'))

      let meta = {}
      if (fs.existsSync(info)) {
        const j = JSON.parse(fs.readFileSync(info))
        meta = {
          title: j.title,
          author: j.uploader || j.channel,
          desc: j.description,
          duration: j.duration ? `${j.duration}s` : '-'
        }
      }

      resolve({ file: out, meta, size: fs.statSync(out).size })
    })
  })
}

/* ================= COMMANDS ================= */
bot.onText(/^\/start/, msg => {
  bot.sendMessage(msg.chat.id,
`👋 *Downloader Bot*

📥 Kirim link video:
TikTok / IG / FB / YouTube

🎵 /mp3 <link>
📊 /stats

✅ Auto kualitas terbaik
✅ Progress real
✅ Metadata asli
`, { parse_mode:'Markdown' })
})

bot.onText(/^\/stats/, msg => {
  bot.sendMessage(msg.chat.id,
`📊 *STATISTIK*
⬇️ Video: ${stats.downloads}
🎵 MP3: ${stats.mp3}
👤 User: ${stats.users.size}
⏱ Uptime: ${((Date.now()-stats.start)/60000).toFixed(1)} menit`,
{ parse_mode:'Markdown' })
})

/* ================= MP3 ================= */
bot.onText(/^\/mp3\s+(.+)/i, (msg, m) => {
  const url = m[1]
  const uid = msg.from.id
  const cid = msg.chat.id
  if (limitReached(uid)) return bot.sendMessage(cid,'⛔ Limit harian')

  queue.push(async ()=>{
    incUser(uid); stats.mp3++
    const status = await bot.sendMessage(cid,'🎵 Memulai MP3...')
    const r = await downloadMedia({ url, audioOnly:true, chatId:cid, statusMsg:status })

    await bot.sendAudio(cid, r.file, {
      caption:
`🎵 *MP3*
👤 ${r.meta.author||'-'}
📝 ${r.meta.title||'-'}
⏱ ${r.meta.duration}
📦 ${(r.size/1024/1024).toFixed(2)} MB`,
      parse_mode:'Markdown'
    })
    fs.unlinkSync(r.file)
  })
  processQueue()
})

/* ================= LINK HANDLER ================= */
bot.on('message', msg => {
  if (!msg.text || msg.text.startsWith('/')) return
  if (!/^https?:\/\//i.test(msg.text)) return

  const url = msg.text.trim()
  const uid = msg.from.id
  const cid = msg.chat.id
  if (limitReached(uid)) return bot.sendMessage(cid,'⛔ Limit harian')

  queue.push(async ()=>{
    incUser(uid); stats.downloads++
    const status = await bot.sendMessage(cid,'📥 Memulai download...')
    const r = await downloadMedia({ url, audioOnly:false, chatId:cid, statusMsg:status })

    await bot.sendDocument(cid, r.file, {
      caption:
`🎬 *VIDEO*
👤 ${r.meta.author||'-'}
📝 ${r.meta.title||'-'}
⏱ ${r.meta.duration}
📦 ${(r.size/1024/1024).toFixed(2)} MB`,
      parse_mode:'Markdown'
    })
    fs.unlinkSync(r.file)
  })
  processQueue()
})

console.log('✅ BOT PRODUKSI AKTIF')
