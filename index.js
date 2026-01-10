/**
 * TELEGRAM AUTO DOWNLOADER BOT
 * FINAL STABLE VERSION
 * Node 20 + Railway SAFE
 */

const TelegramBot = require("node-telegram-bot-api");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { LRUCache } = require("lru-cache");
const PQueue = require("p-queue").default;

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN belum di set");
  process.exit(1);
}

/* ================= CONST ================= */
const DOWNLOAD_DIR = "/tmp";
const COOKIE_FILE = "cookies.txt";

/* ================= BOT ================= */
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/* ================= CACHE ================= */
const cache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 30, // 30 menit
});

/* ================= QUEUE ================= */
const queue = new PQueue({
  concurrency: 1,
});

/* ================= STATS ================= */
const stats = {
  total: 0,
  success: 0,
  failed: 0,
};

/* ================= UTIL ================= */
const isAdmin = (id) => ADMIN_IDS.includes(id);

function detectPlatform(url) {
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/youtu\.be|youtube\.com/i.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch/i.test(url)) return "facebook";
  if (/instagram\.com/i.test(url)) return "instagram";
  return "unknown";
}

/* ================= FB PRIVATE CHECK ================= */
function checkFBPrivate(url) {
  return new Promise((resolve) => {
    execFile(
      "yt-dlp",
      ["--cookies", COOKIE_FILE, "--dump-json", "--no-playlist", url],
      (err, stdout, stderr) => {
        if (!err) return resolve(false);

        const msg = (stderr || "").toLowerCase();
        if (
          msg.includes("login") ||
          msg.includes("private") ||
          msg.includes("checkpoint") ||
          msg.includes("not available")
        ) {
          return resolve(true);
        }
        resolve(false);
      }
    );
  });
}

/* ================= FORMAT AUTO ================= */
function getFormat(platform) {
  if (platform === "youtube") {
    return [
      "bv*[height<=1080]+ba/b",
      "bv*[height<=720]+ba/b",
      "b",
    ];
  }
  return ["b"];
}

/* ================= DOWNLOAD ================= */
function downloadVideo(url, platform) {
  const output = path.join(DOWNLOAD_DIR, `${Date.now()}.mp4`);
  const formats = getFormat(platform);

  return new Promise((resolve, reject) => {
    const tryFormat = (i) => {
      if (i >= formats.length) return reject("FORMAT_FAILED");

      const args = [
        "-f",
        formats[i],
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "--retries",
        "3",
        "--fragment-retries",
        "3",
        "--concurrent-fragments",
        "1",
        "-o",
        output,
        url,
      ];

      if (platform === "facebook" && fs.existsSync(COOKIE_FILE)) {
        args.unshift("--cookies", COOKIE_FILE);
      }

      execFile("yt-dlp", args, { timeout: 1000 * 60 * 5 }, (err) => {
        if (!err) return resolve(output);
        tryFormat(i + 1);
      });
    };

    tryFormat(0);
  });
}

/* ================= COMMANDS ================= */
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 *Downloader Bot*\n\n" +
      "📥 Kirim link:\n" +
      "YouTube / TikTok / Instagram / Facebook\n\n" +
      "⚡ Auto detect resolusi\n" +
      "🧠 Queue anti crash",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/stats/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  bot.sendMessage(
    msg.chat.id,
    `📊 *BOT STATS*\n\n` +
      `📥 Total: ${stats.total}\n` +
      `✅ Success: ${stats.success}\n` +
      `❌ Failed: ${stats.failed}\n` +
      `🧠 Queue: ${queue.size}`,
    { parse_mode: "Markdown" }
  );
});

/* ================= MESSAGE ================= */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (!/^https?:\/\//i.test(text)) return;

  const platform = detectPlatform(text);
  if (platform === "unknown") {
    bot.sendMessage(chatId, "❌ Platform tidak didukung");
    return;
  }

  if (!isAdmin(msg.from.id) && cache.has(text)) {
    bot.sendMessage(chatId, "⏳ Link ini sedang / sudah diproses");
    return;
  }

  cache.set(text, true);
  stats.total++;

  bot.sendMessage(
    chatId,
    `⏳ Processing *${platform}*\n📦 Queue: ${queue.size + 1}`,
    { parse_mode: "Markdown" }
  );

  queue.add(async () => {
    try {
      if (platform === "facebook" && fs.existsSync(COOKIE_FILE)) {
        const isPrivate = await checkFBPrivate(text);
        if (isPrivate) {
          bot.sendMessage(
            chatId,
            "🔒 Video Facebook *PRIVATE / LOGIN REQUIRED*\n\n" +
              "❌ Tidak bisa diproses.\n" +
              "✅ Pastikan akun FB valid & cookie aktif",
            { parse_mode: "Markdown" }
          );
          stats.failed++;
          return;
        }
      }

      const file = await downloadVideo(text, platform);
      await bot.sendVideo(chatId, fs.createReadStream(file));
      fs.unlinkSync(file);
      stats.success++;
    } catch (e) {
      stats.failed++;
      bot.sendMessage(chatId, "❌ Download gagal (dibatasi sumber)");
    }
  });
});

console.log("✅ Bot running & stable");
