// Agent tools. Each tool is a small, auditable composition of Qloo workflow
// calls (through `qloo mcp`) plus FirstCiv's consent-first culture records.
// Tools return compact JSON for the model and emit rich `data` events for the UI.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { qloo } from "./qloo.mjs";
import { areaName } from "./geo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CULTURES = JSON.parse(readFileSync(join(ROOT, "data", "cultures.json"), "utf8"));
const byId = Object.fromEntries(CULTURES.map((c) => [c.id, c]));

const ENTITY_TYPES = ["artist", "movie", "tv_show", "book", "place", "brand", "videogame", "podcast", "person"];
const DEFAULT_RESPECT =
  "Follow the community's own leadership, credit and pay makers directly, and leave sacred or restricted material alone.";

const round = (x, d = 2) => (typeof x === "number" ? Number(x.toFixed(d)) : null);
const short = (s, n = 160) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s || null);

function cultureCard(c) {
  return {
    id: c.id,
    name: c.name,
    epithet: c.epithet,
    region: c.region,
    language: c.language,
    practice: c.practice,
    blurb: c.blurb,
    color: c.color,
    lon: c.lon,
    lat: c.lat,
    respect: c.respect || DEFAULT_RESPECT,
    firstciv_url: c.firstciv_url,
    music_scope: c.qloo.music_scope,
    music_tags: c.qloo.music,
    food_label: c.qloo.food_label,
  };
}

// ---------------------------------------------------------------- tools ----

async function resolve_tastes({ items }, ctx) {
  const list = (items || []).slice(0, 6);
  const resolved = [];
  const unresolved = [];
  await Promise.all(
    list.map(async (it) => {
      const type = ENTITY_TYPES.includes(it.type) ? it.type : undefined;
      const env = await qloo(
        "qloo_describe",
        type ? { entity: it.name, type } : { entity: it.name },
        { onTrace: ctx.trace, label: `Resolve “${it.name}”` }
      );
      if (env.status === "ok" && env.results?.[0]) {
        const r = env.results[0];
        resolved.push({
          input: it.name,
          id: r.entity_id,
          name: r.name,
          type: type || r.subtype?.replace("urn:entity:", "") || "entity",
          image: r.properties?.image?.url || null,
          about: short(r.properties?.short_description || r.properties?.description, 140),
        });
      } else {
        const cands = (env.resolution?.issues?.[0]?.candidates || []).slice(0, 4).map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type?.replace("urn:entity:", ""),
          about: short(c.description, 90),
        }));
        unresolved.push({ input: it.name, status: env.status, candidates: cands });
      }
    })
  );
  // Keep the user's order.
  resolved.sort((a, b) => list.findIndex((x) => x.name === a.input) - list.findIndex((x) => x.name === b.input));
  ctx.memory.names = { ...(ctx.memory.names || {}), ...Object.fromEntries(resolved.map((r) => [r.id, r.name])) };
  ctx.memory.resolved = resolved;
  ctx.emit("data", { kind: "tastes", resolved, unresolved });
  return { resolved: resolved.map(({ image, ...r }) => r), unresolved };
}

async function find_concept_tags({ query }, ctx) {
  const env = await qloo("qloo_find_tags", { query, limit: 5 }, { onTrace: ctx.trace, label: `Tags for “${query}”` });
  const tags = (env.results || []).map((t) => ({ id: t.id, name: t.name }));
  ctx.emit("data", { kind: "concept", query, tags });
  return { query, tags };
}

// Models sometimes mangle long UUIDs; only accept IDs this run actually resolved.
function knownIds(ids, ctx) {
  const known = (ctx.memory.resolved || []).map((r) => r.id);
  const picked = (ids || []).filter((id) => known.includes(id));
  return picked.length ? picked : known;
}

