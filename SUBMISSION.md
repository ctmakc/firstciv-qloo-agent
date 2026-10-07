# Devpost submission — FirstCiv Culture Agent

> Paste-ready text for https://qloo.devpost.com. Sections follow the Devpost story template and the
> Qloo kit's `docs/SUBMISSION.md` checklist (problem, workflows used, request→result, screenshots,
> setup, limitations).

- **Project name:** FirstCiv Culture Agent
- **Tagline (≤200 chars):** An agent that starts from what you already love and uses Qloo's taste graph to build bridges to 22 living cultures: music, food, the part of town where the taste lives, and how to show up respectfully.
- **Demo (no login):** https://firstciv-agent.apps.mmix.biz
- **Code:** https://github.com/ctmakc/firstciv-qloo-agent (MIT)
- **Video:** not required by the rules ("Demo videos are not required").
- **Built with:** qloo-api, qloo-mcp, @qloo/qloo-harness, model-context-protocol, node.js, javascript, server-sent-events, ollama-cloud, gemma, gpt-oss, leaflet, openstreetmap, nominatim, docker, caddy, svg

## Inspiration

Living cultures lose their audience when nobody makes the first introduction. A Bon Iver fan has no idea that Sámi joik artists sit right next to their taste, and an
Ottawa festival organizer booking for millennials has no data on which living traditions their crowd would
actually stay for. Generic LLM answers make this worse: ask for "world music for a reggae fan" and you get
the same five famous names and a stereotype.

We run [FirstCiv](https://firstciv.com), a consent-first archive of 22 living cultures (Yoruba, Sámi, Inuit,
Tuvan, Māori, Diné and more). We wanted the archive to *reach people through what they already love*, with
evidence instead of guesses, and without turning anyone's heritage into a theme night.

## What it does

Two modes, one agent:

**For me.** Name a few favourites (artists, films, shows, books, games). The agent:
1. resolves them into Qloo entities (and says so when one is ambiguous),
2. asks Qloo, for each of 17 cultures that Qloo can honestly describe musically, which artists *inside that
   tradition* have the highest affinity with your favourites, and ranks the cultures,
