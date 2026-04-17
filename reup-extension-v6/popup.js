document.addEventListener("DOMContentLoaded", init);

async function init() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  render(state);

  document.getElementById("saveBtn").addEventListener("click", saveSettings);
  document.getElementById("testResetBtn").addEventListener("click", () => sendTestNotification("reset"));
  document.getElementById("testSoonBtn").addEventListener("click", () => sendTestNotification("early"));
  document.getElementById("testSoundBtn").addEventListener("click", testSound);
}

function render(state) {
  const watchersEl = document.getElementById("watchers");
  const watchers = state.watchers || {};
  const watcherEntries = Object.entries(watchers);

  document.getElementById("trackerCount").textContent = String(watcherEntries.length);

  if (!watcherEntries.length) {
    watchersEl.innerHTML =
      '<p class="emptyState">No reset times saved yet. Open ChatGPT, Claude, or Codex on a page where a reset message is visible, and Reup will remember it here.</p>';
  } else {
    watchersEl.innerHTML = watcherEntries
      .sort(([, left], [, right]) => (left?.resetAt || 0) - (right?.resetAt || 0))
      .map(([site, watcher]) => {
        const resetText = watcher.resetAt ? formatDateTime(watcher.resetAt) : "Not detected yet";
        const lastSeenText = watcher.lastSeenAt ? formatDateTime(watcher.lastSeenAt) : "Recently";
        const statusLabel = getStatusLabel(watcher.status);

        return `
          <article class="watcher">
            <div class="watcherHeader">
              <div>
                <div class="watcherTitleRow">
                  <strong>${escapeHtml(watcher.product || site)}</strong>
                  <span class="siteBadge">${escapeHtml(site)}</span>
                </div>
                <div class="watcherTime">${escapeHtml(resetText)}</div>
              </div>
              <button data-clear-site="${escapeHtml(site)}" class="secondary">Clear</button>
            </div>
            <div class="watcherMeta">
              <span>${escapeHtml(statusLabel)}</span>
              <span>Last seen ${escapeHtml(lastSeenText)}</span>
            </div>
          </article>
        `;
      })
      .join("");

    for (const btn of watchersEl.querySelectorAll("[data-clear-site]")) {
      btn.addEventListener("click", async (event) => {
        const site = event.currentTarget.getAttribute("data-clear-site");
        await chrome.runtime.sendMessage({ type: "CLEAR_SITE", site });
        const nextState = await chrome.runtime.sendMessage({ type: "GET_STATE" });
        render(nextState);
      });
    }
  }

  document.getElementById("notifyEarlyMinutes").value = state.settings?.notifyEarlyMinutes ?? 5;
  document.getElementById("visualNotificationsEnabled").checked =
    state.settings?.visualNotificationsEnabled ?? true;
  document.getElementById("soundEnabled").checked = state.settings?.soundEnabled ?? true;
  document.getElementById("quietModeNote").hidden =
    !!(state.settings?.visualNotificationsEnabled || state.settings?.soundEnabled);

  renderPermission(state.notificationPermissionLevel);
}

function renderPermission(level) {
  const pill = document.getElementById("permissionPill");
  const explain = document.getElementById("permissionExplain");

  pill.className = "pill";

  if (level === "granted") {
    pill.classList.add("success");
    pill.textContent = "Chrome notifications allowed";
    explain.textContent =
      "If you still do not see banners, the usual cause is OS notification settings, Focus / Do Not Disturb, or Chrome notifications being muted.";
    return;
  }

  if (level === "denied") {
    pill.classList.add("danger");
    pill.textContent = "Chrome notifications blocked";
    explain.textContent =
      "Turn notifications back on for Google Chrome in your computer settings, then run a test alert again.";
    return;
  }

  pill.classList.add("warning");
  pill.textContent = "Chrome notification status unknown";
  explain.textContent =
    "Your browser did not report a notification permission level. Test alerts can still work, so use the buttons above and check your OS settings if nothing appears.";
}

async function saveSettings() {
  const notifyEarlyMinutes = clampMinutes(document.getElementById("notifyEarlyMinutes").value);
  const visualNotificationsEnabled = document.getElementById("visualNotificationsEnabled").checked;
  const soundEnabled = document.getElementById("soundEnabled").checked;

  const response = await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings: {
      notifyEarlyMinutes,
      visualNotificationsEnabled,
      soundEnabled
    }
  });

  if (!response?.ok) {
    showStatus("Could not save settings right now.");
    return;
  }

  const nextState = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  render(nextState);
  showStatus("Settings saved.");
}

function clampMinutes(value) {
  const parsed = Number(value || 5);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(0, Math.min(120, Math.round(parsed)));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function getStatusLabel(status) {
  if (status === "reset_detected") return "Reset time detected";
  if (status === "blocked_but_no_time_found") return "Blocked, waiting for a clearer reset time";
  if (status === "no_reset_found") return "No reset time found yet";
  return "Checking page state";
}

async function sendTestNotification(kind) {
  const response = await chrome.runtime.sendMessage({ type: "TEST_NOTIFICATION", kind });

  if (!response?.ok) {
    showStatus("Could not send the test alert.");
    return;
  }

  const label = kind === "early" ? "Early alert" : "Reset alert";
  showStatus(describeTestResult(label, response));
}

function describeTestResult(label, result) {
  const parts = [];

  if (result.visualDisplayed) {
    parts.push("banner shown");
  }

  if (result.soundPlayed) {
    parts.push("chime played");
  }

  if (!parts.length) {
    return `${label} stayed quiet because both banner and chime are currently turned off.`;
  }

  return `${label}: ${parts.join(" and ")}.`;
}

async function testSound() {
  const response = await chrome.runtime.sendMessage({ type: "PLAY_SOUND_ONLY", kind: "reset" });
  showStatus(
    response?.soundPlayed
      ? "Played the Reup test chime."
      : "Could not play the chime. Check Chrome audio, your output device, and Focus / Do Not Disturb."
  );
}

function showStatus(message) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  clearTimeout(showStatus.timerId);
  showStatus.timerId = setTimeout(() => {
    statusEl.textContent = "";
  }, 2800);
}
