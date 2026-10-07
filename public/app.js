// FirstCiv Culture Agent — front end. Talks only to our own server (/api/*);
// the Qloo key never reaches the browser.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const NS = "http://www.w3.org/2000/svg";
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

const EXAMPLES = [
  { mode: "explorer", tastes: [["Bob Marley", "artist"], ["Spirited Away", "movie"], ["Bon Iver", "artist"]] },
  { mode: "explorer", tastes: [["Billie Eilish", "artist"], ["Dune: Part Two", "movie"], ["The Legend of Zelda: Breath of the Wild", "videogame"]] },
  { mode: "organizer", tastes: [["Arkells", "artist"], ["Schitt's Creek", "tv_show"], ["Hozier", "artist"]], demographic: "millennials" },
];
const TYPE_LABEL = { artist: "artist", movie: "film", tv_show: "TV show", book: "book", place: "place", videogame: "game", podcast: "podcast", brand: "brand" };

let mode = "explorer";
let cultures = [];
let state = null;

// ------------------------------------------------------------------ form ---
const list = $("#taste-list");
function addTaste(name = "", type = "artist") {
  if (list.children.length >= 6) return;
  const li = $("#tpl-taste").content.firstElementChild.cloneNode(true);
  $("input", li).value = name;
  $("select", li).value = type;
  $(".x", li).onclick = () => {
    if (list.children.length > 1) li.remove();
    else $("input", li).value = "";
  };
  list.append(li);
  return li;
}
function loadExample(i) {
  const ex = EXAMPLES[i];
  setMode(ex.mode);
  list.innerHTML = "";
  ex.tastes.forEach(([n, t]) => addTaste(n, t));
  if (ex.demographic) $("select[name=demographic]").value = ex.demographic;
  drawFavourites(readTastes());
}
$$(".chip[data-example]").forEach((b, i) => {
  b.textContent = EXAMPLES[i].tastes.map((t) => t[0].replace(/:.*/, "")).join(" · ");
  b.onclick = () => loadExample(i);
});
$("#add-taste").onclick = () => $("input", addTaste())?.focus();
list.addEventListener("input", () => drawFavourites(readTastes()));
EXAMPLES[0].tastes.forEach(([n, t]) => addTaste(n, t));

function readTastes() {
  return $$(".taste", list)
    .map((li) => ({ name: $("input", li).value.trim(), type: $("select", li).value }))
    .filter((t) => t.name);
}

