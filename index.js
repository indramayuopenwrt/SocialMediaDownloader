import TelegramBot from 'node-telegram-bot-api';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(Number);
const COOKIES = process.env.COOKIES || '';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/* ================= CONFIG ================= */
const TMP_DIR = './tmp';
const MAX_QUEUE = 3;
const USER_LIMIT = 5;
const CACHE_TTL = 1000 * 60 * 60;

/* ================= STATE ================= */
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
const queue = [];
let running = 0;

const userUsage = new Map();
const metaCache = new Map();
const fileCache = new Map();

/* ================= UTILS ================= */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = s => crypto.createHash('md5').update(s).digest('hex');

function isAdmin(id) {
  return ADMIN_IDS.includes(id);
}

function canUse(userId) {
  if (isAdmin(userId)) return true;
  const used = userUsage.get(userId) || 0;
  if (used >= USER_LIMIT) return false;
  userUsage.set(userId, used + 1);
  return true;
}

function cleanup() {
  for (const f of fs.readdirSync(TMP_DIR)) {
    const p = path.join(TMP_DIR, f);
    if (Date.now() - fs.statSync(p).mtimeMs > CACHE_TTL) {
      fs.unlinkSync(p);
    }
  }
}

/* ================= CAPTION FORMAT ================= */
function buildCaption(meta) {
  const l = [];
  l.push(`ðŸŽ¬ ${meta.platform} Video`);
  l.push('');

  if (meta.author) l.push(`ðŸ‘¤ ${meta.author}`);
  if (meta.description && meta.description !== meta.author)
    l.push(`ðŸ“ ${meta.description}`);

  if (meta.views || meta.likes) {
    l.push('');
    l.push(`ðŸ‘ï¸ ${meta.views || '-'} views   ðŸ‘ ${meta.likes || '-'}`);
  }

  l.push(`â±ï¸ ${meta.duration || '-'} detik`);
  l.push(`ðŸ“¦ ${meta.size || '-'}`);

  return l.join('\n');
}

/* ================= PLATFORM ================= */
function detectPlatform(url) {
  if (/tiktok/i.test(url)) return 'TikTok';
  if (/facebook|fb/i.test(url)) return 'Facebook';
  if (/instagram|ig/i.test(url)) return 'Instagram';
  if (/youtu/i.test(url)) return 'YouTube';
  return 'Video';
}

/* ================= YT-DLP ================= */
function runYtdlp(url, isMp3, progressCb) {
  return new Promise((resolve, reject) => {
    const id = hash(url);
    const out = `${TMP_DIR}/${id}.%(ext)s`;

    const cmd = [
      'yt-dlp',
      COOKIES ? `--cookies-from-browser ${COOKIES}` : '',
      '--newline',
      '--no-playlist',
      isMp3
        ? '-x --audio-format mp3'
        : '-f bestvideo+bestaudio/best',
      `-o "${out}"`,
      `"${url}"`
    ].join(' ');

    const p = exec(cmd);

    p.stdout.on('data', d => {
      const m = d.toString().match(/(\d+\.\d+)%.*?ETA\s+(\d+:\d+)/);
      if (m) progressCb(m[1], m[2]);
    });

    p.on('close', code => {
      if (code !== 0) return reject();
      const file = fs
        .readdirSync(TMP_DIR)
        .find(f => f.startsWith(id));
      resolve(path.join(TMP_DIR, file));
    });
  });
}

/* ================= META ================= */
function extractMeta(url) {
  return new Promise(resolve => {
    if (metaCache.has(url)) return resolve(metaCache.get(url));

    exec(`yt-dlp -j "${url}"`, (e, out) => {
      if (e) return resolve({});
      const i = JSON.parse(out);
      const meta = {
        platform: detectPlatform(url),
        author: i.uploader || i.channel,
        description:
          i.description && i.description.length < 200
            ? i.description
            : i.title,
        views: i.view_count ? `${Math.round(i.view_count / 1000)}K` : null,
        likes: i.like_count ? `${Math.round(i.like_count / 1000)}K` : null,
        duration: i.duration ? i.duration.toFixed(2) : null,
        size: i.filesize_approx
          ? `${(i.filesize_approx / 1024 / 1024).toFixed(2)} MB`
          : null
      };
      metaCache.set(url, meta);
      resolve(meta);
    });
  });
}

/* ================= QUEUE ================= */
async function processQueue() {
  if (running >= MAX_QUEUE || queue.length === 0) return;
  running++;

  const job = queue.shift();
  try {
    const meta = await extractMeta(job.url);
    let last = 0;

    const msg = await bot.sendMessage(
      job.chat,
      'â³ Downloading...\n0%'
    );

    const file = await runYtdlp(
      job.url,
      job.mp3,
      async (p, eta) => {
        if (Date.now() - last > 5000) {
          last = Date.now();
          await bot.editMessageText(
            `â³ Downloading...\n${p}%\nETA ${eta}`,
            { chat_id: job.chat, message_id: msg.message_id }
          );
        }
      }
    );

    await bot.sendDocument(job.chat, file, {
      caption: buildCaption(meta)
    });

    fileCache.set(job.url, file);
  } catch {
    bot.sendMessage(job.chat, 'âŒ Gagal download');
  } finally {
    running--;
    cleanup();
    processQueue();
  }
}

/* ================= BOT ================= */
bot.onText(/\/start/, m => {
  bot.sendMessage(
    m.chat.id,
    `ðŸ‘‹ Welcome!

ðŸ“¥ Kirim link TikTok / FB / IG / YT
ðŸŽµ /mp3 <link> audio only
ðŸ“Š /stats statistik bot`
  );
});

bot.onText(/\/stats/, m => {
  bot.sendMessage(
    m.chat.id,
    `ðŸ“Š Statistik Bot
Queue: ${queue.length}
Running: ${running}
Cache: ${fileCache.size}`
  );
});

bot.onText(/\/mp3 (.+)/, (m, g) => {
  if (!canUse(m.from.id))
    return bot.sendMessage(m.chat.id, 'âŒ Limit tercapai');

  queue.push({
    chat: m.chat.id,
    url: g[1],
    mp3: true
  });
  processQueue();
});

bot.on('message', m => {
  if (!m.text || m.text.startsWith('/')) return;
  if (!canUse(m.from.id))
    return bot.sendMessage(m.chat.id, 'âŒ Limit tercapai');

  queue.push({
    chat: m.chat.id,
    url: m.text,
    mp3: false
  });
  processQueue();
});

/* ================= CLEANER ================= */
setInterval(cleanup, 1000 * 60 * 10);

console.log('âœ… Bot RUNNING');
