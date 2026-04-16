const DEFAULT_SETTINGS = {
  notifyEarlyMinutes: 5,
  notificationsEnabled: true,
  soundEnabled: true
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(["settings", "watchers"]);
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  } else if (existing.settings.soundEnabled === undefined) {
    await chrome.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, ...existing.settings, soundEnabled: true }
    });
  }
  if (!existing.watchers) {
    await chrome.storage.local.set({ watchers: {} });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await restoreAlarmsFromStorage();
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

  if (message?.type === "CLEAR_SITE") {
    clearSite(message.site).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "TEST_NOTIFICATION") {
    createTestNotification(message.kind)
      .then((result) => sendResponse({ ok: true, soundPlayed: !!result?.soundPlayed }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "PLAY_SOUND_ONLY") {
    playChime(message.kind || 'reset')
      .then((played) => sendResponse({ ok: !!played, soundPlayed: !!played }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm?.name) return;

  const [kind, site] = alarm.name.split("::");
  const { watchers = {}, settings = DEFAULT_SETTINGS } = await chrome.storage.local.get([
    "watchers",
    "settings"
  ]);

  const watcher = watchers[site];
  if (!watcher || !settings.notificationsEnabled) return;

  if (kind === "early") {
    await chrome.notifications.create(`early-${site}-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `${watcher.product} resets soon`,
      message: `Usage should reset at ${formatLocalTime(watcher.resetAt)}.`,
      priority: 2,
      requireInteraction: true,
      silent: false
    });

    if (settings.soundEnabled) {
      await playChime('early');
    }
  }

  if (kind === "reset") {
    await chrome.notifications.create(`reset-${site}-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `${watcher.product} should be available again`,
      message: `Your saved reset time has arrived.`,
      priority: 2,
      requireInteraction: true,
      silent: false
    });

    if (settings.soundEnabled) {
      await playChime('reset');
    }
  }
});

async function handleDetectionResult(payload) {
  if (!payload?.site || !payload?.product) return;

  const { watchers = {}, settings = DEFAULT_SETTINGS } = await chrome.storage.local.get([
    "watchers",
    "settings"
  ]);

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

async function scheduleSiteAlarms(site, resetAt, notifyEarlyMinutes) {
  await chrome.alarms.clear(`reset::${site}`);
  await chrome.alarms.clear(`early::${site}`);

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

async function restoreAlarmsFromStorage() {
  const { watchers = {}, settings = DEFAULT_SETTINGS } = await chrome.storage.local.get([
    "watchers",
    "settings"
  ]);

  for (const [site, watcher] of Object.entries(watchers)) {
    if (watcher?.resetAt && watcher.resetAt > Date.now()) {
      await scheduleSiteAlarms(site, watcher.resetAt, settings.notifyEarlyMinutes);
    }
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
  let permissionLevel = 'unknown';
  try {
    permissionLevel = await chrome.notifications.getPermissionLevel();
  } catch (error) {
    console.debug('getPermissionLevel unavailable', error);
  }

  return {
    watchers: data.watchers || {},
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
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

async function createTestNotification(kind = "reset") {
  const titles = {
    reset: "Codex should be available again",
    early: "Claude resets soon"
  };

  const messages = {
    reset: "Test notification from Reup. Your saved reset time has arrived.",
    early: `Test notification from Reup. Usage should reset at ${formatLocalTime(Date.now() + 5 * 60 * 1000)}.`
  };

  await chrome.notifications.create(`test-${kind}-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: titles[kind] || "Reup test notification",
    message: messages[kind] || "This is a test notification from Reup.",
    priority: 2,
    requireInteraction: true,
    silent: false
  });

  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get(["settings"]);
  let soundPlayed = false;
  if (settings.soundEnabled) {
    soundPlayed = await playChime(kind === 'early' ? 'early' : 'reset');
  }
  return { soundPlayed };
}

async function playChime(kind = 'reset') {
  if (!chrome.offscreen?.createDocument) return false;
  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({ type: 'PLAY_CHIME', variant: kind });
    return !!response?.ok;
  } catch (error) {
    console.debug('Unable to play chime', error);
    return false;
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    if (contexts.length > 0) return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play a short Reup chime for reset and test notifications.'
  });
}
