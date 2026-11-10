// Writes .zst and .gz copies of the compressible files in dist/ so the
// Docker image's Caddy can serve them as-is instead of compressing every
// response. Used by the Dockerfile; needs Node 22.15+ for zstd.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, zstdCompressSync, constants } from 'node:zlib';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const compressible = /\.(html|js|mjs|css|svg|json|wasm|txt|map)$/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let n = 0;
for (const file of walk(dist)) {
  if (!compressible.test(file)) continue;
  const data = readFileSync(file);
  if (data.length < 1024) continue;
  writeFileSync(`${file}.gz`, gzipSync(data, { level: 9 }));
  writeFileSync(
    `${file}.zst`,
    zstdCompressSync(data, { params: { [constants.ZSTD_c_compressionLevel]: 19 } }),
  );
  n++;
}
console.log(`[precompress] wrote .gz and .zst for ${n} files`);
