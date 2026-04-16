chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PLAY_CHIME') {
    playChime(message.variant || 'reset')
      .then((result) => sendResponse({ ok: result }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});

async function playChime(variant = 'reset') {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) return false;

  const ctx = new AudioCtx();
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);

    const now = ctx.currentTime + 0.05;
    const notes = variant === 'early'
      ? [880, 1174.66]
      : [659.25, 880, 1046.5];

    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = variant === 'early' ? 'triangle' : 'square';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(master);

      const start = now + index * 0.14;
      const end = start + 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.45, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.start(start);
      osc.stop(end + 0.02);
    });

    await new Promise((resolve) => setTimeout(resolve, 800));
    return true;
  } finally {
    await ctx.close();
  }
}
