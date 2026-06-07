# CLAUDE.md — Nordic JobMatch AI

## 0. Session Start Checklist

- Read this file fully before touching the codebase.
- Check `package.json` for current scripts and dependency versions (this file may lag behind).
- Confirm the dev server runs cleanly (`npm run dev`) before making changes.
- When in doubt about a pattern, follow existing code rather than introducing a new approach.
- Do not assume — if context is missing, ask or check the relevant file.
- Never use `any` — strict TypeScript is enforced project-wide (`noUncheckedIndexedAccess: true`).

---

## 1. Project Overview

Nordic JobMatch AI is a cross-border job-matching web application serving the Nordic labor market (Sweden, Norway, Denmark, Finland). It aggregates job postings from national APIs, parses applicant CVs with Gemini AI, generates 768-dimensional vector embeddings, and performs semantic cosine-similarity matching to connect job seekers with cross-border opportunities. Multilingual support (sv, no, da, fi, en) is a core architectural concern, not an afterthought.

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router, Turbopack) | 16.2.6 |
| Language | TypeScript (strict mode) | 5.8.3 |
| UI Library | React (Server Components first) | 19.1 |
| Styling | Tailwind CSS (CSS-first config, v4) | 4.1.7 |
| Database | Supabase (PostgreSQL + pgvector) | eu-north-1 |
| Auth | Supabase Auth via @supabase/ssr | 0.6.1 |
| AI — Parsing/Chat | Gemini API (@google/generative-ai) | 0.24.0 |
| AI — Embeddings | Gemini text-embedding-004 (768-d) | — |
| Validation | Zod + zod-to-json-schema | 3.24.4 |
| Deployment | Vercel | not yet configured |
| Package manager | npm | 11.6.2 |
| Runtime | Node.js | 24.11.1 |

---

## 3. Project Structure

```
nordic-jobmatch-ai/
├── .env.local.example           # Required env vars template (4 keys)
├── next.config.ts               # Security headers, server-external packages
├── postcss.config.mjs           # Tailwind v4 via @tailwindcss/postcss
├── tsconfig.json                # Strict mode, @/* → ./src/* alias
├── package.json                 # Scripts, deps
│
├── supabase/
│   └── migrations/
│       ├── 00001_initial_schema.sql   # 4 tables, 4 enums, HNSW indexes, RLS, match_jobs RPC
│       └── 00002_upsert_cv_profile_rpc.sql  # Atomic upsert RPC for cv_profiles
│                                      # BOTH ALREADY APPLIED to live Supabase project
│
└── src/
    ├── middleware.ts                   # Root middleware: Supabase auth session refresh
    │
    ├── app/
    │   ├── actions/
    │   │   └── cv-actions.ts          # Server Action: uploadAndProcessCv() pipeline
    │   ├── globals.css                # Tailwind v4 @theme design tokens (aurora palette)
    │   ├── layout.tsx                 # Root layout: SEO metadata, Google Fonts (Inter)
    │   └── page.tsx                   # Placeholder landing page (Server Component)
    │
    └── lib/
        ├── database.types.ts          # Auto-generated from Supabase (DO NOT EDIT)
        │
        ├── supabase/
        │   ├── client.ts              # Browser client (anon key, RLS-aware)
        │   ├── server.ts              # createServerClient() + createServiceClient()
        │   └── middleware.ts          # updateSession() — cookie-based session refresh
        │
        ├── harvesters/
        │   ├── sweden-harvester.ts    # JobTech Dev API: fetch → map → embed → store
        │   └── norway-harvester.ts    # NAV stilling-feed: auth → feed traverse → detail → map → embed → store
        │
        └── ai/
            ├── cv-parser/
            │   ├── index.ts           # Barrel export
            │   ├── schema.ts          # Zod schema: CvStructuredData (42 fields, 16 cert categories)
            │   ├── prompt.ts          # Gemini system prompt + user prompt builder
            │   └── parser.ts          # parseCv(Buffer) multimodal PDF parser
            │
            └── embeddings/
                ├── index.ts           # Barrel export
                ├── generator.ts       # generateEmbedding() + generateEmbeddingsBatch()
                └── stringifiers.ts    # stringifyCvForEmbedding() + stringifyJobForEmbedding()
```

### Antigravity Plugin

