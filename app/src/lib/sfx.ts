"use client";

/**
 * The table's sounds, synthesised rather than loaded.
 *
 * Every effect here is built from filtered noise and short tones through the
 * Web Audio API. Nothing is fetched, so the room sounds the same offline, adds
 * nothing to the bundle, and carries no sample licensing with it. Cards are
 * noise through a high pass, chips are noise through a band pass with a small
 * ring on top, and anything soft is noise through a low pass.
 *
 * Two browser rules shape the design. Audio cannot start before the player has
 * interacted with the page, so the context is created lazily and resumed on
 * demand; and nothing may be loud, because a poker table that startles you is
 * one you turn off. Everything sits well under a quarter of full scale.
 */

const STORE_KEY = "solpoker:muted";

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.muted = localStorage.getItem(STORE_KEY) === "1";
    }
  }

  isMuted() {
    return this.muted;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    try {
      localStorage.setItem(STORE_KEY, muted ? "1" : "0");
    } catch {
      // Not being able to remember the setting only costs the next reload.
    }
  }

  /** The audio context, made on first use and resumed if the browser paused it. */
  private engine() {
    if (this.muted || typeof window === "undefined") return null;
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.22;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** One second of white noise, reused by every effect that needs texture. */
  private noise(ctx: AudioContext) {
    if (!this.noiseBuffer) {
      const frames = ctx.sampleRate;
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  /**
   * A burst of filtered noise: the building block for cards, chips and thuds.
   */
  private burst(
    at: number,
    {
      duration = 0.06,
      type = "highpass" as BiquadFilterType,
      freq = 1800,
      q = 0.8,
      gain = 0.5,
      attack = 0.002,
    } = {},
  ) {
    const ctx = this.engine();
    if (!ctx || !this.master) return;
    const when = ctx.currentTime + at;

    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    src.playbackRate.value = 1;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(gain, when + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    src.connect(filter).connect(env).connect(this.master);
    src.start(when, Math.random() * 0.5, duration + 0.02);
    src.stop(when + duration + 0.02);
  }

  /** A short tone, for rings and chimes. */
  private tone(
    at: number,
    freq: number,
    { duration = 0.12, gain = 0.14, type = "sine" as OscillatorType, to = 0 } = {},
  ) {
    const ctx = this.engine();
    if (!ctx || !this.master) return;
    const when = ctx.currentTime + at;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, when + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(gain, when + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    osc.connect(env).connect(this.master);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  /** A card sliding onto the felt. */
  deal(at = 0) {
    this.burst(at, { duration: 0.075, freq: 1500, gain: 0.34 });
  }

  /** A card turning over: sharper and brighter than a deal. */
  flip(at = 0) {
    this.burst(at, { duration: 0.05, freq: 2600, gain: 0.4 });
    this.burst(at + 0.02, { duration: 0.04, freq: 1200, gain: 0.16 });
  }

  /** The riffle: a scatter of card sounds over half a second. */
  shuffle() {
    for (let i = 0; i < 9; i++) {
      this.burst(i * 0.045 + Math.random() * 0.02, {
        duration: 0.05,
        freq: 1400 + Math.random() * 900,
        gain: 0.2 + Math.random() * 0.12,
      });
    }
  }

  /** One chip landing: a click with a little ring in it. */
  chip(at = 0) {
    this.burst(at, { duration: 0.035, type: "bandpass", freq: 2600, q: 1.6, gain: 0.32 });
    this.tone(at + 0.006, 1250 + Math.random() * 260, { duration: 0.07, gain: 0.05 });
  }

  /** A bet or a raise: a few chips pushed forward. */
  bet() {
    this.chip(0);
    this.chip(0.045);
    this.chip(0.085);
  }

  /** A call: two chips, softer than a raise. */
  call() {
    this.chip(0);
    this.chip(0.06);
  }

  /** Knuckles on the table. */
  check() {
    this.burst(0, { duration: 0.05, type: "lowpass", freq: 320, gain: 0.5 });
    this.burst(0.09, { duration: 0.05, type: "lowpass", freq: 300, gain: 0.4 });
  }

  /** Cards pushed away: a soft, dull sweep. */
  fold() {
    this.burst(0, { duration: 0.16, type: "lowpass", freq: 520, gain: 0.34, attack: 0.02 });
  }

  /** The pot arriving: a cascade of chips with a rising note under it. */
  win() {
    for (let i = 0; i < 14; i++) {
      this.chip(i * 0.035 + Math.random() * 0.015);
    }
    this.tone(0.05, 520, { duration: 0.42, gain: 0.07, to: 780 });
  }

  /** It is your turn: two quiet notes, easy to miss and easy to notice. */
  turn() {
    this.tone(0, 660, { duration: 0.11, gain: 0.08 });
    this.tone(0.1, 880, { duration: 0.16, gain: 0.07 });
  }

  /** Somebody pulling out a chair: a soft wooden knock, then they settle. */
  seat(at = 0) {
    this.burst(at, { duration: 0.09, type: "lowpass", freq: 260, gain: 0.42, attack: 0.004 });
    this.tone(at + 0.05, 340, { duration: 0.14, gain: 0.05, to: 300 });
  }

  /** A chair pushed back. The knock without the settle. */
  standUp(at = 0) {
    this.burst(at, { duration: 0.12, type: "lowpass", freq: 220, gain: 0.3, attack: 0.01 });
  }

  /**
   * Your own two cards arriving, and only yours.
   *
   * Deliberately different from `deal`, which is the pass around the table and
   * belongs to everybody. This is the moment the cards become yours to look
   * at, so it lifts rather than clicks.
   */
  peek(at = 0) {
    this.burst(at, { duration: 0.06, freq: 1900, gain: 0.3 });
    this.burst(at + 0.085, { duration: 0.06, freq: 2200, gain: 0.3 });
    this.tone(at + 0.09, 760, { duration: 0.2, gain: 0.05, to: 1040 });
  }

  /** Chips bought or sold. */
  cash() {
    this.chip(0);
    this.chip(0.05);
    this.tone(0.02, 700, { duration: 0.22, gain: 0.06, to: 950 });
  }
}

export const sfx = new Sfx();