function setMode(m) {
  mode = m;
  $$(".modes button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
  $$("[data-mode-text]").forEach((el) => (el.hidden = el.dataset.modeText !== m));
  $(".go span").textContent = m === "organizer" ? "Plan the event" : "Find the bridges";
}
$$(".modes button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

// ----------------------------------------------------------------- board ---
const svg = $("#figure");
const W = 800, H = 520, FX = 300, CX = 580;
let favPos = {}; // name -> y
let culturePos = {}; // id -> y
const threads = new Map(); // key -> path

function el(tag, attrs = {}, parent = svg) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent.append(n);
  return n;
}

function drawBoard() {
  svg.innerHTML = "";
  threads.clear();
  el("g", { id: "g-threads" });
  el("line", { x1: CX, y1: 14, x2: CX, y2: H - 14, class: "loom" });
  el("line", { x1: FX, y1: 14, x2: FX, y2: H - 14, class: "loom" });
  const gC = el("g", { id: "g-cultures" });
  const step = (H - 40) / Math.max(cultures.length - 1, 1);
  cultures.forEach((c, i) => {
    const y = 20 + i * step;
    culturePos[c.id] = y;
    const g = el("g", { class: "peg", "data-id": c.id }, gC);
    const hollow = !c.has_music_bridge;
    el("circle", { cx: CX, cy: y, r: 5, fill: hollow ? "none" : c.color, stroke: c.color, "stroke-width": 1.5 }, g);
    const t = el("text", { x: CX + 14, y: y + 4 }, g);
    t.textContent = c.name.replace(/ \(.*\)/, "") + (hollow ? " ·" : "");
    if (hollow) t.setAttribute("fill-opacity", ".55");
    const title = el("title", {}, g);
    title.textContent = hollow
      ? `${c.name}: Qloo has no music tag that honestly names this tradition, so no bridge is drawn.`
      : `${c.name} — ${c.region}`;
  });
  el("g", { id: "g-favs" });
  drawFavourites(readTastes());
}

function drawFavourites(tastes) {
  const g = $("#g-favs", svg);
  if (!g) return;
  g.innerHTML = "";
  favPos = {};
  const n = Math.max(tastes.length, 1);
  const span = Math.min(320, 70 * n);
  tastes.forEach((t, i) => {
    const y = H / 2 - span / 2 + (n === 1 ? span / 2 : (i * span) / (n - 1));
    favPos[t.name.toLowerCase()] = y;
    const f = el("g", { class: "fav" }, g);
    el("circle", { cx: FX, cy: y, r: 7, fill: "var(--ink)" }, f);
    const label = el("text", { x: FX - 16, y: y + 1, "text-anchor": "end" }, f);
    const max = innerWidth < 520 ? 17 : 26;
    label.textContent = t.name.length > max ? t.name.slice(0, max - 1).trimEnd() + "…" : t.name;
    const sub = el("text", { x: FX - 16, y: y + 16, "text-anchor": "end", class: "sub" }, f);
    sub.textContent = TYPE_LABEL[t.type] || t.type;
  });
}

function threadPath(y1, y2, slack) {
  const mx = (FX + CX) / 2;
  const sag = slack * (40 + Math.abs(y2 - y1) * 0.15);
  return `M${FX},${y1} C${mx - 60},${y1 + sag} ${mx + 60},${y2 + sag} ${CX},${y2}`;
}

function setThread(fav, cid, { slack = 1, width = 1, cls = "" } = {}) {
  const y1 = favPos[fav], y2 = culturePos[cid];
  if (y1 == null || y2 == null) return;
  const key = fav + "|" + cid;
  let p = threads.get(key);
  const d = threadPath(y1, y2, slack);
  if (!p) {
    p = el("path", { d, class: "thread " + cls, "stroke-width": width }, $("#g-threads", svg));
    threads.set(key, p);
    if (!reduce) {
      const len = p.getTotalLength();
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      p.getBoundingClientRect();
      p.style.transition = "stroke-dashoffset .9s cubic-bezier(.16,1,.3,1), stroke .5s, stroke-width .5s, opacity .4s";
      p.style.strokeDashoffset = 0;
      setTimeout(() => (p.style.strokeDasharray = "none"), 950);
    }
  } else {
    if (!reduce) {
      // tension: overshoot past taut, then settle
      p.setAttribute("d", threadPath(y1, y2, -0.25));
      setTimeout(() => p.setAttribute("d", d), 180);
    } else p.setAttribute("d", d);
    p.setAttribute("class", "thread " + cls);
    p.setAttribute("stroke-width", width);
  }
  p.style.transition ||= "d .45s cubic-bezier(.34,1.3,.64,1), stroke .5s, stroke-width .5s, opacity .4s";
  return p;
}

function pegState(id, cls) {
  const g = $(`.peg[data-id="${id}"]`, svg);
  if (!g) return;
  g.classList.add(cls);
  if (cls === "scan") setTimeout(() => g.classList.remove("scan"), 700);
}

// ------------------------------------------------------------------- log ---
const log = $("#log");
let qCalls = 0, qCached = 0;
function logLine(kind, glyph, text, right = "") {
  $(".idle", log)?.remove();
  const li = document.createElement("li");
  li.className = kind;
  li.innerHTML = `<span class="g">${glyph}</span><span>${text}</span><span class="ep">${right}</span>`;
  log.append(li);
  log.scrollTop = log.scrollHeight;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const TOOL_TEXT = {
  resolve_tastes: "Resolve favourites into Qloo entities",
  find_concept_tags: "Look up concept tags",
  find_culture_bridges: "Scan every culture for taste bridges",
  culture_details: "Read the FirstCiv record",
  local_places: "Find food nearby",
  taste_map: "Map where the taste clusters",
  rank_for_audience: "Rank a lineup for the audience",
};

// --------------------------------------------------------------- results ---
const bridgesEl = $("#bridges");
function renderBridges(data) {
  bridgesEl.innerHTML = "";
  data.bridges.forEach((b, i) => {
    const c = b.culture;
    const li = document.createElement("li");
    li.className = "bridge";
    li.dataset.id = c.id;
    li.style.animationDelay = reduce ? "0s" : `${0.15 + i * 0.14}s`;
    const drivers = b.drivers.filter((d) => d.weight > 0);
    const why = drivers.length
      ? `People who love <b>${esc(drivers[0].name)}</b>${drivers[1] ? ` (and, less strongly, ${esc(drivers[1].name)})` : ""} also gravitate toward these ${esc(c.name.replace(/ \(.*\)/, ""))} artists.`
      : "Qloo found affinity between your favourites and these artists.";
    const scope = c.music_scope && c.music_scope !== "culture" ? ` · tag scope: ${esc(c.music_scope)}` : "";
    li.innerHTML = `
      <div class="idx">${String(i + 1).padStart(2, "0")}</div>
      <div>
        <h3><span class="swatch" style="background:${esc(c.color)}"></span>${esc(c.name)}</h3>
        <div class="meta"><span>${esc(c.region)}</span><span>${esc(c.language)}</span></div>
        <div class="score"><span class="bar"><i style="width:${Math.round(b.score * 100)}%"></i></span><span>affinity ${b.score.toFixed(2)} · avg of top 3${scope}</span></div>
        <p class="why">${why}</p>
        <div class="cols">
          <div><h4>Start listening</h4><ul class="artists">${b.artists
            .slice(0, 4)
            .map(
              (a) => `<li class="artist">${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ph"></span>`}<div><div class="n">${esc(a.name)}</div><div class="a">${esc(a.about || "affinity " + a.affinity)}</div></div></li>`
            )
            .join("")}</ul></div>
          <div class="slot-side"><h4>${mode === "organizer" ? "Lineup for this audience" : "Taste it nearby"}</h4><p class="empty">Waiting for the agent…</p></div>
        </div>
        <div class="respect"><span><b>Living practice:</b> ${esc(c.practice)}.</span><span><b>Show up respectfully:</b> ${esc(c.respect)}</span><a href="${esc(c.firstciv_url)}" target="_blank" rel="noopener">Read the ${esc(c.name.replace(/ \(.*\)/, ""))} record on FirstCiv →</a></div>
        <div class="slot-food"></div>
      </div>`;
    li.addEventListener("mouseenter", () => highlight(c.id, true));
    li.addEventListener("mouseleave", () => highlight(c.id, false));
    bridgesEl.append(li);
  });
}

function highlight(id, on) {
  threads.forEach((p, key) => {
    if (key.endsWith("|" + id)) p.classList.toggle("hot", on);
  });
}

function renderPlaces(d) {
  const row = $(`.bridge[data-id="${d.culture_id}"]`);
  if (!row) return;
  const target = mode === "organizer" ? $(".slot-food", row) : $(".slot-side", row);
  const head = mode === "organizer" ? `<h4 style="margin-top:1rem">Food partners · ${esc(d.label || "none")}</h4>` : `<h4>Taste it nearby${d.label ? ` · ${esc(d.label)}` : ""}</h4>`;
  let body;
  if (!d.label) body = `<p class="empty">No honest cuisine match in Qloo for this culture, so none is suggested.</p>`;
  else if (!d.places.length) body = `<p class="empty">Qloo lists no ${esc(d.label)} places in ${esc(d.city)} yet.</p>`;
  else
    body = `<ul class="places">${d.places
      .slice(0, 4)
      .map((p) => `<li><div class="n">${esc(p.name)}</div><div class="a">${esc(p.address || "")}${p.rating ? ` · ${p.rating}★` : ""}</div></li>`)
      .join("")}</ul><p class="fine">Regional cuisine, labelled as such.</p>`;
  target.innerHTML = head + body;
}

function renderLineup(d) {
  const row = $(`.bridge[data-id="${d.culture_id}"]`);
  if (!row) return;
  const side = $(".slot-side", row);
  const demo = d.resolved_demographic ? Object.entries(d.resolved_demographic).filter(([k]) => k !== "input").map(([k, v]) => `${k} ${v}`).join(", ") : "";
  side.innerHTML = `<h4>Lineup for ${esc(d.demographic || "this audience")}</h4>${
    d.ranked.length
      ? `<ol class="lineup">${d.ranked
          .slice(0, 5)
          .map((r) => `<li><span class="pos">${r.position}</span>${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ph"></span>`}<span>${esc(r.name)}</span><span class="aff">${r.affinity ?? ""}</span></li>`)
          .join("")}</ol><p class="fine">Ranked by Qloo for ${esc(d.city)}${demo ? ` (${esc(demo.replace(/_/g, " "))})` : ""}. A playlist order, not a booking list.</p>`
      : `<p class="empty">Qloo could not rank these artists for this audience.</p>`
  }`;
}

let map;
function renderMap(d) {
  if (!window.L || !d.cells.length) return;
  $("#mapwrap").hidden = false;
  $("#map-h").textContent = `Where ${d.artist} listeners cluster in ${d.city.split(",")[0]}`;
  if (!map) {
    map = L.map("map", { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 16,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  }
  map.eachLayer((l) => l instanceof L.CircleMarker && map.removeLayer(l));
  const pts = d.cells.map((c) => [c.lat, c.lon]);
  d.cells.forEach((c, i) => {
    L.circleMarker([c.lat, c.lon], {
      radius: 6 + (d.cells.length - i) * 0.9,
      color: "#e5577c",
      weight: i < 3 ? 2 : 1,
      fillColor: d.color || "#e5577c",
      fillOpacity: i < 3 ? 0.55 : 0.25,
    })
      .bindTooltip(`${c.area ? c.area + " · " : ""}relative rank ${c.rank}`)
      .addTo(map);
  });
  map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
  const named = d.cells.filter((c) => c.area).slice(0, 3).map((c) => c.area);
  $("#map-cap").textContent = `Qloo heatmap cells for ${d.artist} (${d.culture} bridge)${named.length ? `; strongest areas: ${named.join(", ")}` : ""}. Areas describe aggregate affinity, not people. Area names: OpenStreetMap.`;
}

function renderAnswer(text, by) {
  const blocks = esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").split(/\n{2,}/);
  $("#answer-text").innerHTML = blocks.map((b) => `<p>${b.replace(/\n/g, "<br>")}</p>`).join("");
  $("#answer-by").textContent = `Written by ${by} from the tool results above. Qloo data · FirstCiv records.`;
  $("#answer").hidden = false;
}

// ------------------------------------------------------------------- run ---
async function run(e) {
  e.preventDefault();
  const tastes = readTastes();
  if (!tastes.length) return $("input", list)?.focus();
  const fd = new FormData($("#ask"));
  const body = { mode, tastes, city: fd.get("city"), demographic: mode === "organizer" ? fd.get("demographic") : null, note: mode === "organizer" ? fd.get("note") : null };
  const btn = $(".go");
  btn.disabled = true;
  log.innerHTML = "";
  qCalls = qCached = 0;
  $("#notes-meta").textContent = "";
  bridgesEl.innerHTML = "";
  $("#answer").hidden = true;
  $("#mapwrap").hidden = true;
  $("#more").hidden = true;
  drawBoard();
  $("#board-cap").textContent = "Scanning…";
  state = { started: performance.now() };
  if (innerWidth < 960) $("#board").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  try {
    const res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      logLine("notice", "!", esc(j.error || `Server said ${res.status}`));
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.+)$/m.exec(chunk)?.[1];
        if (ev && data) handle(ev, JSON.parse(data));
      }
    }
  } catch (err) {
    logLine("notice", "!", "Connection dropped. Please try again.");
  } finally {
    btn.disabled = false;
  }
}
$("#ask").addEventListener("submit", run);

function handle(ev, d) {
  if (ev === "step") logLine("step", "→", esc(TOOL_TEXT[d.tool] || d.tool), esc(d.tool));
  else if (ev === "qloo") {
    qCalls++;
    if (d.cache) qCached++;
    const ok = ["ok", "empty", "partial"].includes(d.status);
    logLine("q", "·", `${esc(d.label)} <span class="${ok ? "" : "bad"}">${esc(d.status)}</span>`, `${esc(d.endpoint || d.tool)} ${d.cache ? "cache" : d.ms + "ms"}`);
    $("#notes-meta").textContent = `${qCalls} Qloo calls · ${qCached} cached`;
  } else if (ev === "notice") logLine("notice", "!", esc(d.text));
  else if (ev === "message") renderAnswer(d.text, d.by);
  else if (ev === "error") logLine("notice", "!", esc(d.text));
  else if (ev === "done") {
    const s = ((performance.now() - state.started) / 1000).toFixed(1);
    $$(".slot-side .empty, .slot-food .empty").forEach((p) => {
      if (p.textContent.startsWith("Waiting")) p.textContent = mode === "organizer" ? "The agent ranked the top three bridges only." : "The agent looked up food for the strongest bridges only.";
    });
    logLine("step", "✓", `Done in ${s}s${d.fallback ? " (deterministic planner finished the plan)" : ` · planned by ${esc(d.model)}`}`);
  } else if (ev === "data") onData(d);
}

function onData(d) {
  if (d.kind === "tastes") {
    const names = d.resolved.map((r) => ({ name: r.input, type: r.type }));
    // keep labels as typed, but show what Qloo resolved in the log
    d.resolved.forEach((r) => logLine("q", "=", `${esc(r.input)} → <b>${esc(r.name)}</b>`, esc(r.type)));
    d.unresolved.forEach((u) => logLine("notice", "?", `Qloo could not pin down “${esc(u.input)}”${u.candidates.length ? ` (maybe ${u.candidates.map((c) => esc(c.name + " " + (c.type || ""))).join(", ")})` : ""}`));
    state.resolved = d.resolved;
    drawFavourites(names.length ? names : readTastes());
  } else if (d.kind === "bridge-scan") {
    pegState(d.id, "scan");
    pegState(d.id, "lit");
    const favs = Object.keys(favPos);
    favs.forEach((f) => setThread(f, d.id, { slack: 1, width: 0.8, cls: "" }));
  } else if (d.kind === "bridges") {
    const winners = new Set(d.bridges.map((b) => b.culture.id));
    threads.forEach((p, key) => {
      if (!winners.has(key.split("|")[1])) p.setAttribute("class", "thread dim");
    });
    const idName = Object.fromEntries((state.resolved || []).map((r) => [r.id, r.input.toLowerCase()]));
    d.bridges.forEach((b) => {
      pegState(b.culture.id, "win");
      const drivers = b.drivers.length ? b.drivers : Object.keys(favPos).map((f) => ({ id: null, name: f, weight: 0.3 }));
      Object.keys(favPos).forEach((f) => {
        const dr = drivers.find((x) => idName[x.id] === f || x.name?.toLowerCase() === f);
        const w = dr ? dr.weight : 0;
        const max = Math.max(...drivers.map((x) => x.weight || 0), 0.001);
        // Only the favourites that really pulled get a taut cochineal thread.
        if (w > 0.05 && w >= max - 1e-9) setThread(f, b.culture.id, { slack: 0, width: 1.5 + (w / max) * 2.5, cls: "win" });
        else setThread(f, b.culture.id, { slack: 0.6, width: 0.8, cls: "dim" });
      });
    });
    $("#board-cap").textContent = `Taut threads: Qloo's strongest affinities from your favourites into ${d.bridges.length} cultures (thickness = how hard each favourite pulled). Hollow pegs have no honest Qloo music tag.`;
    renderBridges(d);
    if (d.others?.length) {
      $("#more").hidden = false;
      $("#more").innerHTML = `<b>Also scanned:</b> ${d.others.map((o) => `${esc(o.name)} ${o.score.toFixed(2)}`).join(" · ")}. <b>Not scored</b> (no Qloo music tag that honestly names the tradition): ${d.no_signal.map((o) => esc(o.name)).join(", ")}.`;
    }
  } else if (d.kind === "places") renderPlaces(d);
  else if (d.kind === "lineup") renderLineup(d);
  else if (d.kind === "map") renderMap(d);
  else if (d.kind === "concept") logLine("q", "#", `Tags for “${esc(d.query)}”: ${d.tags.slice(0, 3).map((t) => esc(t.name)).join(", ")}`);
}

// Qloo image URLs occasionally 404: swap a broken thumbnail for the cloth placeholder.
document.addEventListener("error", (e) => {
  const t = e.target;
  if (t.tagName === "IMG" && !t.dataset.dead) {
    t.dataset.dead = 1;
    const ph = document.createElement("span");
    ph.className = "ph";
    t.replaceWith(ph);
  }
}, true);

// ----------------------------------------------------------------- boot ---
fetch("/api/cultures")
  .then((r) => r.json())
  .then((c) => {
    cultures = c;
    drawBoard();
  });
