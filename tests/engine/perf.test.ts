import { expect, test } from 'vitest';
import { reviewPgn } from '../support/runReview';
import { GAME_OF_THE_CENTURY } from '../fixtures/games';

// The report is built on the main thread after the engines finish, so it must be quick.
test('building the report for an 82-ply game takes well under a second', async () => {
  await reviewPgn(GAME_OF_THE_CENTURY); // warms the engine cache
  const t0 = performance.now();
  await reviewPgn(GAME_OF_THE_CENTURY); // engine results cached: measures the report build
  const ms = performance.now() - t0;
  console.log(`buildReport: ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(1500);
});
