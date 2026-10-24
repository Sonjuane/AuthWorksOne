// Serves the built Hub UI (apps/hub/ui/dist): hashed assets with long caching, and index.html for
// every other GET so the single-page app handles its own routes.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UI_DIST = fileURLToPath(new URL('../ui/dist/', import.meta.url));
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };

// Absolute file under `root` for a URL path, or null (rejects traversal and dotfiles).
export function resolveStatic(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.split('/').some((part) => part.startsWith('.'))) return null;
  const file = normalize(join(root, decoded));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

export function createStaticHandler({ root = UI_DIST } = {}) {
  const built = existsSync(join(root, 'index.html'));
  return {
    built,
    serve(ctx) {
      const file = resolveStatic(root, ctx.url.pathname);
      const target = file ?? join(root, 'index.html');
      return ctx.send(200, {
        'Content-Type': TYPES[extname(target)] ?? (target.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream'),
        'Cache-Control': file && ctx.url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      }, readFileSync(target));
    },
  };
}
