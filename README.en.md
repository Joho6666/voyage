English | [中文](README.md)

# Voyage · Travel OS

> **Voyage is an AI-native Travel OS.**
> Not a guide generator, not a long-form Markdown machine, and not a bloated OTA sales platform.
> Its mission: **let a real person genuinely dare to take Voyage on an actual trip.**

The user types one simple wish:
> "3 days in Chongqing for 2 people from Guilin, budget ¥2,500, we love food and night views, and we don't want to walk too much every day."

Within seconds, Voyage produces a **real, structured trip project with live AMap (Gaode Maps) coordinates and road network, weather awareness, persistence, and full editability at any time**.

During the trip, you just say:
- "Tomorrow is too tiring" → long-distance climbs are reduced; walking legs automatically switch to taxi and light rail;
- "It's raining today" → a Rain Plan triggers: open-air walkways are smoothly replaced by the indoor Three Gorges Museum;
- "Save ¥100 today" → taxis intelligently fall back to the metro, and the dining mix is fine-tuned;
- "Push everything back an hour" → all nodes shift as a whole and each leg is recalibrated.

Every natural-language instruction is compiled into a Zod-validated structured `TravelAction`, which produces a quantified comparison report (`TripChangeSet`) shown in a Diff review modal — nothing is applied until you confirm.

---

## UI Preview

First, chat with the Agent to clarify your needs, then confirm to generate real routes; even after generation you can keep adjusting the itinerary.

### 1. Conversational Planning · A travel profile forms as you chat

<img src="docs/assets/screenshots/01-conversation-planning.png" alt="Conversational planning: chat on the left, route profile updating in real time on the right" width="880" />

### 2. Trip Workspace · Show only the day you're looking at

The left side shows only the selected day's itinerary, and the right-side map draws only that day's markers and routes; every route is labeled with its source (AMap live / estimated).

<img src="docs/assets/screenshots/02-trip-workspace.png" alt="Trip workspace: single-day-focused itinerary list and map" width="880" />

### 3. Today + AI Assistant · Make changes mid-trip

The top of the Today page gives you the "next stop" and one-tap navigation — no need to decipher a screenful of information; the assistant on the right can modify the itinerary per day, and only produces proposals that must be confirmed in the Diff before being written back.

<img src="docs/assets/screenshots/03-day-focus-assistant.png" alt="Next-stop card for the current day and the AI assistant panel" width="880" />

### 4. My Trips · All of your trip projects

<img src="docs/assets/screenshots/04-my-trips.png" alt="My Trips list" width="880" />

### 5. Data Source Settings · Keys stay server-side only

Only shows whether each capability "is configured" — never displays or receives key values, so credentials never leak into the browser.

<img src="docs/assets/screenshots/05-data-sources.png" alt="API and data source settings page, showing only configuration status" width="880" />

---

## Feature Highlights

- **Agent-led guidance + visible tool calls**: the top of the Today page proactively offers clickable next-step suggestions based on trip facts (upcoming rain, empty days, over budget, overly long walks, unchecked quotes, pre-trip to-dos); when the Agent answers, it automatically calls 15 real tools (AMap POI / routes / weather / social evidence / quotes), with call traces shown as badges in the reply card. The LLM can only generate proposals — applying them requires your confirmation in the Diff.
- **Multi-turn follow-ups**: AI adjustments on the Today page carry the last 8 turns of context — follow-ups like "a bit less of that" or "switch it to the afternoon" work directly.
- **One-tap guide import (Xiaohongshu / Douyin / WeChat)**: **paste a Xiaohongshu (RED) or Douyin (TikTok China) link directly into the planning dialog** (short links work too) — the body text is fetched, every place is verified one by one against AMap, stops are laid into each day in the original order of the post and drawn on the map, and a checklist is generated; you can also search viral Xiaohongshu notes on the Explore page or paste guide text from any platform. Check off a place and the corresponding task is crossed out automatically.
- **A single creation path**: say where you want to go in one sentence, the Agent asks for the missing dates and party size, and a real route is generated once you confirm; the profile panel can be filled manually at any time.
- **Explore page integration**: real-time discovery of food, lodging, and activities, plus a "saved" list, unified in category tabs on the Explore page; discovery results drop straight onto the map or into the itinerary.
- **Single-day focus**: whichever day you view is the only day whose list and routes are shown; "All" switches back to the full-trip view in one tap.
- **Complete mobile navigation**: bottom navigation "Itinerary / Today / Map / More", with the share button visible on mobile; non-trip pages (My Trips / Settings) get a global bottom bar.
- **Planning sessions survive refresh**: the session ID is persisted locally and the conversation is saved server-side; returning to the planning page lets you "continue your last session", and dead sessions are honestly reported and cleaned up.
- **Operational hardening**: paid APIs (AMap / TikHub / LLM / Fliggy / planning) are rate-limited per caller with a sliding window, returning 429 + Retry-After when exceeded (single-instance in-memory implementation); structured JSON server-side logging covers degradation and failure paths; guest workspaces are auto-cleaned on a TTL basis (default 30 days, adjustable via `VOYAGE_GUEST_TTL_DAYS`, `0` disables it).

---

## The Four Pillars

