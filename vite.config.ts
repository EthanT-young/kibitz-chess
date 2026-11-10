import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for the built site. GitHub Pages can't send headers,
 * so it goes in a <meta> tag. Build-only: the dev server injects inline
 * scripts and <style> tags that this policy (deliberately) forbids.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self' https://api.chess.com https://lichess.org",
  "img-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function securityMeta(): Plugin {
  return {
    name: 'kibitz-security-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
    ],
  };
}

// `base: './'` keeps every URL relative, so the built `dist/` folder works on
// any static host (GitHub Pages project sites, Netlify, a plain file server).
export default defineConfig({
  base: './',
  plugins: [react(), securityMeta()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  worker: { format: 'es' },
});
