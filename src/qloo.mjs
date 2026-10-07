// Qloo access layer: one long-lived `qloo mcp` stdio server (the official
// @qloo/qloo-harness), a small concurrency gate, and a disk cache so repeated
// demo questions do not spend event quota. The key only lives in this process'
// environment; nothing here is ever sent to the browser.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = process.env.QLOO_CACHE_DIR || join(ROOT, "data", "cache");
const CACHE_TTL_MS = Number(process.env.QLOO_CACHE_TTL_H || 72) * 3600_000;
const MAX_PARALLEL = Number(process.env.QLOO_MAX_PARALLEL || 3);
const QLOO_BIN = join(ROOT, "node_modules", ".bin", "qloo");

mkdirSync(CACHE_DIR, { recursive: true });

// The hackathon gateway is a custom base URL; the harness refuses to send the
// credential there unless the exact endpoint is explicitly trusted.
if (process.env.QLOO_BASE_URL && !process.env.QLOO_TRUSTED_BASE_URL) {
  process.env.QLOO_TRUSTED_BASE_URL = process.env.QLOO_BASE_URL;
}

let clientPromise = null;
let toolList = null;

async function connect() {
  const client = new Client({ name: "firstciv-culture-agent", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: QLOO_BIN,
    args: ["mcp"],
    env: process.env,
    stderr: "pipe",
  });
  transport.onclose = () => {
    clientPromise = null;
  };
  await client.connect(transport);
  const { tools } = await client.listTools();
  toolList = tools;
  return client;
}

function getClient() {
  if (!clientPromise) {
    clientPromise = connect().catch((e) => {
      clientPromise = null;
      throw e;
    });
  }
  return clientPromise;
}

export async function listQlooTools() {
  await getClient();
  return toolList;
}

// --- concurrency gate ------------------------------------------------------
let active = 0;
const waiters = [];
async function gate(fn) {
  if (active >= MAX_PARALLEL) await new Promise((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

// --- cache -----------------------------------------------------------------
const keyOf = (tool, args) =>
  createHash("sha256").update(tool + JSON.stringify(args)).digest("hex").slice(0, 24);

function readCache(key) {
  const f = join(CACHE_DIR, key + ".json");
  if (!existsSync(f)) return null;
  try {
    const hit = JSON.parse(readFileSync(f, "utf8"));
    if (Date.now() - hit.at > CACHE_TTL_MS) return null;
    return hit.envelope;
  } catch {
    return null;
  }
}

const stats = { calls: 0, cacheHits: 0, errors: 0 };
export const qlooStats = () => ({ ...stats });

/**
 * Call one Qloo MCP workflow tool. Returns the normalized envelope
 * ({status, results, interpretation, provenance, ...}) plus `_meta`.
 * `onTrace` receives a redacted record of the call for the UI trace.
 */
export async function qloo(tool, args, opts = {}) {
  let out;
  let attempt = 0;
  for (; attempt < 4; attempt++) {
    out = await qlooOnce(tool, args, opts);
    if (!needsRetry(out.envelope)) break;
    // 429s need a real pause; other transient errors a short one.
    const rate = out.envelope.error?.code === "QLOO_RATE_LIMIT";
    await new Promise((r) => setTimeout(r, (rate ? 1500 : 600) * 2 ** attempt + Math.random() * 300));
  }
  opts.onTrace?.({ ...out.trace, attempts: Math.min(attempt + 1, 4) });
  return out.envelope;
}

const FATAL = new Set(["QLOO_AUTH", "QLOO_CONFIGURATION_ERROR", "INVALID_INPUT", "VALIDATION"]);
function needsRetry(env) {
  if (env?.status !== "error") return false;
  if (process.env.QLOO_DEBUG) console.error("qloo error", JSON.stringify(env.error), env.summary);
  return !FATAL.has(env.error?.code);
}

async function qlooOnce(tool, args, { label } = {}) {
  const key = keyOf(tool, args);
  const started = Date.now();
  const cached = readCache(key);
  let envelope;
  let cache = false;
  if (cached) {
    envelope = cached;
    cache = true;
    stats.cacheHits++;
  } else {
    envelope = await gate(async () => {
      const client = await getClient();
      stats.calls++;
      const res = await client.callTool({ name: tool, arguments: args }, undefined, {
        timeout: 45_000,
      });
      const env = res.structuredContent ?? safeJson(res.content?.[0]?.text) ?? {};
      return env.status ? env : { ...env, status: "error", error: env.error || { code: "UNKNOWN" } };
    }).catch((e) => ({
      status: "error",
      summary: String(e.message || e),
      results: [],
      error: { code: "TRANSPORT", retryable: true, recovery: "Retry shortly." },
    }));
    if (["ok", "empty", "partial", "degraded"].includes(envelope.status)) {
      writeFileSync(join(CACHE_DIR, key + ".json"), JSON.stringify({ at: Date.now(), envelope }));
    } else if (envelope.status === "error") {
      stats.errors++;
    }
  }
  const trace = {
    tool,
    label: label || tool,
    args,
    status: envelope.status,
    summary: envelope.summary || null,
    result_count: Array.isArray(envelope.results) ? envelope.results.length : envelope.result_count ?? 0,
    endpoint: envelope.provenance?.endpoint || null,
    requests: (envelope.provenance?.requests || []).map((r) => ({
      method: r.method,
      path: r.path,
      query: r.query,
    })),
    error: envelope.error?.code || null,
    cache,
    ms: Date.now() - started,
  };
  return { envelope, trace };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function closeQloo() {
  if (clientPromise) (await clientPromise).close();
}
