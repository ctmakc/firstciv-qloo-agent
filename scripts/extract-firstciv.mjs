// Extract the 22 living cultures from a local FirstCiv checkout into data/cultures.base.json.
// Usage: node scripts/extract-firstciv.mjs /path/to/firstciv-next/lib/data.js
// Only descriptive, community-facing fields are kept. Archive statistics, contributor
// handles and media items are dropped on purpose: this agent never shows invented numbers.
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/extract-firstciv.mjs <firstciv-next/lib/data.js>");
  process.exit(1);
}
const tmp = join(mkdtempSync(join(tmpdir(), "fc-")), "data.mjs");
copyFileSync(src, tmp);
const D = await import(tmp);

const dropTokenTalk = (text = "") =>
  text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/tablet|\$LORE|mint/i.test(s))
    .join(" ")
    .trim();

const out = D.CULTURES.map((c) => {
  const page = D.PAGES[c.id] || {};
  const support = (page.faq || []).find((f) => /support|respect|help/i.test(f.q));
  return {
    id: c.id,
    name: c.name,
    epithet: page.sub || null,
    region: c.region,
    lon: c.lon,
    lat: c.lat,
    language: c.language,
    vitality: c.vitality,
    practice: c.practice,
    expressions: c.cats,
    color: c.color,
    blurb: c.blurb,
    intro: dropTokenTalk(page.intro || ""),
    respect: support ? dropTokenTalk(support.a) : null,
    firstciv_url: `https://firstciv.com/c/${c.id}`,
  };
});
writeFileSync("data/cultures.base.json", JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.length} cultures to data/cultures.base.json`);
