// Manual calibration aid: compares classifications at two depths for any PGNs
// in tests/fixtures/local (git-ignored). Run with:
//   CALIBRATE=1 npx vitest run --config vitest.engine.config.ts tests/engine/calibrate.test.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { reviewPgn } from '../support/runReview';

const dir = join(__dirname, '..', 'fixtures', 'local');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.pgn')) : [];

test.skipIf(!process.env.CALIBRATE || !files.length)('calibration report', async () => {
  for (const f of files) {
    const pgn = readFileSync(join(dir, f), 'utf8');
    const depths = (process.env.DEPTHS ?? '16,20').split(',').map(Number);
    const reports = [];
    for (const d of depths) reports.push(await reviewPgn(pgn, { depth: d }));
    console.log(`\n=== ${f}`);
    for (const [k, r] of reports.entries()) {
      const c = (s: typeof r.white) => ['inaccuracy', 'mistake', 'miss', 'blunder', 'great', 'brilliant'].map((x) => `${x[0]}${x[1]}:${s.counts[x as keyof typeof s.counts]}`).join(' ');
      console.log(`depth ${depths[k]}: W ${r.white.accuracy.toFixed(1)} [${c(r.white)}]  B ${r.black.accuracy.toFixed(1)} [${c(r.black)}]`);
    }
    const [a, b] = reports;
    for (let i = 0; i < a.moves.length; i++) {
      const m1 = a.moves[i];
      const m2 = b?.moves[i];
      const interesting = ['inaccuracy', 'mistake', 'miss', 'blunder', 'great', 'brilliant'];
      if (!interesting.includes(m1.classification) && !(m2 && interesting.includes(m2.classification))) continue;
      const label = `${m1.moveNumber}${m1.color === 'w' ? '.' : '...'}${m1.san}`.padEnd(12);
      console.log(
        `${label} d${depths[0]} ${m1.classification.padEnd(10)} epl=${m1.epl.toFixed(3)} wb=${m1.winBefore.toFixed(2)} wa=${m1.winAfter.toFixed(2)} | ` +
          (m2 ? `d${depths[1]} ${m2.classification.padEnd(10)} epl=${m2.epl.toFixed(3)}` : '') +
          `  :: ${m1.coach.body.join(' ')}`,
      );
    }
  }
});
