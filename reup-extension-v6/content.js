const SITE_CONFIG = getSiteConfig();

if (SITE_CONFIG) {
  boot();
}

function getSiteConfig() {
  const host = location.hostname;
  const path = location.pathname || "";

  if (host.includes("chatgpt.com") && path.startsWith("/codex")) {
    return { site: "codex", product: "Codex" };
  }
  if (host.includes("chatgpt.com")) {
    return { site: "chatgpt", product: "ChatGPT" };
  }
  if (host.includes("claude.ai")) {
    return { site: "claude", product: "Claude" };
  }
  if (host.includes("codex.openai.com")) {
    return { site: "codex", product: "Codex" };
  }
  return null;
}

function boot() {
  runDetection();

  const observer = new MutationObserver(debounce(runDetection, 1500));
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  window.addEventListener("focus", runDetection);
}

async function runDetection() {
  const text = collectVisibleText(document.body);
  const result = detectReset(text);

  const payload = {
    site: SITE_CONFIG.site,
    product: SITE_CONFIG.product,
    url: location.href,
    detectedAt: Date.now(),
    detectorVersion: 3,
    rawMatch: result.rawMatch || null,
    confidence: result.confidence,
    resetAt: result.resetAt || null,
    status: result.status
  };

  try {
    await chrome.runtime.sendMessage({
      type: "DETECTION_RESULT",
      payload
    });
  } catch (error) {
    console.debug("sendMessage failed:", error);
  }
}

function collectVisibleText(root) {
  if (!root) return "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;

      const style = window.getComputedStyle(parent);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        parent.closest("script, style, noscript")
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      const value = node.nodeValue?.trim();
      return value ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });

  const chunks = [];
  while (walker.nextNode()) {
    chunks.push(walker.currentNode.nodeValue.trim());
  }
  return chunks.join(" \n ");
}

function detectReset(text) {
  const normalized = text.replace(/\s+/g, " ").trim();

  const patterns = [
    /limits?\s+will\s+reset\s+(?:at|after)\s+([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM|am|pm)?)/i,
    /your\s+limit\s+will\s+reset\s+(?:at|after)\s+([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM|am|pm)?)/i,
    /reset(?:s)?\s+after\s+([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM|am|pm)?)/i,
    /reset(?:s)?\s+(?:at|on)\s*([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM|am|pm)?)/i,
    /limit\s+to\s+reset\s+after\s+([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM|am|pm)?)/i,
    /wait\s+for\s+your\s+limit\s+to\s+reset\s+after\s+([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM|am|pm)?)/i,
    /try again\s+(?:at|after)?\s*([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM|am|pm)?)/i,
    /available again\s+(?:at|after)?\s*([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM|am|pm)?)/i,
    /come back\s+(?:at|after)?\s*([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM|am|pm)?)/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const parsed = parseTodayOrTomorrow(match[1]);
      if (parsed) {
        return {
          status: "reset_detected",
          confidence: 0.92,
          rawMatch: match[0],
          resetAt: parsed.getTime()
        };
      }
    }
  }

  const genericBlocked =
    /out of .*messages|limit|usage cap|too many requests|rate limit|come back later|try again later/i.test(normalized);

  if (genericBlocked) {
    return {
      status: "blocked_but_no_time_found",
      confidence: 0.35,
      rawMatch: null,
      resetAt: null
    };
  }

  return {
    status: "no_reset_found",
    confidence: 0.1,
    rawMatch: null,
    resetAt: null
  };
}

function parseTodayOrTomorrow(timeString) {
  const now = new Date();
  const parsed = parseTimeString(timeString);
  if (!parsed) return null;

  const candidate = new Date(now);
  candidate.setHours(parsed.hours, parsed.minutes, 0, 0);

  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate;
}

function parseTimeString(input) {
  const match = input.match(/([0-9]{1,2}):([0-9]{2})\s*(AM|PM|am|pm)?/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();

  if (minutes > 59 || hours > 12 || hours < 0) return null;

  if (meridiem) {
    if (hours === 12) hours = 0;
    if (meridiem === "PM") hours += 12;
  }

  return { hours, minutes };
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