3. explains which favourite pulled hardest toward each culture (Qloo's per-signal explainability),
4. finds food in your city from the nearest regional cuisine (labelled as regional),
5. maps where in the city the bridge artist's affinity clusters,
6. writes a short read in plain English, and links each culture's FirstCiv record and its own guidance on
   respectful engagement.

**For my event.** A community organizer gives the city, the audience age group and what that audience
already loves. The agent ranks cultures *for that audience* (demographic + location signals), orders a
lineup per culture with `qloo_rank`, finds food partners, suggests the part of town where the taste already
lives, and ends with a consent checklist.

The page shows the agent thinking: a "string figure" board stretches threads from your favourites to each
culture as Qloo answers, the strongest pull taut, and the Field notes panel lists every step and every Qloo
call with its endpoint, status, latency and cache hit.

## How we built it

- **Agent:** a tool-calling loop over an OpenAI-compatible endpoint (Ollama Cloud `gemma4:31b`, falling back
  to `gpt-oss:120b`). The model plans and writes; it never supplies facts. Seven tools wrap Qloo workflows.
  If the model fails, a deterministic planner runs the same tools so the demo never dead-ends.
- **Qloo:** the official `@qloo/qloo-harness` started as `qloo mcp` (stdio MCP server) inside our Node
  backend, called through the MCP SDK. Workflows used: `qloo_describe`, `qloo_find_tags`, `qloo_recommend`
  (artists and places, `include_tags`, `explain`), `qloo_rank` (demographic + location + audience signals) and
  `qloo_where_popular`.
- **Culture profiles:** we searched Qloo's tag ontology for every culture (`scripts/discover-tags.mjs`) and a
  human picked only tags that name the tradition itself. Ainu, Hmong, Maya, San and Yanomami have no such
  music tag in Qloo, so they appear as hollow pegs and the agent never invents a bridge for them. We also
  rejected tags that looked right but returned the wrong people (generic "marimba", "Mongolian barbecue").
- **Front end:** vanilla JS + SVG, streamed over Server-Sent Events; Leaflet + OpenStreetMap for the taste
  map; area names from OSM Nominatim (rate-limited, cached).
- **Ops:** Docker on our own VPS behind Caddy; the Qloo key lives only in the server process environment.
  Bounded retries with backoff on Qloo 429s, a 72-hour response cache, per-IP limits and a concurrency cap.

### Request → result, one example (redacted)

Input: `Bob Marley (artist) · Spirited Away (movie) · Bon Iver (artist)`, city `Ottawa, Canada`.

1. `qloo_describe {entity:"Bob Marley", type:"artist"}` → `GET /entities` → entity `A921B4A4-…`.
2. For each culture, e.g. Tuvan:
   `qloo_recommend {target_type:"artist", signals:[<3 resolved IDs>], include_tags:["urn:tag:genre:music:tuvan","urn:tag:genre:music:tuva"], explain:true, limit:4}`
   → `GET /v2/insights` with `filter.type=urn:entity:artist`, `signal.interests.entities=…`, `filter.tags=…`.
   The bridge score is the mean affinity of the top 3 artists; `explainability["signal.interests.entities"]`
   tells which favourite drove them.
3. Top bridges → `qloo_recommend {target_type:"place", include_tags:[<regional cuisine tag>], filter_location:"Ottawa, Canada"}`
   and `qloo_where_popular {entity:<bridge artist>, within:"Ottawa, Canada"}` → heatmap cells → OSM area names.
4. The model writes 120–220 words from those tool results only.

Entity/tag choices are visible on screen (tag scope per bridge, unresolved inputs in Field notes).

## Challenges we ran into

- **Honest tags.** Many regional genre tags pull in unrelated artists. We curated tags by hand, dropped the
  ones that failed, and print the tag scope on every bridge.
- **The model over-claims.** Early runs called pan-Indigenous artists "Diné" or invented a neighbourhood
  from coordinates. Fixes: tools return an `artist_caveat`, area names come only from reverse geocoding,
  and tools reuse resolved IDs so the model never copies UUIDs.
- **Quota and rate limits.** Scanning 17 cultures in parallel tripped 429s; we added a concurrency gate,
  exponential backoff and a disk cache.
- **Stale IDs in ranking.** One unknown option makes `qloo_rank` ask for input; the tool drops it and re-ranks.

## Accomplishments that we're proud of

- The answer changes with taste in a way an LLM alone cannot fake: Schitt's Creek fans land on
  Sámi joik-pop (Maxida Märak, Sofia Jannok); Tame Impala fans land on Tuareg desert blues (Mdou Moctar); the "why" names the favourite that pulled.
- It says "no" when the data is not good enough, and shows where it said no.
- Every claim on the page can be traced to a Qloo call or a FirstCiv record in the Field notes.

## What we learned

Qloo's cross-domain affinity is the part that matters: a film can pull you toward a music tradition. And for
heritage, the useful agent is the one that knows the limits of its data and hands people back to the
community's own voice.

## What's next for FirstCiv Culture Agent

- Put the bridges inside every FirstCiv culture page ("people who love X find this tradition").
- Organizer exports: a shareable plan with the community contacts FirstCiv stewards have approved.
- More Ottawa organizers testing the event mode with their real audiences; French interface.

## Responsible use (Qloo safe-use checklist)

- Only tastes go to Qloo; inputs with emails or phone numbers are rejected server-side.
- Results are phrased about groups ("people who love X also…"), never about the user.
- Regional cuisine is labelled as regional. No sacred or ceremonial material is suggested as entertainment.
- The key never reaches the browser, repo, logs or screenshots.

## Known limitations

- Affinity scores from separate Qloo calls are only roughly comparable; the ranking is a starting point.
- Some cultures have few Qloo artists (Inuit, Tuareg in event mode), and place data for small cuisines in
  mid-size cities is thin.
- The model's prose is constrained but not verified sentence by sentence; the structured rows are ground truth.
- A culture's score says nothing about the culture's value, and an affinity is not a prediction about anyone.

## Testing instructions (for judges)

Open https://firstciv-agent.apps.mmix.biz — no account needed. Click an example under "Try:" and press
**Find the bridges** (about 15–30 s on a cold start; the container sleeps when idle and wakes in a few
seconds). Switch to **For my event**, pick an audience, and press **Plan the event**. The Field notes panel
shows each Qloo call. Health: `/api/health`.

## Screenshots

`docs/screenshots/` — `start.png`, `explorer.png`, `explorer-full.png`, `organizer.png`,
`organizer-full.png`, `mobile.png`. None contains a credential or personal data.

## Project updated during the submission period?

Yes, entirely new code written during the submission period (October 2026). It reuses FirstCiv's existing
culture records as data; the agent, Qloo integration, UI and deployment are new.
