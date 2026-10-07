// Run one agent turn from the terminal and print the event stream.
// Usage: node --env-file=.env scripts/cli.mjs explorer "Bob Marley:artist" "Spirited Away:movie"
//        node --env-file=.env scripts/cli.mjs organizer "Arkells:artist" --demographic "millennials"
import { runAgent } from "../src/agent.mjs";
import { closeQloo } from "../src/qloo.mjs";

const argv = process.argv.slice(2);
const mode = argv.shift() || "explorer";
const opt = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv.splice(i, 2)[1] : null;
};
const demographic = opt("--demographic");
const city = opt("--city") || "Ottawa, Canada";
const tastes = argv.map((s) => {
  const [name, type = "artist"] = s.split(":");
  return { name, type };
});
const t0 = Date.now();
await runAgent({ mode, tastes, city, demographic }, (type, data) => {
  if (type === "qloo") console.log(`  [qloo] ${data.label} ${data.status} ${data.cache ? "(cache)" : data.ms + "ms"} ${data.endpoint || ""}`);
  else if (type === "data") console.log(`  [data] ${data.kind}${data.kind === "bridges" ? " " + data.bridges.map((b) => b.culture.name + ":" + b.score).join(", ") : ""}`);
  else if (type === "step") console.log(`[step] ${data.tool} ${JSON.stringify(data.args).slice(0, 160)}`);
  else if (type === "message") console.log(`\n=== ${data.by}\n${data.text}\n`);
  else if (type !== "thinking") console.log(`[${type}] ${JSON.stringify(data).slice(0, 200)}`);
});
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await closeQloo();
