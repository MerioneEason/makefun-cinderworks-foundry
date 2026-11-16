// Cinderworks Foundry: all sound is synthesized with WebAudio — no files.
// A noise buffer feeds the gunshots and explosions; oscillators do the rest.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch { ctx = null; }
  }

  function noise(dur, filterFreq, gainVal, when = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, type, gainVal, slideTo = 0, when = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  const SHOTS = {
    pistol: () => { noise(0.09, 2600, 0.5); tone(190, 0.08, 'square', 0.22, 70); },
    smg: () => { noise(0.07, 3200, 0.4); tone(240, 0.06, 'square', 0.16, 90); },
    shotgun: () => { noise(0.22, 1400, 0.8); tone(110, 0.18, 'sawtooth', 0.3, 45); },
    rifle: () => { noise(0.11, 2200, 0.55); tone(160, 0.09, 'square', 0.25, 60); },
    marksman: () => { noise(0.2, 1800, 0.7); tone(130, 0.16, 'sawtooth', 0.3, 50); },
  };

  return {
    ensure,
    shot(kind, dist) {
      if (!ctx) return;
      const atten = dist <= 0 ? 1 : Math.max(0.12, 1 - dist / 55);
      const save = master.gain.value;
      master.gain.value = save * atten;
      (SHOTS[kind] || SHOTS.rifle)();
      master.gain.value = save;
    },
    dryClick() { noise(0.03, 4000, 0.2); },
    reload() { tone(900, 0.05, 'square', 0.12); tone(620, 0.05, 'square', 0.12, 0, 0.12); tone(1100, 0.05, 'square', 0.14, 0, 0.28); },
    hit(kill) {
      tone(kill ? 1400 : 1050, 0.07, 'sine', 0.25);
      if (kill) tone(1750, 0.12, 'sine', 0.22, 0, 0.07);
    },
    hurt() { tone(140, 0.16, 'sawtooth', 0.3, 70); noise(0.1, 900, 0.25); },
    explode(dist) {
      const atten = Math.max(0.15, 1 - dist / 40);
      const save = master.gain.value;
      master.gain.value = save * atten;
      noise(0.7, 500, 0.9); tone(70, 0.5, 'sine', 0.5, 30);
      master.gain.value = save;
    },
    flash() { tone(2400, 0.35, 'sine', 0.18, 300); },
    throwWhoosh() { noise(0.25, 1200, 0.25); },
    beep(final) { tone(final ? 1560 : 980, 0.09, 'square', 0.2); },
    plantDone() { tone(880, 0.1, 'square', 0.2); tone(1320, 0.16, 'square', 0.2, 0, 0.11); },
    roundWin() { [523, 659, 784].forEach((f, i) => tone(f, 0.22, 'triangle', 0.25, 0, i * 0.13)); },
    roundLose() { [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'triangle', 0.22, 0, i * 0.14)); },
    buyOpen() { tone(660, 0.08, 'triangle', 0.15); tone(880, 0.1, 'triangle', 0.15, 0, 0.09); },
    step() { noise(0.05, 700, 0.06); },
  };
}