```
~/.gemini/config/plugins/nordic-jobmatch-ai/
├── plugin.json
└── skills/
    ├── nordic-job-apis/           # API specs for SE, NO, DK, FI job boards
    │   ├── SKILL.md
    │   └── references/
    │       └── harvester-template.md
    ├── vercel-deployment/         # Project-specific Vercel deployment guide
    │   ├── SKILL.md
    │   └── references/
    │       ├── preview.yml        # GitHub Actions CI/CD
    │       └── production.yml
    ├── gdpr-nordic/               # GDPR compliance for Nordic job matching
    │   ├── SKILL.md
    │   └── references/
    │       ├── deletion-pipeline.md
    │       └── dpia-template.md
    └── nordic-i18n/               # next-intl Swedish-first i18n setup
        └── SKILL.md
```

---

## 4. Commands

```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build
npm run start        # Serve production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit (strict)
npm run db:types     # Regenerate database.types.ts from live Supabase schema
npm run db:push      # Push local migrations to remote Supabase
npm run db:migrate   # Create a new migration file
```

---

## 5. Architecture & Conventions

### Data flow

```
FormData (PDF) → validate → parseCv(Buffer)     ← Gemini multimodal inlineData
                                ↓
                  CvStructuredData (Zod-validated)
                                ↓
                  stringifyCvForEmbedding()       ← bilingual anchoring
                                ↓
                  generateEmbedding({ taskType: "query" })
                                ↓
                  supabase.rpc("upsert_cv_profile")  ← atomic upsert
                                ↓
                  supabase.rpc("match_jobs", { query_embedding })
                                ↓
                  Ranked job matches by cosine similarity
```

### Key patterns

- **Server Components first** — Client Components only when UI state requires it.
- **Strict TypeScript** — `noUncheckedIndexedAccess: true`, no `any`, all Supabase queries typed via `database.types.ts`.
- **Zod everywhere** — `CvStructuredDataSchema` is both the Gemini output enforcer (via `responseSchema`) and the runtime validator.
- **Bilingual anchoring** — Stringifiers include both original Nordic terms and English translations in the same string (e.g. `"Welder (Svetsare)"`). This creates cross-lingual bridges in the embedding space.
- **Labeled sections** — Embedding strings use `SKILLS:`, `CERTS:`, `REQUIREMENTS:` prefixes. Embedding models weigh labeled content more appropriately.
- **Front-loading** — Highest-signal fields (skills, certifications, requirements) come first in the embedding string. First ~512 tokens have outsized influence on the vector.
- **Service client vs server client** — `createServerClient()` respects RLS (user context). `createServiceClient()` bypasses RLS (harvesters, admin). Never use service client from client-side code.
- **Tailwind v4** — No `tailwind.config.ts`. All config is CSS-first via `@theme` in `globals.css`. Uses oklch color space.

### Embedding task types

- `taskType: "document"` — Use when **storing** job postings or CVs for indexing.
- `taskType: "query"` — Use when a CV is **searching** for matching jobs.
- `taskType: "similarity"` — Use for direct pairwise comparison.

### Supabase project

- **Project ref:** `nwepwncpxcudfypgcyjr`
- **Region:** eu-north-1 (Stockholm)
- **URL:** `https://nwepwncpxcudfypgcyjr.supabase.co`
- **Migration `00001_initial_schema`** is already applied to production.
- **Migration `00002_upsert_cv_profile_rpc`** is already applied to production.

---

## 6. Key Files

