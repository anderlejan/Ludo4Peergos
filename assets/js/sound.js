/* Ludo4Peergos – sound effects made with Web Audio (no audio files). */
(function (root) {
  'use strict';
  let ctx = null, master = null, enabled = true, volume = 0.7;

  function ac() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone(freq, start, dur, opts) {
    const c = ac(); if (!c) return;
    opts = opts || {};
    const o = c.createOscillator(), g = c.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, c.currentTime + start);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, c.currentTime + start + dur);
    const peak = (opts.gain || 0.25);
    g.gain.setValueAtTime(0.0001, c.currentTime + start);
    g.gain.exponentialRampToValueAtTime(peak, c.currentTime + start + (opts.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    o.connect(g); g.connect(master);
    o.start(c.currentTime + start);
    o.stop(c.currentTime + start + dur + 0.05);
  }

  function noise(start, dur, gain, freq) {
    const c = ac(); if (!c) return;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 2400; f.Q.value = 1.2;
    const g = c.createGain(); g.gain.value = gain || 0.5;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(c.currentTime + start);
  }

  const fx = {
    roll() { for (let i = 0; i < 7; i++) noise(i * 0.055 + Math.random() * 0.02, 0.05, 0.35 + Math.random() * 0.2, 1800 + Math.random() * 2200); },
    land() { noise(0, 0.07, 0.6, 900); tone(180, 0, 0.09, { type: 'triangle', gain: 0.18 }); },
    step() { tone(520 + Math.random() * 60, 0, 0.06, { type: 'triangle', gain: 0.12 }); },
    enter() { tone(392, 0, 0.12, { type: 'triangle', gain: 0.2 }); tone(587, 0.08, 0.16, { type: 'triangle', gain: 0.2 }); },
    capture() { tone(660, 0, 0.35, { type: 'sawtooth', to: 120, gain: 0.12 }); noise(0.02, 0.18, 0.4, 600); },
    home() { [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.3, { type: 'sine', gain: 0.2 })); },
    turn() { tone(880, 0, 0.18, { gain: 0.12 }); tone(1320, 0.07, 0.22, { gain: 0.08 }); },
    nomove() { tone(300, 0, 0.18, { type: 'triangle', to: 220, gain: 0.14 }); },
    win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.35, { type: 'triangle', gain: 0.2 })); },
    click() { tone(1000, 0, 0.03, { type: 'square', gain: 0.04 }); },
  };

  const Sound = {
    play(name) { if (!enabled || !fx[name]) return; try { fx[name](); } catch (e) { /* audio not available */ } },
    configure(on, vol) {
      enabled = !!on; volume = Math.max(0, Math.min(1, vol));
      if (master) master.gain.value = volume;
    },
    unlock() { if (enabled) ac(); },
  };
  root.L4P.Sound = Sound;
})(window);
