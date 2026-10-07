// The culture agent: an LLM tool-calling loop over Qloo-backed tools.
// Any OpenAI-compatible chat endpoint works (AI_BASE_URL / AI_MODEL / AI_API_KEY).
// If the model is unavailable or misbehaves, a deterministic planner finishes
// the same plan with the same tools, so the demo never dead-ends.
import { TOOLS, toolSchemas } from "./tools.mjs";

const AI_BASE_URL = process.env.AI_BASE_URL || "https://ollama.com/v1";
// Comma-separated list: the next model takes over if one keeps failing.
const AI_MODELS = (process.env.AI_MODEL || "gpt-oss:120b").split(",").map((m) => m.trim()).filter(Boolean);
let AI_MODEL = AI_MODELS[0];
const AI_API_KEY = process.env.AI_API_KEY || "";
const MAX_STEPS = 14;

const SYSTEM = `You are the FirstCiv culture agent. FirstCiv is a consent-first archive of 22 living cultures.
You use Qloo's taste graph (through tools) to build bridges from what a person or an audience already loves to living cultural heritage they have not met yet: music, food and places, plus how to engage respectfully.

Two modes:
- "explorer": one person shares favourites. Plan: resolve_tastes -> (find_concept_tags for abstract tastes) -> find_culture_bridges (top_n 4) -> for the top 2 bridges: culture_details and local_places in the user's city -> taste_map for the top bridge.
- "organizer": a community organizer describes an audience (city, demographic, things the audience loves). Plan: resolve_tastes for the audience favourites -> find_culture_bridges with demographic+location (top_n 4) -> for the top 3: rank_for_audience and local_places -> taste_map for the top bridge to suggest a neighbourhood.

Rules:
- Use only facts returned by tools. Never invent artists, venues, neighbourhood names, dates, numbers or community contacts. Name an area only if taste_map returned its name.
- Describe an artist only with words from its "about" field; if there is none, just name it. Never label an artist's ethnicity or nation yourself.
- Respect each bridge's artist_caveat: never call an artist a member of a people unless the tool says so.
- You never need to copy entity IDs: tools reuse the IDs resolved in this run automatically.
- Qloo results describe aggregate affinities of groups. Never say what a person "will" like; say "people who love X also gravitate to Y".
- Cuisine is the nearest regional cuisine, not the community's own food; say so when you mention it.
- Respect: point to the FirstCiv page and the community's own leadership; never suggest using sacred or ceremonial material as entertainment.
- If resolve_tastes leaves something unresolved, continue with what resolved and mention it briefly.
- Call several tools in parallel when they are independent.
- Final answer: 120-220 words, plain English, short paragraphs, no markdown tables, no headings. Explorer: name the 2-3 strongest bridges and why (which favourite pulled), one listening start and one food/place idea. Organizer: a concrete event concept (cultures, lineup order, food partners, area), and a one-line consent checklist.`;

export async function runAgent({ mode, tastes, city, demographic, note }, emit) {
  const ctx = { memory: {}, emit, trace: (t) => emit("qloo", t), city, demographic: mode === "organizer" ? demographic : null };
  const userMsg = JSON.stringify({ mode, favourites: tastes, city, demographic: demographic || null, note: note || null });
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: userMsg },
  ];
  const done = new Set();
  let usedModel = false;

  if (AI_API_KEY) {
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        emit("thinking", { step });
        const msg = await chat(messages);
        usedModel = true;
        messages.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls });
        if (!msg.tool_calls?.length) {
          if (!done.has("find_culture_bridges")) throw new Error("model answered before finding bridges");
          const text = (msg.content || "").trim();
          if (text.length < 40) throw new Error("model returned an empty answer");
          emit("message", { text, by: AI_MODEL });
          return finish(emit, ctx, { model: AI_MODEL, fallback: false });
        }
        const results = await Promise.all(
          msg.tool_calls.map(async (tc) => {
            const name = tc.function?.name;
            let args = {};
            try {
              args = JSON.parse(tc.function?.arguments || "{}");
            } catch {}
            const out = await callTool(name, args, ctx, done);
            return { role: "tool", tool_call_id: tc.id, name, content: JSON.stringify(out).slice(0, 6000) };
          })
        );
        messages.push(...results);
      }
      throw new Error("step budget exhausted");
    } catch (e) {
      emit("notice", { text: `Model planner stopped (${e.message}); finishing with the deterministic planner.` });
    }
  }
  await deterministic({ mode, tastes, city, demographic }, ctx, done);
  emit("message", { text: templateSummary(mode, ctx, city, demographic), by: "deterministic planner" });
  return finish(emit, ctx, { model: usedModel ? AI_MODEL : null, fallback: true });
}