async function find_culture_bridges({ entity_ids = [], signal_tags = [], demographic, location, top_n = 4 }, ctx) {
  const signals = knownIds(entity_ids, ctx).slice(0, 6);
  location = location || ctx.city;
  demographic = demographic || ctx.demographic || undefined;
  const sigTags = signal_tags.slice(0, 4);
  if (!signals.length && !sigTags.length) return { error: "Need at least one resolved entity id or concept tag." };
  const names = ctx.memory.names || {};
  const candidates = CULTURES.filter((c) => c.qloo.music?.length);
  ctx.emit("data", { kind: "scan", total: candidates.length, cultures: candidates.map((c) => c.id) });

  const scored = await Promise.all(
    candidates.map(async (c) => {
      const args = {
        target_type: "artist",
        include_tags: c.qloo.music,
        include_tags_operator: "union",
        limit: 4,
        explain: true,
      };
      if (signals.length) args.signals = signals;
      if (sigTags.length) {
        args.signal_tags = sigTags;
        args.signal_tags_operator = "union";
      }
      if (demographic && location) {
        args.demographic = demographic;
        args.signal_location = location;
      }
      const env = await qloo("qloo_recommend", args, {
        onTrace: ctx.trace,
        label: `Bridge → ${c.name}`,
      });
      const results = env.results || [];
      const top = results.slice(0, 3).map((r) => r.affinity || 0);
      const score = top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
      // Which of the user's loves pulled hardest toward this culture?
      const pull = {};
      for (const r of results) {
        for (const e of r.explainability?.["signal.interests.entities"] || []) {
          pull[e.entity_id] = (pull[e.entity_id] || 0) + (e.score || 0);
        }
      }
      const drivers = Object.entries(pull)
        .sort((a, b) => b[1] - a[1])
        .map(([id, s]) => ({ id, name: names[id] || id, weight: round(s / Math.max(results.length, 1)) }));
      const card = {
        culture: cultureCard(c),
        status: env.status,
        score: round(score, 3),
        drivers,
        artists: results.map((r) => ({
          id: r.entity_id,
          name: r.name,
          affinity: round(r.affinity, 3),
          image: r.properties?.image?.url || null,
          about: short(r.properties?.short_description || r.properties?.description, 150),
        })),
      };
      ctx.emit("data", { kind: "bridge-scan", id: c.id, score: card.score, status: env.status });
      return card;
    })
  );
  const ranked = scored.filter((s) => s.artists.length).sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, Math.min(Math.max(top_n, 1), 6));
  ctx.memory.bridges = Object.fromEntries(top.map((b) => [b.culture.id, b]));
  ctx.emit("data", {
    kind: "bridges",
    bridges: top,
    others: ranked.slice(top.length).map((b) => ({ id: b.culture.id, name: b.culture.name, score: b.score })),
    no_signal: CULTURES.filter((c) => !c.qloo.music?.length).map((c) => ({ id: c.id, name: c.name })),
  });
  return {
    note: "Scores are Qloo affinities averaged over the top 3 artists inside each culture's music tags; compare within this list only.",
    bridges: top.map((b) => ({
      culture_id: b.culture.id,
      culture: b.culture.name,
      score: b.score,
      music_scope: b.culture.music_scope,
      strongest_driver: b.drivers[0]?.name || null,
      artist_caveat:
        b.culture.music_scope === "culture"
          ? "Artists come from Qloo music tags named for this tradition; do not claim personal membership."
          : `Tag scope is "${b.culture.music_scope}": these artists sit in the wider regional/related tradition, not necessarily members of this people.`,
      artists: b.artists.slice(0, 3).map((a) => ({ name: a.name, affinity: a.affinity, about: short(a.about, 110) })),
    })),
    weaker: ranked.slice(top.length).map((b) => `${b.culture.name} ${b.score}`),
  };
}

async function culture_details({ culture_id }, ctx) {
  const c = byId[culture_id];
  if (!c) return { error: `Unknown culture_id. Valid: ${Object.keys(byId).join(", ")}` };
  const card = cultureCard(c);
  ctx.emit("data", { kind: "culture", culture: { ...card, intro: c.intro } });
  return { ...card, intro: short(c.intro, 600), anchors: c.qloo.anchors.slice(0, 5).map((a) => a.name) };
}

