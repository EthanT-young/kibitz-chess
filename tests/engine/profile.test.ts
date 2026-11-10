import { test } from 'vitest';
import { Session } from 'node:inspector/promises';
import { reviewPgn } from '../support/runReview';
import { GAME_OF_THE_CENTURY } from '../fixtures/games';

test.skipIf(!process.env.PROFILE)('profile report build', async () => {
  await reviewPgn(GAME_OF_THE_CENTURY);
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.start');
  await reviewPgn(GAME_OF_THE_CENTURY);
  const { profile } = await session.post('Profiler.stop');
  const self = new Map<string, number>();
  const total = profile.endTime - profile.startTime;
  const dt = new Map<number, number>();
  profile.samples!.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas![i] ?? 0)));
  for (const n of profile.nodes) {
    const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + (dt.get(n.id) ?? 0));
  }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22);
  console.log(`total ${(total / 1000).toFixed(0)} ms`);
  for (const [k, v] of top) console.log(`${(v / 1000).toFixed(1).padStart(7)} ms  ${k}`);
});
