const DEFAULT_SETTINGS = {
  notifyEarlyMinutes: 5,
  visualNotificationsEnabled: true,
  soundEnabled: true
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureStorageDefaults();
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await ensureStorageDefaults();
  await restoreAlarmsFromStorage(settings);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "DETECTION_RESULT") {
    handleDetectionResult(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("Failed to handle detection result:", error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message?.type === "GET_STATE") {
    getState().then(sendResponse);
    return true;
  }

  if (message?.type === "SAVE_SETTINGS") {
    saveSettings(message.settings)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "CLEAR_SITE") {
    clearSite(message.site).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "TEST_NOTIFICATION") {
    createTestNotification(message.kind)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "PLAY_SOUND_ONLY") {
    playChime(message.kind || "reset")
      .then((played) => sendResponse({ ok: !!played, soundPlayed: !!played }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm?.name) return;

  const [kind, site] = alarm.name.split("::");
  const { watchers = {}, settings: storedSettings } = await chrome.storage.local.get([
    "watchers",
    "settings"
  ]);

  const watcher = watchers[site];
  if (!watcher) return;

  const settings = normalizeSettings(storedSettings);
  await sendAlert(kind, {
    site,
    product: watcher.product,
    resetAt: watcher.resetAt
  }, settings);
});

async function ensureStorageDefaults() {
  const existing = await chrome.storage.local.get(["settings", "watchers"]);
  const settings = normalizeSettings(existing.settings);

  if (!existing.settings || JSON.stringify(existing.settings) !== JSON.stringify(settings)) {
    await chrome.storage.local.set({ settings });
  }

  if (!existing.watchers) {
    await chrome.storage.local.set({ watchers: {} });
  }

  return settings;
}

function normalizeSettings(rawSettings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(rawSettings || {}) };

  if (
    rawSettings &&
    rawSettings.notificationsEnabled !== undefined &&
    rawSettings.visualNotificationsEnabled === undefined
  ) {
    merged.visualNotificationsEnabled = !!rawSettings.notificationsEnabled;
  }

  return {
    notifyEarlyMinutes: clampMinutes(merged.notifyEarlyMinutes),
    visualNotificationsEnabled: merged.visualNotificationsEnabled !== false,
    soundEnabled: merged.soundEnabled !== false
  };
}

function clampMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.notifyEarlyMinutes;
  return Math.max(0, Math.min(120, Math.round(parsed)));
}

async function handleDetectionResult(payload) {
  if (!payload?.site || !payload?.product) return;

  const { watchers = {}, settings: storedSettings } = await chrome.storage.local.get([
    "watchers",
    "settings"
  ]);

  const settings = normalizeSettings(storedSettings);
  const previous = watchers[payload.site];
  const next = {
    ...previous,
    ...payload,
    lastSeenAt: Date.now()
  };

  watchers[payload.site] = next;
  await chrome.storage.local.set({ watchers });

  if (payload.resetAt && Number.isFinite(payload.resetAt) && payload.resetAt > Date.now()) {
    await scheduleSiteAlarms(payload.site, payload.resetAt, settings.notifyEarlyMinutes);
  }
}

async function saveSettings(nextSettings) {
  const settings = normalizeSettings(nextSettings);
  await chrome.storage.local.set({ settings });
  await restoreAlarmsFromStorage(settings);
  return settings;
}

async function scheduleSiteAlarms(site, resetAt, notifyEarlyMinutes) {
  await chrome.alarms.clear(`reset::${site}`);
  await chrome.alarms.clear(`early::${site}`);

  if (!(resetAt && Number.isFinite(resetAt) && resetAt > Date.now())) {
    return;
  }

  await chrome.alarms.create(`reset::${site}`, {
    when: resetAt
  });

  const earlyAt = resetAt - notifyEarlyMinutes * 60 * 1000;
  if (earlyAt > Date.now()) {
    await chrome.alarms.create(`early::${site}`, {
      when: earlyAt
    });
  }
}

async function restoreAlarmsFromStorage(settingsInput) {
  const { watchers = {}, settings: storedSettings } = await chrome.storage.local.get([
    "watchers",
    "settings"
  ]);

  const settings = settingsInput || normalizeSettings(storedSettings);

  for (const [site, watcher] of Object.entries(watchers)) {
    await scheduleSiteAlarms(site, watcher?.resetAt, settings.notifyEarlyMinutes);
  }
}

async function clearSite(site) {
  const { watchers = {} } = await chrome.storage.local.get(["watchers"]);
  delete watchers[site];
  await chrome.storage.local.set({ watchers });

  await chrome.alarms.clear(`reset::${site}`);
  await chrome.alarms.clear(`early::${site}`);
}

async function getState() {
  const data = await chrome.storage.local.get(["watchers", "settings"]);
  const settings = normalizeSettings(data.settings);
  let permissionLevel = "unknown";

  try {
    permissionLevel = await chrome.notifications.getPermissionLevel();
  } catch (error) {
    console.debug("getPermissionLevel unavailable", error);
  }

  return {
    watchers: data.watchers || {},
    settings,
    notificationPermissionLevel: permissionLevel
  };
}

function formatLocalTime(ts) {
  try {
    return new Date(ts).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short"
    });
  } catch {
    return new Date(ts).toString();
  }
}

async function sendAlert(kind, payload, settings) {
  const visualEnabled = settings.visualNotificationsEnabled;
  const soundEnabled = settings.soundEnabled;

  if (!visualEnabled && !soundEnabled) {
    return { visualDisplayed: false, soundPlayed: false };
  }

  let visualDisplayed = false;
  if (visualEnabled) {
    visualDisplayed = await showNotification(kind, payload);
  }

  let soundPlayed = false;
  if (soundEnabled) {
    soundPlayed = await playChime(kind);
  }

  return { visualDisplayed, soundPlayed };
}

async function showNotification(kind, payload) {
  const descriptor = getNotificationDescriptor(kind, payload);

  try {
    await chrome.notifications.create(`${descriptor.idPrefix}-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: descriptor.title,
      message: descriptor.message,
      priority: 2,
      requireInteraction: true,
      silent: true
    });
    return true;
  } catch (error) {
    console.debug("Unable to create notification", error);
    return false;
  }
}

function getNotificationDescriptor(kind, payload = {}) {
  const product = payload.product || "Reup";
  const resetAt = payload.resetAt || Date.now();

  if (kind === "early") {
    return {
      idPrefix: `early-${payload.site || "test"}`,
      title: `${product} resets soon`,
      message: `Usage should reset at ${formatLocalTime(resetAt)}.`
    };
  }

  return {
    idPrefix: `reset-${payload.site || "test"}`,
    title: `${product} should be available again`,
    message: "Your saved reset time has arrived."
  };
}

async function createTestNotification(kind = "reset") {
  const { settings: storedSettings } = await chrome.storage.local.get(["settings"]);
  const settings = normalizeSettings(storedSettings);

  const payload = {
    site: "test",
    product: kind === "early" ? "Claude" : "Codex",
    resetAt: Date.now() + 5 * 60 * 1000
  };

  return sendAlert(kind === "early" ? "early" : "reset", payload, settings);
}

async function playChime(kind = "reset") {
  if (!chrome.offscreen?.createDocument) return false;

  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({ type: "PLAY_CHIME", variant: kind });
    return !!response?.ok;
  } catch (error) {
    console.debug("Unable to play chime", error);
    return false;
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    if (contexts.length > 0) return;
  }

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play a short Reup chime for reset and test notifications."
  });
}