async function local_places({ culture_id, city }, ctx) {
  const c = byId[culture_id];
  if (!c) return { error: "Unknown culture_id." };
  if (!c.qloo.food?.length) {
    const out = { culture_id, city, places: [], note: `No honest Qloo cuisine tag exists for ${c.name}; none shown.` };
    ctx.emit("data", { kind: "places", ...out, label: null });
    return out;
  }
  const env = await qloo(
    "qloo_recommend",
    {
      target_type: "place",
      signal_location: city,
      filter_location: city,
      include_tags: c.qloo.food,
      include_tags_operator: "union",
      limit: 6,
      explain: false,
    },
    { onTrace: ctx.trace, label: `${c.qloo.food_label} food in ${city}` }
  );
  const places = (env.results || []).map((r) => ({
    id: r.entity_id,
    name: r.name,
    address: r.properties?.address || null,
    rating: r.properties?.business_rating ?? null,
    about: short(r.properties?.short_description || r.properties?.description, 140),
    lat: r.location?.lat ?? r.properties?.geocode?.lat ?? null,
    lon: r.location?.lon ?? r.properties?.geocode?.lon ?? null,
    affinity: round(r.affinity),
  }));
  const out = { culture_id, city, label: c.qloo.food_label, places };
  ctx.emit("data", { kind: "places", ...out });
  return { ...out, places: places.map((p) => `${p.name} — ${p.address || "address n/a"}`) };
}

async function taste_map({ culture_id, city }, ctx) {
  const c = byId[culture_id];
  if (!c) return { error: "Unknown culture_id." };
  const bridge = ctx.memory.bridges?.[culture_id];
  const artist = bridge?.artists?.[0] || c.qloo.anchors?.[0];
  if (!artist) return { error: "No artist to map for this culture." };
  const env = await qloo(
    "qloo_where_popular",
    { entity: artist.id, entity_type: "artist", within: city, limit: 12 },
    { onTrace: ctx.trace, label: `Where ${artist.name} fans cluster in ${city}` }
  );
  const cells = (env.results || [])
    .filter((r) => r.location?.latitude)
    .map((r) => ({
      lat: r.location.latitude,
      lon: r.location.longitude,
      affinity: round(r.query?.affinity ?? r.query?.entity_artist_affinity ?? 0),
      rank: round(r.query?.affinity_rank ?? 0, 3),
    }));
  for (const cell of cells.slice(0, 4)) cell.area = await areaName(cell.lat, cell.lon);
  const out = { culture_id, city, artist: artist.name, cells };
  ctx.emit("data", { kind: "map", ...out, culture: c.name, color: c.color });
  return {
    culture_id,
    artist: artist.name,
    cells: cells.length,
    strongest_areas: cells.slice(0, 3).map((x) => `${x.area || "unnamed area"} (${x.lat.toFixed(3)},${x.lon.toFixed(3)})`),
    note: "Grid cells where affinity for this artist is relatively high; describes an aggregate area, not people.",
  };
}

async function rank_for_audience({ culture_id, demographic, city, entity_ids = [] }, ctx) {
  entity_ids = knownIds(entity_ids, ctx);
  demographic = demographic || ctx.demographic || undefined;
  city = city || ctx.city;
  const c = byId[culture_id];
  if (!c) return { error: "Unknown culture_id." };
  const bridge = ctx.memory.bridges?.[culture_id];
  const pool = [...(bridge?.artists || []), ...c.qloo.anchors];
  const seen = new Set();
  const options = pool.filter((a) => a.id && !seen.has(a.id) && seen.add(a.id)).slice(0, 10);
  if (options.length < 2) return { error: "Not enough artists to rank." };
  const args = { options: options.map((o) => o.id), option_type: "artist" };
  if (demographic) {
    args.demographic = demographic;
    args.signal_location = city || "Ottawa, Canada";
  }
  if (entity_ids.length) args.signals = entity_ids.slice(0, 6);
  if (!demographic && !entity_ids.length) args.signal_location = city || "Ottawa, Canada";
  let env = await qloo("qloo_rank", args, {
    onTrace: ctx.trace,
    label: `Rank ${c.name} lineup for ${demographic || "this audience"}`,
  });
  // One stale option ID makes Qloo ask for input; drop the IDs it cannot find and rank the rest.
  const missing = (env.resolution?.issues || []).filter((i) => i.field === "options").map((i) => i.input);
  if (env.status === "needs_input" && missing.length && args.options.length - missing.length >= 2) {
    args.options = args.options.filter((id) => !missing.includes(id));
    env = await qloo("qloo_rank", args, { onTrace: ctx.trace, label: `Re-rank ${c.name} without ${missing.length} stale ID(s)` });
  }
  // Qloo sometimes ranks nothing when the audience's favourites and these artists share no signal:
  // rank again on demographic + city alone, which still answers "who plays best to this audience".
  if (env.status === "ok" && !env.results?.length && args.signals) {
    delete args.signals;
    args.signal_location ||= city || "Ottawa, Canada";
    env = await qloo("qloo_rank", args, { onTrace: ctx.trace, label: `Re-rank ${c.name} on audience only` });
  }
  const meta = Object.fromEntries(options.map((o) => [o.id, o]));
  const ranked = (env.results || []).map((r, i) => ({
    position: i + 1,
    id: r.entity_id,
    name: r.name,
    affinity: round(r.affinity, 3),
    image: meta[r.entity_id]?.image || r.properties?.image?.url || null,
    about: meta[r.entity_id]?.about || short(r.properties?.short_description, 140),
  }));
  const demo = env.interpretation?.demographic || null;
  const out = { culture_id, culture: c.name, demographic: demographic || null, resolved_demographic: demo, city, ranked };
  ctx.emit("data", { kind: "lineup", ...out, color: c.color });
  return { ...out, ranked: ranked.map((r) => ({ position: r.position, name: r.name, affinity: r.affinity, about: short(r.about, 110) })) };
}