| File | Purpose |
|---|---|
| `src/lib/ai/cv-parser/schema.ts` | The Zod schema defining `CvStructuredData` — the central data contract for parsed CVs. 42 fields, 16 certification categories, Nordic-specific extraction rules. |
| `src/lib/ai/cv-parser/prompt.ts` | Gemini system prompt for CV parsing. Contains all Nordic terminology mappings (certifications, degrees, language proficiency). |
| `src/lib/ai/cv-parser/parser.ts` | `parseCv()` — orchestrates Gemini call, JSON parse, Zod validation. Entry point for CV processing. |
| `src/lib/ai/embeddings/generator.ts` | `generateEmbedding()` and `generateEmbeddingsBatch()` — Gemini text-embedding-004 wrapper with retry, batching (chunks of 100), and task type support. |
| `src/lib/ai/embeddings/stringifiers.ts` | `stringifyCvForEmbedding()` and `stringifyJobForEmbedding()` — flatten structured data into embedding-optimized text with bilingual anchors. |
| `src/lib/database.types.ts` | Auto-generated TypeScript types from Supabase schema. **Do not edit manually** — regenerate with `npm run db:types`. |
| `src/lib/supabase/server.ts` | Two server-side Supabase clients: RLS-aware (`createServerClient`) and admin (`createServiceClient`). |
| `supabase/migrations/00001_initial_schema.sql` | Full schema: 4 tables, 4 enums, HNSW vector indexes, RLS policies, `match_jobs` RPC function. |
| `supabase/migrations/00002_upsert_cv_profile_rpc.sql` | Atomic `upsert_cv_profile` RPC — INSERT ON CONFLICT DO UPDATE. SECURITY INVOKER for RLS enforcement. |
| `src/app/actions/cv-actions.ts` | `uploadAndProcessCv(formData, profileId)` Server Action — accepts PDF via FormData, validates (type, size), then: parse → stringify → embed → store via RPC. Returns discriminated union with timing data. |
| `src/app/actions/match-actions.ts` | `getMatchesForUser(profileId, options)` Server Action — dynamic cosine-similarity job matching via pgvector RPC, hard requirement gap analysis, and quota-safe match explanation summary generation with Swedish/Norwegian fallbacks. |
| `src/app/manifest.ts` | Dynamic PWA Web App Manifest defining name, theme color, display mode, and icon sizes (192x192, 512x512). |
| `public/sw.js` | Production service worker implementing static asset pre-caching, cache-first local asset strategy, and network-first page/API strategy for offline fallback capability. |
| `src/components/PWAProvider.tsx` | Client-side component to register the service worker (`/sw.js`) in the browser. |
| `src/lib/harvesters/sweden-harvester.ts` | `harvestSwedishJobs(limit, publishedAfterMinutes)` — full pipeline: JobTech API fetch (paginated) → normalize to `job_postings` → batch embed (taskType: "document") → upsert via service client. CC0 data, no auth needed. |
| `src/lib/harvesters/norway-harvester.ts` | `harvestNorwegianJobs(limit)` — full pipeline: Bearer auth → stilling-feed traversal (`?last` → `next_url`) → detail fetch per entry → normalize → batch embed → upsert. Requires `NAV_FEED_TOKEN` env var or falls back to public rotating token. |
| `src/app/globals.css` | Tailwind v4 design system: aurora-inspired color palette, custom animations, Inter font stack. |

---

## 7. Gotchas

