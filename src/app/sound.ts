/**
 * Small synthesized board sounds (no audio files): a soft wooden "tock" for a
 * move, a heavier double knock for a capture, a brighter click for check.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function knock(ac: AudioContext, at: number, freq: number, gain: number, decay: number): void {
  const len = Math.floor(ac.sampleRate * decay);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(at);
}

export type MoveSound = 'move' | 'capture' | 'check' | 'castle';

export function playMoveSound(kind: MoveSound): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  switch (kind) {
    case 'capture':
      knock(ac, t, 900, 1.6, 0.09);
      knock(ac, t + 0.045, 1300, 1.0, 0.07);
      break;
    case 'check':
      knock(ac, t, 1500, 1.3, 0.08);
      knock(ac, t + 0.06, 2200, 0.6, 0.06);
      break;
    case 'castle':
      knock(ac, t, 1100, 1.1, 0.07);
      knock(ac, t + 0.09, 1100, 1.0, 0.07);
      break;
    default:
      knock(ac, t, 1200, 1.2, 0.08);
  }
}

export function soundForSan(san: string): MoveSound {
  if (san.includes('+') || san.includes('#')) return 'check';
  if (san.includes('x')) return 'capture';
  if (san.startsWith('O-O')) return 'castle';
  return 'move';
}
