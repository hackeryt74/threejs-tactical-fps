// Every sound is synthesized with WebAudio: no audio files, no network, and the
// same calls from any code path. The context is created lazily on the first user
// gesture (a browser will not let audio start before one), and every effect is a
// short burst of noise or an oscillator, so nothing allocates per frame.
let context = null;
let noiseBuffer = null;
let master = null;

export function ensureAudio() {
  if (context) {
    if (context.state === 'suspended') context.resume();
    return context;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  context = new AudioContextClass();
  master = context.createGain();
  master.gain.value = 0.5;
  master.connect(context.destination);
  const length = context.sampleRate * 0.5;
  noiseBuffer = context.createBuffer(1, length, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return context;
}

function noiseBurst(duration, filterType, frequency, gainValue, decay = 0.001) {
  if (!context || !noiseBuffer) return;
  const time = context.currentTime;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  const gain = context.createGain();
  gain.gain.setValueAtTime(gainValue, time);
  gain.gain.exponentialRampToValueAtTime(decay, time + duration);
  source.connect(filter).connect(gain).connect(master);
  source.start(time, Math.random() * 0.3, duration);
}

function tone(type, from, to, duration, gainValue) {
  if (!context) return;
  const time = context.currentTime;
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, time);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), time + duration);
  const gain = context.createGain();
  gain.gain.setValueAtTime(gainValue, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  oscillator.connect(gain).connect(master);
  oscillator.start(time);
  oscillator.stop(time + duration);
}

function beep(frequency, at, duration = 0.07, gainValue = 0.12) {
  if (!context) return;
  const time = context.currentTime + at;
  const oscillator = context.createOscillator();
  oscillator.type = 'square';
  oscillator.frequency.value = frequency;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(gainValue, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  oscillator.connect(gain).connect(master);
  oscillator.start(time);
  oscillator.stop(time + duration);
}

export const sfx = {
  shot(kind) {
    if (kind === 'sniper') {
      noiseBurst(0.32, 'lowpass', 900, 0.7);
      tone('sine', 160, 38, 0.3, 0.55);
    } else if (kind === 'smg') {
      noiseBurst(0.09, 'bandpass', 2400, 0.42);
      tone('square', 220, 90, 0.07, 0.14);
    } else if (kind === 'pistol') {
      noiseBurst(0.12, 'bandpass', 1800, 0.5);
      tone('square', 190, 70, 0.09, 0.18);
    } else {
      noiseBurst(0.16, 'bandpass', 1500, 0.6);
      tone('square', 160, 55, 0.12, 0.22);
    }
  },
  distantShot() {
    noiseBurst(0.18, 'lowpass', 700, 0.22);
  },
  dryFire() {
    tone('square', 900, 500, 0.04, 0.1);
  },
  reload() {
    beep(1400, 0.05, 0.04, 0.08);
    beep(900, 0.45, 0.04, 0.08);
    beep(1600, 0.95, 0.05, 0.1);
  },
  hit() {
    tone('sine', 1900, 1900, 0.05, 0.14);
  },
  kill() {
    tone('sine', 1200, 1200, 0.06, 0.14);
    tone('sine', 1800, 1800, 0.09, 0.12);
  },
  hurt() {
    noiseBurst(0.12, 'lowpass', 500, 0.4);
    tone('sine', 110, 60, 0.14, 0.3);
  },
  step() {
    noiseBurst(0.05, 'lowpass', 420, 0.07);
  },
  plantBeep() {
    beep(2200, 0, 0.06, 0.12);
  },
  defuseBeep() {
    beep(1600, 0, 0.06, 0.12);
  },
  plantDone() {
    beep(2200, 0, 0.08, 0.14);
    beep(2200, 0.12, 0.08, 0.14);
    beep(2600, 0.24, 0.14, 0.14);
  },
  explosion() {
    noiseBurst(0.9, 'lowpass', 420, 0.9);
    tone('sine', 120, 28, 0.8, 0.8);
  },
  grenadePin() {
    tone('square', 1100, 700, 0.05, 0.1);
  },
  buy() {
    tone('sine', 900, 900, 0.05, 0.1);
    tone('sine', 1350, 1350, 0.07, 0.1);
  },
  roundWin() {
    tone('sine', 523, 523, 0.16, 0.16);
    tone('sine', 659, 659, 0.16, 0.16);
    tone('sine', 784, 784, 0.3, 0.16);
  },
  roundLose() {
    tone('sine', 392, 392, 0.18, 0.16);
    tone('sine', 311, 311, 0.18, 0.16);
    tone('sine', 262, 262, 0.34, 0.16);
  },
};
