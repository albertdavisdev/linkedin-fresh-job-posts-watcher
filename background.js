const TELEGRAM_BOT_TOKEN = "8960766559:AAEX-DN1KKKW9NE7Szitkk4wUNoxm85U-eM";
const TELEGRAM_CHAT_ID = "8791955394";
const TELEGRAM_SENT_JOBS_KEY = "telegram_sent_job_ids_v1";

async function getTelegramSentIds() {
  const data = await chrome.storage.local.get([TELEGRAM_SENT_JOBS_KEY]);
  return new Set(data[TELEGRAM_SENT_JOBS_KEY] || []);
}

async function addTelegramSentId(id) {
  const sent = await getTelegramSentIds();
  sent.add(id);
  await chrome.storage.local.set({ [TELEGRAM_SENT_JOBS_KEY]: [...sent].slice(0, 500) });
}

async function sendTelegramNotification(post) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !post?.id) return;

  const sentIds = await getTelegramSentIds();
  if (sentIds.has(post.id)) return;

  const text = [`New LinkedIn post detected.`,
    post.title ? `Title: ${post.title}` : null,
    post.author ? `Author: ${post.author}` : null,
    post.time ? `Time: ${post.time}` : null,
    post.url ? `Link: ${post.url}` : null
  ].filter(Boolean).join("\n");

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });

    const json = await response.json();
    if (json.ok) {
      await addTelegramSentId(post.id);
      console.log("Telegram notification sent for post", post.id);
    } else {
      console.warn("Telegram notification failed", json);
    }
  } catch (error) {
    console.error("Telegram send error", error);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "NEW_LINKEDIN_POST" && message.post) {
    const post = message.post;

    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png"),
      title: post.title ? `New LinkedIn post: ${post.title}` : "New LinkedIn post",
      message: `${post.author || ""} ${post.time || ""}`.trim() || "A fresh LinkedIn post was found.",
      priority: 2
    });

    sendTelegramNotification(post).catch(console.error);
  }
});
