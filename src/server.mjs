// HTTP server: static front end + Server-Sent Events stream of the agent run.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "./agent.mjs";
import { CULTURES } from "./tools.mjs";
import { listQlooTools, qlooStats } from "./qloo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT || 8795);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_RUNS || 4);
const RUNS_PER_WINDOW = Number(process.env.RUNS_PER_IP || 12);
const WINDOW_MS = 10 * 60_000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};
const ENTITY_TYPES = new Set(["artist", "movie", "tv_show", "book", "place", "brand", "videogame", "podcast", "person"]);
const PII = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{8,}\d/;

let running = 0;
const hits = new Map();

function rateOk(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= RUNS_PER_WINDOW) return false;
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

function clean(s, max) {
  return String(s ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, max);
}

function validate(body) {
  const mode = body.mode === "organizer" ? "organizer" : "explorer";
  const tastes = (Array.isArray(body.tastes) ? body.tastes : [])
    .map((t) => ({ name: clean(t?.name, 80), type: ENTITY_TYPES.has(t?.type) ? t.type : "artist" }))
    .filter((t) => t.name)
    .slice(0, 6);
  const city = clean(body.city, 60) || "Ottawa, Canada";
  const demographic = clean(body.demographic, 40) || null;
  const note = clean(body.note, 300) || null;
  if (!tastes.length) return { error: "Add at least one favourite (an artist, film, show, book or place)." };
  const all = [city, note || "", demographic || "", ...tastes.map((t) => t.name)].join(" ");
  if (PII.test(all))
    return { error: "Please leave out emails and phone numbers. The agent only needs tastes, never personal data." };
  return { mode, tastes, city, demographic, note };
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 16_000) throw new Error("too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const send = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
};

async function handleRun(req, res) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  let body;
  try {
    body = validate(await readBody(req));
  } catch {
    return send(res, 400, { error: "Bad request." });
  }
  if (body.error) return send(res, 400, body);
  if (!rateOk(ip)) return send(res, 429, { error: "Easy there — try again in a few minutes." });
  if (running >= MAX_CONCURRENT) return send(res, 503, { error: "The agent is busy with other visitors. Try again in a minute." });

  running++;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  let closed = false;
  req.on("close", () => (closed = true));
  const emit = (type, data) => {
    if (closed) return;
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const ping = setInterval(() => emit("ping", {}), 15_000);
  emit("start", { mode: body.mode, city: body.city, demographic: body.demographic });
  try {
    await runAgent(body, emit);
  } catch (e) {
    emit("error", { text: "The agent hit an unexpected error. Please try again." });
    console.error("run failed", e);
  } finally {
    clearInterval(ping);
    running--;
    res.end();
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);
  if (path === "/") path = "/index.html";
  const file = normalize(join(PUBLIC, path));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "forbidden" });
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": path.endsWith(".html") ? "no-cache" : "public, max-age=3600",
    });
    res.end(data);
  } catch {
    send(res, 404, { error: "not found" });
  }
}

const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  const { pathname } = new URL(req.url, "http://x");
  if (req.method === "POST" && pathname === "/api/run") return handleRun(req, res);
  if (pathname === "/api/cultures")
    return send(
      res,
      200,
      CULTURES.map((c) => ({
        id: c.id,
        name: c.name,
        region: c.region,
        color: c.color,
        lon: c.lon,
        lat: c.lat,
        practice: c.practice,
        firstciv_url: c.firstciv_url,
        has_music_bridge: !!c.qloo.music?.length,
        music_scope: c.qloo.music_scope,
        food_label: c.qloo.food_label,
        anchors: c.qloo.anchors.slice(0, 4).map((a) => a.name),
      }))
    );
  if (pathname === "/api/health") {
    let tools = 0;
    try {
      tools = (await listQlooTools()).length;
    } catch {}
    return send(res, 200, { ok: true, qloo_mcp_tools: tools, running, ...qlooStats() });
  }
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  send(res, 405, { error: "method not allowed" });
});

server.listen(PORT, () => console.log(`FirstCiv culture agent on :${PORT}`));
