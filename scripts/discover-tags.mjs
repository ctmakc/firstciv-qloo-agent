// Step 1 of building culture profiles: search Qloo's tag ontology for each
// culture's music and food concepts and print the candidates, so a human can
// pick the tags that really mean that culture (see data/culture-tags.json).
// Usage: node scripts/discover-tags.mjs [cultureId ...]
import { qloo, closeQloo } from "../src/qloo.mjs";
import { QUERIES } from "./tag-queries.mjs";

const ids = process.argv.slice(2);
for (const [id, q] of Object.entries(QUERIES)) {
  if (ids.length && !ids.includes(id)) continue;
  console.log(`\n### ${id}`);
  for (const query of [...q.music, ...q.food]) {
    const env = await qloo("qloo_find_tags", { query, limit: 6 });
    const rows = (env.results || []).map((t) => `${t.id} (${t.name})`);
    console.log(`  "${query}" -> ${env.status}\n     ${rows.join("\n     ")}`);
  }
}
await closeQloo();
