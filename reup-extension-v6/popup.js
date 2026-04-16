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

  if (!Object.keys(watchers).length) {
    watchersEl.innerHTML = `<p class="muted">No reset times saved yet. Open ChatGPT, Claude, or Codex and hit a page where a reset message is visible.</p>`;
  } else {
    watchersEl.innerHTML = Object.entries(watchers)
      .map(([site, watcher]) => {
        const resetText = watcher.resetAt
          ? new Date(watcher.resetAt).toLocaleString([], {
              dateStyle: "medium",
              timeStyle: "short"
            })
          : "Not detected";

        return `
          <div class="watcher">
            <div>
              <strong>${escapeHtml(watcher.product)}</strong>
              <div class="small">${escapeHtml(site)}</div>
              <div class="small">Status: ${escapeHtml(watcher.status || "unknown")}</div>
              <div class="small">Next reset: ${escapeHtml(resetText)}</div>
            </div>
            <button data-clear-site="${escapeHtml(site)}" class="secondary">Clear</button>
          </div>
        `;
      })
      .join("");

    for (const btn of watchersEl.querySelectorAll("[data-clear-site]")) {
      btn.addEventListener("click", async (e) => {
        const site = e.currentTarget.getAttribute("data-clear-site");
        await chrome.runtime.sendMessage({ type: "CLEAR_SITE", site });
        const nextState = await chrome.runtime.sendMessage({ type: "GET_STATE" });
        render(nextState);
      });
    }
  }

  document.getElementById("notifyEarlyMinutes").value =
    state.settings?.notifyEarlyMinutes ?? 5;
  document.getElementById("notificationsEnabled").checked =
    state.settings?.notificationsEnabled ?? true;
  document.getElementById("soundEnabled").checked =
    state.settings?.soundEnabled ?? true;

  renderPermission(state.notificationPermissionLevel);
}

function renderPermission(level) {
  const pill = document.getElementById('permissionPill');
  const explain = document.getElementById('permissionExplain');

  pill.className = 'pill';
  if (level === 'granted') {
    pill.classList.add('success');
    pill.textContent = 'Chrome extension notifications: allowed';
    explain.textContent = 'If you still do not see alerts, the usual cause is OS notification settings, Focus/Do Not Disturb, or Chrome notifications being muted.';
  } else if (level === 'denied') {
    pill.classList.add('danger');
    pill.textContent = 'Chrome extension notifications: blocked';
    explain.textContent = 'Turn notifications back on for Google Chrome in your computer settings, then run a test alert again.';
  } else {
    pill.classList.add('warning');
    pill.textContent = 'Chrome extension notifications: unknown';
    explain.textContent = 'Your browser did not return a notification permission level. Try the test buttons anyway, and check your OS notification settings if nothing appears.';
  }
}

async function saveSettings() {
  const notifyEarlyMinutes = Number(document.getElementById("notifyEarlyMinutes").value || 5);
  const notificationsEnabled = document.getElementById("notificationsEnabled").checked;
  const soundEnabled = document.getElementById("soundEnabled").checked;

  await chrome.storage.local.set({
    settings: {
      notifyEarlyMinutes,
      notificationsEnabled,
      soundEnabled
    }
  });

  document.getElementById("status").textContent = "Saved.";
  setTimeout(() => {
    document.getElementById("status").textContent = "";
  }, 1500);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendTestNotification(kind) {
  const response = await chrome.runtime.sendMessage({ type: "TEST_NOTIFICATION", kind });
  if (response?.ok) {
    const base = kind === "early" ? "Early test alert sent." : "Reset test alert sent.";
    document.getElementById("status").textContent = response.soundPlayed
      ? `${base} Chime played.`
      : `${base} Notification worked, but chime did not play.`;
  } else {
    document.getElementById("status").textContent = "Could not send test alert.";
  }
  setTimeout(() => {
    document.getElementById("status").textContent = "";
  }, 2600);
}

async function testSound() {
  const response = await chrome.runtime.sendMessage({ type: 'PLAY_SOUND_ONLY', kind: 'reset' });
  document.getElementById('status').textContent = response?.soundPlayed
    ? 'Played test chime.'
    : 'Could not play chime. Check Chrome tab audio, system output, and Focus/Do Not Disturb.';
  setTimeout(() => {
    document.getElementById('status').textContent = '';
  }, 2600);
}
