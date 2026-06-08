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
| AI — Embeddings | Gemini gemini-embedding-2 (768-d) | — |
| Validation | Zod + zod-to-json-schema | 3.24.4 |
| Deployment | Vercel | Configured (`vercel.json`, region: `arn1`) |
| Package manager | npm | 11.6.2 |
| Runtime | Node.js | 24.11.1 |

---

## 3. Project Structure

```
nordic-jobmatch-ai/
├── .env.local.example           # Required env vars template (4 keys)
├── next.config.ts               # Security headers, next-intl wrapper
├── postcss.config.mjs           # Tailwind v4 via @tailwindcss/postcss
├── tsconfig.json                # Strict mode, @/* → ./src/* alias
├── package.json                 # Scripts, deps
├── vercel.json                  # Stockholm regional colocated functions (arn1)
│
├── messages/                    # next-intl translation dictionaries
│   ├── sv.json                  # Swedish (default, primary)
│   ├── no.json                  # Norwegian
│   ├── da.json                  # Danish
│   ├── fi.json                  # Finnish
│   └── en.json                  # English fallback
│
├── supabase/
│   └── migrations/
│       ├── 00001_initial_schema.sql   # 4 tables, 4 enums, HNSW indexes, RLS, match_jobs RPC
│       ├── 00002_upsert_cv_profile_rpc.sql  # Atomic upsert RPC for cv_profiles (unused in multi-CV)
│       ├── 00003_create_profile_on_signup_trigger.sql # Auto-creates profile in public.profiles
│       ├── 00004_multi_cv_support.sql # Multi-CV table schema, trigger and create_cv_profile RPC
│       ├── 00005_delete_user_data_rpc.sql # GDPR cascading data deletion RPC
│       └── 00006_fix_match_jobs_search_path.sql # Fix match_jobs search path for pgvector operators
│
├── src/
│   ├── middleware.ts                   # Root middleware: next-intl + Supabase auth session refresh
│   │
│   ├── i18n/
│   │   ├── routing.ts                  # next-intl dynamic route prefix definitions
│   │   └── request.ts                  # next-intl async translation message loader
│   │
│   ├── app/
│   │   ├── globals.css                # Tailwind v4 @theme design tokens (aurora palette)
│   │   ├── manifest.ts                # Dynamic PWA Web App Manifest
│   │   ├── page.tsx                   # Pass-through locale redirect
│   │   ├── layout.tsx                 # Pass-through root layout wrapper
│   │   │
│   │   └── [locale]/                  # next-intl localized directory
│   │       ├── layout.tsx             # Localized root layout (loads translations, CookieConsent)
│   │       ├── page.tsx               # Localized landing page
│   │       ├── privacy/               # Localized GDPR Static Privacy Policy Page
│   │       │   └── page.tsx
│   │       │
│   │       ├── (auth)/                # Localized auth routes
│   │       │   ├── login/
│   │       │   ├── register/
│   │       │   └── forgot-password/
│   │       │
│   │       └── (dashboard)/           # Localized dashboard routes
│   │           ├── matches/
│   │           ├── profile/           # Profile page with CvManager list and DangerZone delete
│   │           └── upload/
│   │
│   ├── components/
│   │   ├── CVUploadForm.tsx
│   │   ├── CvManager.tsx              # CV List selector, activation, deletion actions
│   │   ├── DangerZone.tsx             # Secure account deletion confirmation
│   │   ├── CookieConsent.tsx          # GDPR cookie consent banner (Essential/Analytics/Marketing)
│   │   ├── DashboardNav.tsx
│   │   └── PWAProvider.tsx
│   │
│   └── lib/
│       ├── database.types.ts          # Auto-generated from Supabase
│       │
│       ├── supabase/
│       │   ├── client.ts              # Browser client
│       │   ├── server.ts              # Server & Service clients
│       │   └── middleware.ts          # Auth cookie sync middleware
│       │
│       ├── harvesters/
│       │   ├── sweden-harvester.ts    # JobTech Dev API
│       │   └── norway-harvester.ts    # NAV stilling-feed
│       │
│       └── ai/
│           ├── cv-parser/             # Gemini parsing logic with transient retry fallbacks
│           └── embeddings/            # 768-d Gemini Embedding 2 generators
│               ├── index.ts           # Barrel export
│               ├── generator.ts       # generateEmbedding() + generateEmbeddingsBatch()
│               └── stringifiers.ts    # stringifyCvForEmbedding() + stringifyJobForEmbedding()
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
                  supabase.rpc("create_cv_profile")  ← insert with is_active=true
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
| `src/lib/ai/embeddings/generator.ts` | `generateEmbedding()` and `generateEmbeddingsBatch()` — Gemini gemini-embedding-2 wrapper with 768-d outputDimensionality configuration, retry, batching (chunks of 100), and task type support. |
| `src/lib/ai/embeddings/stringifiers.ts` | `stringifyCvForEmbedding()` and `stringifyJobForEmbedding()` — flatten structured data into embedding-optimized text with bilingual anchors. |
| `src/lib/database.types.ts` | Auto-generated TypeScript types from Supabase schema. **Do not edit manually** — regenerate with `npm run db:types`. |
| `src/lib/supabase/server.ts` | Two server-side Supabase clients: RLS-aware (`createServerClient`) and admin (`createServiceClient`). |
| `supabase/migrations/00001_initial_schema.sql` | Full schema: 4 tables, 4 enums, HNSW vector indexes, RLS policies, `match_jobs` RPC function. |
| `supabase/migrations/00002_upsert_cv_profile_rpc.sql` | Atomic `upsert_cv_profile` RPC (unused/legacy after Multi-CV support was introduced). |
| `supabase/migrations/00003_create_profile_on_signup_trigger.sql` | PostgreSQL trigger function that automatically creates a profile row in public.profiles when a new user registers in auth.users. |
| `supabase/migrations/00004_multi_cv_support.sql` | Drops unique constraint on cv_profiles.profile_id, adds filename and is_active columns, and establishes the active CV management trigger. |
| `src/app/actions/cv-actions.ts` | `uploadAndProcessCv(formData, profileId)` Server Action — accepts PDF via FormData, validates (type, size), then: parse (with retry fallback) → stringify → embed (768-d) → store via `create_cv_profile` RPC. |
| `src/app/actions/match-actions.ts` | `getMatchesForUser(profileId, options)` Server Action — matches jobs against the active CV (`is_active = true`) using cosine similarity via match_jobs RPC. |
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
- **Multi-CV support** — The unique constraint on `cv_profiles.profile_id` was dropped. Users can have multiple CVs. The active CV has `is_active = true`. A database trigger (`trg_set_active_cv_profile` executing `set_active_cv_profile()`) automatically deactivates all other CVs for the profile when one is activated or newly created.
- **Supabase `isOneToOne` type bug workaround** — We use the `create_cv_profile` RPC for inserting new CVs to preserve exact typings.
- **Gemini Fallback Logic** — `parseCv()` in `parser.ts` automatically falls back to `gemini-2.0-flash` (and then `gemini-3.5-flash`) if `gemini-2.5-flash` throws transient `503 Service Unavailable` or `429 Rate Limit` errors.
- **Embedding Dimensions & Model** — Configured to `gemini-embedding-2` with `outputDimensionality: 768` to match the PostgreSQL pgvector column constraints.
- **Tailwind v4** — No `tailwind.config.ts` file. All theme tokens are in `globals.css` via `@theme`. If you add a `tailwind.config.ts`, it will be ignored.

---

## 8. Open Questions

- **Nordic API harvesters (DK, FI)** — Sweden (JobTech Dev) and Norway (NAV stilling-feed) are built. Denmark (STAR SOAP/FOCES) and Finland (Työmarkkinatori P67 v2) are documented in the `nordic-job-apis` skill with contact info and onboarding steps, but harvesters are not yet implemented. Both require formal access agreements.
- **Private Job Boards & Social Media Harvesting Integration** — A design has been created to expand the job harvesting pipeline to include **Indeed**, **Jobindex.dk**, **Duunitori.fi**, **Blocket Jobb** (via Playwright web scraping), and **Facebook Groups** (via Meta Graph API). See [implementation_plan.md](file:///C:/Users/Jari/.gemini/antigravity/brain/9017fb91-2675-4188-8aee-1aa3729f3560/implementation_plan.md) for details. Key steps include adding the `source_platform` column to the DB, creating a `BaseHarvester` abstraction, using Gemini AI to structure unstructured ads, and updating the harvest API route.
- **Auth flow** — Supabase Auth is wired at the middleware level with simulated/auto-login demo flows ready on the landing page.
- **Multi-currency handling** — The `salary_info` JSONB column supports it structurally, but no normalization or conversion logic exists.

---

## 9. Antigravity Plugin

Project-specific AI agent skills are installed at `~/.gemini/config/plugins/nordic-jobmatch-ai/`. These auto-trigger when working on related tasks and encode domain knowledge that would otherwise require web research.

| Skill | Triggers on | Key content |
|---|---|---|
| `nordic-job-apis` | Building/debugging harvesters | 4 API specs, field mappings, harvester template |
| `vercel-deployment` | Deploying, CI/CD, env vars | vercel.json, region config, security headers, GitHub Actions |
| `gdpr-nordic` | Privacy features, consent, deletion | Legal bases, DPA rules (IMY, Datatilsynet), deletion pipeline, DPIA |
| `nordic-i18n` | Translations, locale config | next-intl setup, sv/no/da/fi/en fallbacks, vocabulary table |