// ------------------------------------------------------------- registry ---

export const TOOLS = {
  resolve_tastes: {
    fn: resolve_tastes,
    description:
      "Resolve the user's favourite things (artists, movies, TV shows, books, places, brands, games, podcasts) into Qloo entity IDs. Always call this first with everything the user said they love.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: ENTITY_TYPES },
            },
            required: ["name", "type"],
          },
        },
      },
      required: ["items"],
    },
  },
  find_concept_tags: {
    fn: find_concept_tags,
    description:
      "Search Qloo's tag ontology for an abstract taste the user mentioned (a mood, genre or style such as 'melancholic folk' or 'spicy food'). Returns tag URNs usable as signal_tags.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  find_culture_bridges: {
    fn: find_culture_bridges,
    description:
      "Core step. For each of FirstCiv's living cultures that Qloo can describe musically, ask Qloo which artists inside that culture's tradition have the highest affinity with the given taste signals, then rank cultures by that affinity. Returns the strongest bridges with artists and which signal pulled hardest.",
    parameters: {
      type: "object",
      properties: {
        entity_ids: { type: "array", items: { type: "string" }, description: "Optional. Defaults to every favourite resolved in this run." },
        signal_tags: { type: "array", items: { type: "string" }, description: "Optional tag URNs from find_concept_tags." },
        demographic: { type: "string", description: "Organizer mode only: audience in plain words, e.g. 'millennials', 'families', 'gen z'." },
        location: { type: "string", description: "City used with demographic, e.g. 'Ottawa, Canada'." },
        top_n: { type: "integer", minimum: 1, maximum: 6 },
      },
    },
  },
  culture_details: {
    fn: culture_details,
    description: "FirstCiv's consent-first record of one culture: region, language, living practice, and how to engage respectfully.",
    parameters: { type: "object", properties: { culture_id: { type: "string" } }, required: ["culture_id"] },
  },
  local_places: {
    fn: local_places,
    description: "Find places in a city where the nearest regional cuisine for a culture can be tasted (Qloo place data). Some cultures intentionally have none.",
    parameters: {
      type: "object",
      properties: { culture_id: { type: "string" }, city: { type: "string" } },
      required: ["culture_id", "city"],
    },
  },
  taste_map: {
    fn: taste_map,
    description: "Map the areas of a city where affinity for that culture's top bridge artist clusters (Qloo heatmap). Useful for choosing an event neighbourhood.",
    parameters: {
      type: "object",
      properties: { culture_id: { type: "string" }, city: { type: "string" } },
      required: ["culture_id", "city"],
    },
  },
  rank_for_audience: {
    fn: rank_for_audience,
    description: "Organizer mode: rank one culture's artists for a target audience (demographic + city and/or the audience's known favourites) to order a lineup or playlist.",
    parameters: {
      type: "object",
      properties: {
        culture_id: { type: "string" },
        demographic: { type: "string" },
        city: { type: "string" },
      },
      required: ["culture_id"],
    },
  },
};

export const toolSchemas = () =>
  Object.entries(TOOLS).map(([name, t]) => ({
    type: "function",
    function: { name, description: t.description, parameters: t.parameters },
  }));
