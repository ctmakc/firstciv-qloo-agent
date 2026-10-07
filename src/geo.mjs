// Reverse-geocode Qloo heatmap cells to human area names via OpenStreetMap
// Nominatim (public instance: ≤1 request/second, identified User-Agent, cached).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(process.env.QLOO_CACHE_DIR || join(ROOT, "data", "cache"), "geo.json");
mkdirSync(dirname(FILE), { recursive: true });
let cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
let last = 0;
let chain = Promise.resolve();

export function areaName(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (key in cache) return Promise.resolve(cache[key]);
  chain = chain.then(async () => {
    if (key in cache) return cache[key];
    const wait = Math.max(0, last + 1100 - Date.now());
    await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "FirstCiv-culture-agent/1.0 (hackathon demo; https://firstciv.com)" },
        signal: AbortSignal.timeout(6000),
      });
      const j = await res.json();
      const a = j.address || {};
      const name = a.neighbourhood || a.suburb || a.quarter || a.city_district || a.village || a.town || a.city || null;
      cache[key] = name;
      writeFileSync(FILE, JSON.stringify(cache));
      return name;
    } catch {
      return null;
    }
  });
  return chain;
}
