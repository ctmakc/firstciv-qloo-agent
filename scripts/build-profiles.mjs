// Step 2: merge FirstCiv culture data with the curated Qloo tags and fetch
// each culture's "anchor" artists from Qloo (the most representative artists
// inside that culture's music tags). Output: data/cultures.json (committed).
import { readFileSync, writeFileSync } from "node:fs";
import { qloo, closeQloo } from "../src/qloo.mjs";

const base = JSON.parse(readFileSync("data/cultures.base.json", "utf8"));
const tags = JSON.parse(readFileSync("data/culture-tags.json", "utf8"));

const out = [];
for (const c of base) {
  const t = tags[c.id] || {};
  const entry = { ...c, qloo: { ...t, anchors: [], built_at: new Date().toISOString().slice(0, 10) } };
  if (t.music?.length) {
    const env = await qloo("qloo_recommend", {
      target_type: "artist",
      signal_tags: t.music,
      signal_tags_operator: "union",
      include_tags: t.music,
      include_tags_operator: "union",
      limit: 8,
      explain: false,
    });
    entry.qloo.anchors = (env.results || []).map((r) => ({
      id: r.entity_id,
      name: r.name,
      image: r.properties?.image?.url || null,
      about: (r.properties?.short_description || r.properties?.description || "").slice(0, 220) || null,
    }));
    console.log(`${c.id.padEnd(11)} ${env.status} ${entry.qloo.anchors.map((a) => a.name).join(" · ")}`);
  } else {
    console.log(`${c.id.padEnd(11)} (no Qloo music tag — shown without a music bridge)`);
  }
  out.push(entry);
}
writeFileSync("data/cultures.json", JSON.stringify(out, null, 1) + "\n");
await closeQloo();
