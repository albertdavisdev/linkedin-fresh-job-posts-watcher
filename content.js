const STORAGE_KEY = "linkedin_fresh_seen_posts_v1";
const CHECK_INTERVAL_MS = 7000;
const AUTO_RELOAD_MS = 60000;
const MAX_MINUTES = 60;

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function parsePostTime(text) {
  const clean = normalizeText(text).toLowerCase();
  if (!clean) return null;

  if (/\bjust now\b/.test(clean)) return 0;
  const minuteMatch = clean.match(/(\d+)\s*m(in(?:ute)?s?)?\b/);
  if (minuteMatch) return Number(minuteMatch[1]);
  const hourMatch = clean.match(/(\d+)\s*h(ours?)?\b/);
  if (hourMatch) return Number(hourMatch[1]) * 60;
  const dayMatch = clean.match(/(\d+)\s*d(ays?)?\b/);
  if (dayMatch) return Number(dayMatch[1]) * 1440;
  const agoMatch = clean.match(/(\d+)\s+(minute|minutes|hour|hours|day|days)\s+ago/);
  if (agoMatch) {
    const value = Number(agoMatch[1]);
    const unit = agoMatch[2];
    if (unit.startsWith("minute")) return value;
    if (unit.startsWith("hour")) return value * 60;
    if (unit.startsWith("day")) return value * 1440;
  }

  return null;
}

function isFreshPost(timeText) {
  const minutes = parsePostTime(timeText);
  return minutes !== null && minutes >= 0 && minutes <= MAX_MINUTES;
}

function getPostNodes() {
  const candidateNodes = [...document.querySelectorAll('div[role="listitem"], article')];
  const timePattern = /\b(?:just now|\d+\s*m(in(?:ute)?s?)?|\d+\s*h(ours?)?|\d+\s*d(ays?)?)\b/i;

  return candidateNodes.filter((node) => {
    const textContent = normalizeText(node.innerText || "").toLowerCase();
    const hasTimeText = timePattern.test(textContent);
    const hasPostLink = !!node.querySelector('a[href*="/posts/"], a[href*="/activity/"], a[href*="/feed/"]');

    return hasTimeText && hasPostLink;
  });
}

function getPostTimeText(node) {
  const globeIcon = node.querySelector('svg[id^="globe"], svg[aria-label*="Public"], svg[aria-label*="Anyone"], svg[aria-label*="LinkedIn"]');
  if (globeIcon) {
    const timeParagraph = globeIcon.closest('p');
    if (timeParagraph) {
      const raw = normalizeText(timeParagraph.innerText);
      const match = raw.match(/^(.*?)(?=\s*•|\s*Edited|$)/i);
      return match ? normalizeText(match[1]) : raw;
    }
  }

  const candidate = [...node.querySelectorAll('p, span')]
    .map((el) => normalizeText(el.innerText))
    .find((text) => /\b(?:just now|\d+\s*m(in(?:ute)?s?)?|\d+\s*h(ours?)?|\d+\s*d(ays?)?)\b/i.test(text));

  return candidate || "";
}

function extractPostData(node) {
  const timeText = getPostTimeText(node);
  if (!isFreshPost(timeText)) return null;

  const authorNode = node.querySelector('a[href*="/in/"] p, a[href*="/company/"] p, a[href*="/school/"] p, a[href*="/services/"] p');
  const author = normalizeText(authorNode?.innerText || "");

  const contentNode = node.querySelector('div[data-testid="expandable-text-box"], p[componentkey^="feed-commentary_"] span, p[componentkey^="feed-commentary_"]');
  const title = normalizeText(contentNode?.innerText || author || 'New LinkedIn post');

  const linkNode = node.querySelector('a[href*="/posts/"], a[href*="/activity/"], a[href*="/feed/"], a[href*="/in/"], a[href*="/company/"]');
  const url = linkNode?.href || window.location.href;
  const id = node.getAttribute('componentkey') || `${title}|${author}|${timeText}`;

  return {
    id,
    title,
    author,
    time: normalizeText(timeText),
    url
  };
}

async function getSeenIds() {
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  return new Set(data[STORAGE_KEY] || []);
}

async function setSeenIds(ids) {
  await chrome.storage.local.set({ [STORAGE_KEY]: [...ids].slice(0, 500) });
}

function updateStatus(message) {
  let box = document.getElementById("linkedin-fresh-post-watcher-status");

  if (!box) {
    box = document.createElement("div");
    box.id = "linkedin-fresh-post-watcher-status";
    Object.assign(box.style, {
      position: "fixed",
      bottom: "18px",
      left: "18px",
      zIndex: "999999",
      background: "#0a66c2",
      color: "#fff",
      padding: "10px 14px",
      borderRadius: "10px",
      fontSize: "13px",
      fontFamily: "Arial, sans-serif",
      boxShadow: "0 4px 16px rgba(0,0,0,.25)",
      maxWidth: "340px"
    });
    document.body.appendChild(box);
  }

  box.textContent = message;
}

async function scanPosts() {
  const data = await chrome.storage.local.get(["enabled"]);
  const enabled = data.enabled !== false;

  if (!enabled) {
    updateStatus("LinkedIn Fresh Post Watcher is OFF");
    return;
  }

  const seen = await getSeenIds();
  const nodes = getPostNodes();
  console.debug('LinkedIn Fresh Post Watcher scan', { nodes: nodes.length });
  const freshPosts = [];

  for (const node of nodes) {
    const post = extractPostData(node);
    if (!post || !post.id || seen.has(post.id)) continue;
    console.debug('Detected fresh post', post);
    seen.add(post.id);
    freshPosts.push(post);
  }

  if (freshPosts.length) {
    await setSeenIds(seen);
    freshPosts.slice(0, 5).forEach((post) => {
      chrome.runtime.sendMessage({ type: "NEW_LINKEDIN_POST", post });
    });
    updateStatus(`Found ${freshPosts.length} new post${freshPosts.length === 1 ? "" : "s"}. Latest: ${freshPosts[0].title}`);
  } else {
    updateStatus(`Watching LinkedIn content search... scanned ${nodes.length} posts`);
  }
}

function observePage() {
  const observer = new MutationObserver(() => {
    scanPosts().catch(console.error);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}

async function scheduleAutoReload() {
  setInterval(async () => {
    const data = await chrome.storage.local.get(["enabled"]);
    const enabled = data.enabled !== false;

    if (enabled && window.location.href.includes('/search/results/content')) {
      updateStatus('Reloading LinkedIn search page in 1 minute...');
      location.reload();
    }
  }, AUTO_RELOAD_MS);
}

async function init() {
  updateStatus("Initializing LinkedIn Fresh Post Watcher...");
  await scanPosts();
  observePage();
  setInterval(() => scanPosts().catch(console.error), CHECK_INTERVAL_MS);
  scheduleAutoReload();
}

init();