- **`match_jobs` RPC** — The Supabase function computes `1 - (job_embedding <=> query_embedding)` for cosine similarity. It's `SECURITY DEFINER` with `SET search_path = ''` to prevent injection. It also filters out expired postings (`expires_at > now()`).
- **Embedding dimensions** — Must be exactly 768. The generator validates this. HNSW indexes are built for `vector_cosine_ops` specifically — do not switch to L2 or inner product without reindexing.
- **Multimodal PDF parsing** — `parseCv()` accepts a `Buffer`, not a text string. The PDF is sent to Gemini as base64 `inlineData` (mimeType: `application/pdf`). Gemini reads the document natively. No separate text extraction library is needed. The parser validates PDF magic bytes (`%PDF`) before sending.
- **`raw_text` column** — Stores Gemini's raw JSON response (not the original PDF text), since text extraction is handled internally by Gemini. This preserves the AI's output for debugging.
- **PDF size limit** — 4MB max, 100 bytes min. Enforced in both `cv-actions.ts` (File size check) and `parser.ts` (Buffer size check).
- **`database.types.ts`** — Generated file. The `Json` type is a wide union (`string | number | boolean | null | ...`). When reading `structured_data`, cast it to `CvStructuredData` after Zod validation.
- **Env vars** — Four required keys in `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`. Missing any of these will throw at runtime.
- **Next.js 16 middleware deprecation** — `src/middleware.ts` triggers a warning: "The middleware file convention is deprecated. Please use proxy instead." This is non-breaking but should be migrated when auth flows are built.
- **`zod-to-json-schema`** — The `zodToGeminiSchema()` helper in `schema.ts` uses `$refStrategy: "none"` because Gemini's `responseSchema` does not support `$ref`. The cast goes through `unknown` to satisfy the SDK's `Schema` type.
- **Batch embedding limit** — Gemini allows max 100 texts per `batchEmbedContents` call. The generator auto-chunks and adds 100ms inter-chunk delay to avoid 429s.
- **`source_url` UNIQUE** on `job_postings` — This is the deduplication key for harvesters. The Sweden harvester uses `.upsert(rows, { onConflict: "source_url" })` for deduplication. Re-harvesting the same ads updates their data without duplicating rows.
- **JobTech Dev API** — Base URL: `https://jobsearch.api.jobtechdev.se/search`. No auth required. Max `limit=100`, max `offset=2000`, so a single harvest caps at ~2100 ads. Data is CC0 licensed. The harvester uses `published-after` (minutes) to fetch only recent postings and `sort=pubdate-desc` for newest-first.
- **NAV stilling-feed API** — Base URL: `https://pam-stilling-feed.nav.no`. Requires Bearer token auth. Feed-based (not paginated search): start from `GET /api/v1/feed?last` (newest), follow `next_url` backwards. Each feed page has `items[]` of summaries; full ad content requires `GET /api/v1/feedentry/{entryId}`. Finn.no ads are excluded from the feed.
- **NAV token management** — Env var `NAV_FEED_TOKEN` (stable, for production) takes priority. Fallback: public rotating token from `/api/publicToken` (not recommended for prod). Add `NAV_FEED_TOKEN` to `.env.local`.
- **NAV stopped ads** — When an ad is actively stopped (not just expired), NAV masks the title and contact info. The harvester skips entries with empty titles.
- **Supabase `isOneToOne` type bug** — The `cv_profiles.profile_id` FK has `isOneToOne: true`, causing the Supabase JS client to resolve `.insert()`, `.update()`, and `.upsert()` on `cv_profiles` to `never`. Workaround: use `supabase.rpc('upsert_cv_profile')` instead of direct table mutations. The `.rpc()` call itself needs `@ts-expect-error` because the client also resolves RPC args to `undefined` with `PostgrestVersion:14.5`.
- **Tailwind v4** — No `tailwind.config.ts` file. All theme tokens are in `globals.css` via `@theme`. If you add a `tailwind.config.ts`, it will be ignored.

---

## 8. Open Questions

- **Nordic API harvesters (DK, FI)** — Sweden (JobTech Dev) and Norway (NAV stilling-feed) are built. Denmark (STAR SOAP/FOCES) and Finland (Työmarkkinatori P67 v2) are documented in the `nordic-job-apis` skill with contact info and onboarding steps, but harvesters are not yet implemented. Both require formal access agreements.
- **Auth flow** — Supabase Auth is wired at the middleware level with simulated/auto-login demo flows ready on the landing page.
- **Vercel deployment** — Documented in the `vercel-deployment` skill with `vercel.json`, env var table, security headers, and ready-to-use GitHub Actions CI/CD workflows. Not yet configured on the Vercel platform.
- **PWA setup** — Fully implemented (dynamic metadata manifest route, sw.js service worker with caching strategies, PWAProvider registration wrapper).
- **Multi-currency handling** — The `salary_info` JSONB column supports it structurally, but no normalization or conversion logic exists.
- **GDPR / data privacy** — Documented in the `gdpr-nordic` skill with legal bases, Art. 22 requirements, deletion pipeline (SQL + server action), DPIA template, and implementation checklist. Not yet implemented in code.
- **i18n** — Documented in the `nordic-i18n` skill with next-intl configuration, Swedish-first locale fallbacks, and translation file structure. Not yet implemented in code.

---

## 9. Antigravity Plugin

Project-specific AI agent skills are installed at `~/.gemini/config/plugins/nordic-jobmatch-ai/`. These auto-trigger when working on related tasks and encode domain knowledge that would otherwise require web research.

| Skill | Triggers on | Key content |
|---|---|---|
| `nordic-job-apis` | Building/debugging harvesters | 4 API specs, field mappings, harvester template |
| `vercel-deployment` | Deploying, CI/CD, env vars | vercel.json, region config, security headers, GitHub Actions |
| `gdpr-nordic` | Privacy features, consent, deletion | Legal bases, DPA rules (IMY, Datatilsynet), deletion pipeline, DPIA |
| `nordic-i18n` | Translations, locale config | next-intl setup, sv/no/da/fi/en fallbacks, vocabulary table |