function finish(emit, ctx, meta) {
  emit("done", meta);
  return meta;
}

async function callTool(name, args, ctx, done) {
  const tool = TOOLS[name];
  if (!tool) return { error: `Unknown tool ${name}` };
  // The same call twice (model repeats itself, or the fallback re-plans) is served from memory.
  const key = name + JSON.stringify(Object.entries(args).sort());
  ctx.memory.calls ||= {};
  if (ctx.memory.calls[key]) return ctx.memory.calls[key];
  ctx.emit("step", { tool: name, args: redactArgs(args) });
  try {
    const out = await tool.fn(args, ctx);
    done.add(name);
    ctx.memory.calls[key] = out;
    return out;
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

const redactArgs = (a) => JSON.parse(JSON.stringify(a));

async function chat(messages, attempt = 0) {
  try {
    return await chatOnce(messages);
  } catch (e) {
    if (attempt < 3 && /HTTP 5|HTTP 429|abort|fetch failed/i.test(e.message)) {
      // Second failure in a row: hand over to the next configured model.
      if (attempt >= 1 && AI_MODELS.length > 1) {
        AI_MODEL = AI_MODELS[(AI_MODELS.indexOf(AI_MODEL) + 1) % AI_MODELS.length];
      }
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      return chat(messages, attempt + 1);
    }
    throw e;
  }
}

async function chatOnce(messages) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(`${AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        tools: toolSchemas(),
        tool_choice: "auto",
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      console.error(`model HTTP ${res.status}: ${body}`);
      throw new Error(`model HTTP ${res.status}`);
    }
    const json = await res.json();
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error("empty model reply");
    return msg;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------- deterministic planner ---
async function deterministic({ mode, tastes, city, demographic }, ctx, done) {
  if (!ctx.memory.resolved) await callTool("resolve_tastes", { items: tastes }, ctx, done);
  const ids = (ctx.memory.resolved || []).map((r) => r.id);
  if (!ctx.memory.bridges) {
    const args = { entity_ids: ids, top_n: 4 };
    if (mode === "organizer" && demographic) Object.assign(args, { demographic, location: city });
    await callTool("find_culture_bridges", args, ctx, done);
  }
  const top = Object.keys(ctx.memory.bridges || {});
  const n = mode === "organizer" ? 3 : 2;
  await Promise.all(
    top.slice(0, n).flatMap((id) =>
      mode === "organizer"
        ? [
            callTool("rank_for_audience", { culture_id: id, demographic, city, entity_ids: ids }, ctx, done),
            callTool("local_places", { culture_id: id, city }, ctx, done),
          ]
        : [callTool("culture_details", { culture_id: id }, ctx, done), callTool("local_places", { culture_id: id, city }, ctx, done)]
    )
  );
  if (top[0]) await callTool("taste_map", { culture_id: top[0], city }, ctx, done);
}

function templateSummary(mode, ctx, city, demographic) {
  const b = Object.values(ctx.memory.bridges || {});
  if (!b.length) return "Qloo could not resolve enough of these favourites to build a bridge. Try a more specific artist, film or book.";
  const lines = b.slice(0, 3).map((x) => {
    const d = x.drivers[0]?.name;
    return `${x.culture.name}${d ? ` (pulled mostly by ${d})` : ""}: start with ${x.artists
      .slice(0, 2)
      .map((a) => a.name)
      .join(" and ")}.`;
  });
  if (mode === "organizer") {
    return `For a ${demographic || "general"} audience in ${city}, Qloo's affinities point to ${b
      .slice(0, 3)
      .map((x) => x.culture.name)
      .join(", ")}. ${lines.join(" ")} Before booking anything, contact the community organisations named on each FirstCiv page; nothing sacred goes on stage.`;
  }
  return `People who love what you love also gravitate toward these living traditions. ${lines.join(" ")} Each FirstCiv page explains how to engage on the community's own terms.`;
}
