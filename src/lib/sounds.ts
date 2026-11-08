/**
 * Sovereign Chess — procedural sound engine (Web Audio API).
 * No audio files needed; every effect is synthesized for zero-latency play.
 */

export type SoundName =
  | "move"
  | "capture"
  | "castle"
  | "check"
  | "promote"
  | "win"
  | "lose"
  | "draw"
  | "tick"
  | "select"
  | "illegal";

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let enabled = true;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setSoundEnabled(v: boolean) {
  enabled = v;
}

export function primeAudio() {
  ac();
}

function tone(
  freq: number,
  duration: number,
  opts: {
    type?: OscillatorType;
    gain?: number;
    delay?: number;
    slideTo?: number;
    attack?: number;
  } = {}
) {
  const c = ac();
  if (!c || !masterGain) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(1, opts.slideTo),
      t0 + duration
    );
  }
  const peak = opts.gain ?? 0.25;
  const attack = opts.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function knock(
  freq: number,
  duration: number,
  gain: number,
  delay = 0,
  noise = 0.4
) {
  const c = ac();
  if (!c || !masterGain) return;
  const t0 = c.currentTime + delay;

  // wooden body: fast-decaying sine
  const osc = c.createOscillator();
  const og = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), t0 + duration);
  og.gain.setValueAtTime(gain, t0);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(og).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);

  // attack transient: filtered noise burst
  const bufferSize = Math.floor(c.sampleRate * 0.04);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1800;
  bp.Q.value = 0.8;
  const ng = c.createGain();
  ng.gain.value = gain * noise;
  src.connect(bp).connect(ng).connect(masterGain);
  src.start(t0);
}

export function playSound(name: SoundName) {
  if (!enabled) return;
  try {
    switch (name) {
      case "select":
        tone(1150, 0.05, { type: "triangle", gain: 0.06 });
        break;
      case "move":
        knock(190, 0.11, 0.5, 0, 0.35);
        break;
      case "capture":
        knock(150, 0.16, 0.7, 0, 0.9);
        tone(320, 0.08, { type: "square", gain: 0.05, delay: 0.015 });
        break;
      case "castle":
        knock(180, 0.1, 0.45);
        knock(210, 0.1, 0.45, 0.09);
        break;
      case "check":
        tone(880, 0.09, { type: "triangle", gain: 0.16 });
        tone(660, 0.14, { type: "triangle", gain: 0.16, delay: 0.09 });
        break;
      case "promote":
        tone(523, 0.09, { type: "triangle", gain: 0.14 });
        tone(659, 0.09, { type: "triangle", gain: 0.14, delay: 0.08 });
        tone(784, 0.16, { type: "triangle", gain: 0.16, delay: 0.16 });
        break;
      case "win":
        tone(523, 0.14, { type: "triangle", gain: 0.16 });
        tone(659, 0.14, { type: "triangle", gain: 0.16, delay: 0.12 });
        tone(784, 0.14, { type: "triangle", gain: 0.16, delay: 0.24 });
        tone(1047, 0.3, { type: "triangle", gain: 0.18, delay: 0.36 });
        break;
      case "lose":
        tone(392, 0.2, { type: "sawtooth", gain: 0.1 });
        tone(311, 0.24, { type: "sawtooth", gain: 0.1, delay: 0.18 });
        tone(233, 0.4, { type: "sawtooth", gain: 0.11, delay: 0.38 });
        break;
      case "draw":
        tone(440, 0.16, { type: "sine", gain: 0.14 });
        tone(440, 0.24, { type: "sine", gain: 0.12, delay: 0.2 });
        break;
      case "tick":
        tone(1250, 0.03, { type: "square", gain: 0.045 });
        break;
      case "illegal":
        tone(180, 0.09, { type: "sawtooth", gain: 0.08, slideTo: 120 });
        break;
    }
  } catch {
    // audio is best-effort; never break the game
  }
}
