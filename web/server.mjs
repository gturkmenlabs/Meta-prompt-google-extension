// Zero-dependency static server for local use: `npm start`.
// ES modules do not load from file://, so the app needs an http origin. The
// app itself is plain static files and deploys to any static host unchanged.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

// Only the app's own folders are reachable; the project root also holds
// tests, docs and possibly a .env, none of which should be served.
const ALLOWED_DIRS = new Set(["", "web", "icons"]);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; " +
    "connect-src 'self' https://api.anthropic.com https://openrouter.ai https://api.typesafe.ai; " +
    "base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'"
};

/**
 * Maps a request path to a servable file, or null when it must be refused.
 * Pure (no I/O) so the guard can be tested offline.
 */
export function resolveRequest(root, rawPath) {
  let path;
  try {
    path = decodeURIComponent(String(rawPath || "/").split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (path.includes("\0") || path.includes("\\")) return null;
  if (path === "/" || path === "") path = "/index.html";

  const segments = path.split("/").filter(Boolean);
  if (segments.some((s) => s === ".." || s.startsWith("."))) return null;
  if (segments.length > 2) return null;

  const dir = segments.length === 2 ? segments[0] : "";
  const file = segments[segments.length - 1];
  if (!ALLOWED_DIRS.has(dir)) return null;
  if (!MIME_TYPES[extname(file).toLowerCase()]) return null;

  const full = normalize(join(root, ...segments));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return { file: full, type: MIME_TYPES[extname(file).toLowerCase()] };
}

export function createAppServer(root = ROOT) {
  return createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", ...SECURITY_HEADERS }).end();
      return;
    }
    const target = resolveRequest(root, req.url);
    try {
      if (!target || !(await stat(target.file)).isFile()) throw new Error("not found");
      const body = await readFile(target.file);
      res.writeHead(200, { "Content-Type": target.type, "Cache-Control": "no-cache", ...SECURITY_HEADERS });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
      res.end("Not found");
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 5173;
  const host = process.env.HOST || "127.0.0.1";
  createAppServer().listen(port, host, () => {
    console.log(`MetaPrompt is running at http://${host}:${port}/`);
  });
}
