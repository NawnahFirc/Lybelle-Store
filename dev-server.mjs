import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const hostIndex = args.indexOf("--host");
const port = Number(portIndex >= 0 ? args[portIndex + 1] : 4173);
const host = hostIndex >= 0 && args[hostIndex + 1] && !args[hostIndex + 1].startsWith("--")
  ? args[hostIndex + 1]
  : "0.0.0.0";
const root = process.cwd();

/* Local secrets (LYBELLE_ADMIN_PASSWORD, Redis keys) from .env.local, if present. */
const envFile = join(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

/* Same routes Vercel exposes from api/*.js. */
const API_ROUTES = new Set(["pricing", "quote", "orders", "admin"]);

createServer(async (req, res) => {
  try {
    const requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    const api = requestPath.match(/^\/api\/([a-z]+)\/?$/);
    if (api && API_ROUTES.has(api[1])) {
      const mod = await import(pathToFileURL(join(root, "api", `${api[1]}.js`)).href);
      return await mod.default(req, res);
    }
    if (/^\/(api|\.data|\.env)/.test(requestPath)) throw new Error("private");
    const safePath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
    let filePath = join(root, safePath === "/" ? "index.html" : safePath);
    /* cleanUrls, like vercel.json: /admin serves admin.html */
    if (!extname(filePath) && existsSync(filePath + ".html")) filePath += ".html";
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mime[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(body);
  } catch {
    if (res.headersSent) return res.end();
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, host, () => {
  process.stdout.write(`Lybelle preview ready on ${host}:${port}\n`);
});