| Pillar | Role | Core Capability |
|---|---|---|
| **1. Plan** | Trip planning & timeline generation | Aggregates real POIs for the destination, clusters them geographically, and automatically lays out meals, visit durations, and budget distribution. |
| **2. Explore** | Real exploration & place discovery | Live AMap POI search with precise tag filters like "indoor, night views, free, less walking" — no fake ratings, no empty prices. |
| **3. Adapt** | Dynamic adaptation & diff review | A global Command Bar (`Cmd+K`) is available at any time; before applying changes it quantifies walking reduction, transport swaps, and cost deltas, with 10-step undo whenever you need it. |
| **4. Travel** | On-the-ground execution console (Today) | Mobile-first, one-handed operation: locks onto the next stop in real time, departure and arrival countdowns, and hands off to the real AMap app for navigation. |

---

## Architecture

```
UI Components (Next.js 15 App Router · React 19 · Tailwind v4 · Radix UI · Motion · dnd-kit)
      ↓
State & Control Layer (Zustand: useTripStore · useUiStore · useHistoryStore · CommandBar)
      ↓
AI Action & Diff Engine (TravelAction 3.0 · ActionPlanner · ActionExecutor · TripDiffModal)
      ↓
Travel Intelligence (Route Matrix · Transport Scoring · RAG Planning Context)
      ↓
Knowledge Engine (Hybrid Keyword + pgvector · Freshness · Confidence · Provenance)
      ↓
Service Facades & Routing Engine (RoutingService · WeatherContext · BookingIntent)
      ↓
Server Boundary (API Routes with 'server-only' secrets isolation)
  ├── AMap REST (POI Search, Geocoding, Walking/Driving/Transit Directions, Polylines)
  ├── OpenAI-compatible LLM (Chat Completions: Qwen, DeepSeek, GPT-4o)
  └── Supabase (Secure RLS bound to auth.uid() + In-Memory Fallback)
```

---

## Quick Start

```bash
cd voyage
npm install
npm run dev
```

Open [http://localhost:3002](http://localhost:3002) in your browser.

### Verification Commands
```bash
npm run lint         # ESLint checks (0 errors, 0 warnings)
npm run typecheck    # TypeScript strict type checking (0 errors)
npm test             # Vitest unit & integration tests (221 tests passed)
npm run build        # Production Turbopack build
npm run test:e2e     # Playwright end-to-end suite (25 specs, incl. mobile navigation and session restore)
```

---

## Environment Variables (`.env.local`)

| Variable | Description | Fallback Behavior |
|---|---|---|
| `NEXT_PUBLIC_AMAP_KEY` | AMap JS API key (web client) | Degrades to an SVG vector-projected base map when unset |
| `NEXT_PUBLIC_AMAP_SECURITY_CODE` | AMap JS API security code | Used together with the JS key |
| `AMAP_SERVER_KEY` | AMap Web-service server-side REST key | Falls back to a curated real-place library with Haversine estimates when unset |
| `LLM_BASE_URL` | OpenAI-compatible LLM API root URL (e.g. Volcano Ark / DeepSeek) | Switches to a rule engine when unset |
| `LLM_API_KEY` | Server-side model API key | Kept server-side, never exposed to the browser |
| `LLM_MODEL` | Model name (e.g. `deepseek-v3`, `gpt-4o-mini`) | Defaults to `gpt-4o-mini` |
| `EMBEDDING_BASE_URL` | OpenAI-compatible Embeddings API root URL | RAG degrades to keyword/local knowledge retrieval when unset |
| `EMBEDDING_API_KEY` | Embedding API key | Server-side only |
| `EMBEDDING_MODEL` | 1536-dim embedding model | Semantic vector retrieval is skipped when unset |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Runs seamlessly in in-memory demo mode when unset |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client anon key | Strictly governed by row-level security in `0002_rls_secure.sql` |
| `TIKHUB_API_KEY` | TikHub social retrieval (Xiaohongshu / Douyin / Weibo / WeChat Search) | Social evidence honestly shows as unavailable when unset |
| `VOYAGE_GUEST_TTL_DAYS` | Guest workspace TTL in days | Defaults to `30`; set `0` to disable auto-cleanup |

---

## Documentation Index

- [`docs/GOLDEN_TRIP.md`](docs/GOLDEN_TRIP.md) — Guilin ↔ Chongqing 3-day/2-night golden acceptance baseline
- [`docs/PHASE3_AUDIT.md`](docs/PHASE3_AUDIT.md) — In-depth 15-dimension codebase audit report
- [`docs/PHASE3_IMPLEMENTATION_PLAN.md`](docs/PHASE3_IMPLEMENTATION_PLAN.md) — Detailed Phase 3 execution plan
- [`docs/REAL_WORLD_PROVIDER_GUIDE.md`](docs/REAL_WORLD_PROVIDER_GUIDE.md) — Guide to integrating AMap / weather / booking / Supabase
- [`docs/TRAVEL_ACTIONS.md`](docs/TRAVEL_ACTIONS.md) — Specs for all 24 TravelActions and how the Diff preview works
- [`docs/BETA_ACCEPTANCE.md`](docs/BETA_ACCEPTANCE.md) — 18-scenario beta user-path acceptance report
- [`knowledge/README.md`](knowledge/README.md) — Travel Knowledge RAG data format, ingestion, and retrieval

---

## Contact

If you run into problems, have suggestions, or just want to chat about this project, feel free to reach out on WeChat:

<img src="docs/assets/wechat-joho.jpg" alt="Author's WeChat QR code" width="280" />

> You can also leave a message in GitHub Issues. The personal WeChat QR code is rotated periodically — if it stops working, please open an Issue first.

---

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Released under the [MIT License](LICENSE).
