const TelegramBot = require("node-telegram-bot-api");
const http = require("http");

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const TARGET_CHANNEL_ID = (process.env.CHANNEL_ID || "-1003905680085").trim();

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN!");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// Render Port Bind (Web service alive check)
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("JJ Cleaner Bot Alive!");
}).listen(port, "0.0.0.0", () => {
  console.log(`Web server listening on port ${port}`);
});

bot.on("polling_error", (err) => {
  if (err.message && err.message.includes("409")) return;
  console.error("Telegram Polling Error:", err.message || err);
});
process.on("uncaughtException", (err) => console.error("Uncaught:", err.message));
process.on("unhandledRejection", (r) => console.error("Unhandled:", r));

// Start Command
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `👋 *JJ Cleaner Bot Online!*\n\n` +
    `🤖 *Status:* Active\n` +
    `📢 *Target Channel:* \`${TARGET_CHANNEL_ID}\`\n\n` +
    `📌 *Files forward cheyagane, links anni remove chesi neat title tho target channel lo post chesthundi!*`,
    { parse_mode: "Markdown" }
  );
});

// Fancy fonts to normal English text converter
function fixFancyFonts(str) {
  if (!str) return "";
  return str
    .normalize("NFKD")
    .replace(/[\u{1D400}-\u{1D7FF}]/gu, (c) => {
      const code = c.codePointAt(0);
      if (code >= 0x1D400 && code <= 0x1D419) return String.fromCharCode(65 + code - 0x1D400);
      if (code >= 0x1D41A && code <= 0x1D433) return String.fromCharCode(97 + code - 0x1D41A);
      if (code >= 0x1D434 && code <= 0x1D44D) return String.fromCharCode(65 + code - 0x1D434);
      if (code >= 0x1D44E && code <= 0x1D467) return String.fromCharCode(97 + code - 0x1D44E);
      if (code >= 0x1D468 && code <= 0x1D481) return String.fromCharCode(65 + code - 0x1D468);
      if (code >= 0x1D482 && code <= 0x1D49B) return String.fromCharCode(97 + code - 0x1D482);
      if (code >= 0x1D5D4 && code <= 0x1D5ED) return String.fromCharCode(65 + code - 0x1D5D4);
      if (code >= 0x1D5EE && code <= 0x1D607) return String.fromCharCode(97 + code - 0x1D5EE);
      return c;
    });
}

// Advanced Cleaner (Only clean title)
function cleanCaption(text, fileName = "") {
  let clean = fixFancyFonts(text || "");

  // 1. Remove 5-minute auto-delete warning lines & expiry notes
  clean = clean.replace(/⚠️?\s*this file will be deleted[\s\S]*/gi, "");
  clean = clean.replace(/please save or forward it before[\s\S]*/gi, "");
  clean = clean.replace(/the time expires[\s\S]*/gi, "");

  // 2. Remove Links, URLs, and Telegram Mentions (@channels)
  clean = clean.replace(/https?:\/\/\S+|t\.me\/\S+/gi, "");
  clean = clean.replace(/@\w+/gi, "");

  // 3. Remove Join Channel, Subscribe phrases & promo lines completely
  clean = clean.replace(/(?:join|subscribe|follow|channel|channels|tmw|updates|group|backup|official)[\s\S]*?(?=(\n|$))/gi, "");
  clean = clean.replace(/[👉►▶️➡️➔➜🔗💥🔥⭐✨🎬🍿][^\n]*/gi, "");
  clean = clean.replace(/💾\s*size:[^\n]*/gi, "");
  clean = clean.replace(/⏰\s*duration:[^\n]*/gi, "");

  // Clean up extra spaces, dashes, or trailing junk
  clean = clean.trim().replace(/[-–—\s]+$/, "");

  // If caption becomes empty or too short after cleaning, fallback to file name
  if (!clean || clean.length < 3) {
    clean = fileName.replace(/\.(mkv|mp4|avi)$/i, "").replace(/[\._]/g, " ").trim();
  }

  return clean;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Auto-Retry Wrapper for Telegram 429 Rate Limits (Clean Title Only, No Button)
async function sendMediaWithRetry(isVideo, fileId, caption, maxRetries = 5) {
  const extraOptions = {
    caption,
    parse_mode: "Markdown"
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (isVideo) {
        return await bot.sendVideo(TARGET_CHANNEL_ID, fileId, extraOptions);
      } else {
        return await bot.sendDocument(TARGET_CHANNEL_ID, fileId, extraOptions);
      }
    } catch (err) {
      const errMsg = err.message || "";
      const retryAfterParam = err.response?.body?.parameters?.retry_after;
      const retryMatch = errMsg.match(/retry after (\d+)/i);
      const waitSeconds = retryAfterParam || (retryMatch ? parseInt(retryMatch[1], 10) : null);

      if (waitSeconds && attempt < maxRetries) {
        console.log(`429 Rate limit hit. Waiting ${waitSeconds + 1}s before retrying...`);
        await sleep((waitSeconds + 1) * 1000);
        continue;
      }
      throw err;
    }
  }
}

// Fast Sequential Queue for smooth batch uploading
let cleanQueue = Promise.resolve();

bot.on("message", (msg) => {
  if (msg.chat.type !== "private") return;
  if (msg.text && msg.text.startsWith("/")) return;

  const file = msg.video || msg.document;
  if (!file) return;

  const rawText = msg.caption || msg.text || "";
  const rawFileName = file.file_name || "Movie File";
  const finalCleanCaption = cleanCaption(rawText, rawFileName);
  const chatId = msg.chat.id;
  const isVideo = Boolean(msg.video);

  cleanQueue = cleanQueue
    .then(async () => {
      await sendMediaWithRetry(isVideo, file.file_id, finalCleanCaption);
      bot.sendMessage(chatId, `✅ Cleaned & Posted: \`${rawFileName.substring(0, 30)}\``, { parse_mode: "Markdown" }).catch(() => {});
      await sleep(800);
    })
    .catch((err) => {
      console.error("Channel post error:", err.message);
      bot.sendMessage(chatId, `❌ Post failed (${rawFileName}): ${err.message}`).catch(() => {});
    });
});

console.log("JJ Cleaner Bot Ready (Clean Title Only, No Button)!");
