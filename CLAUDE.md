# CLAUDE.md — Nordic JobMatch AI

## 0. Session Start Checklist

- Read this file fully before touching the codebase.
- Check `package.json` for current scripts and dependency versions.
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
| AI — Embeddings | Gemini gemini-embedding-001 (768-d via outputDimensionality) | — |
| Validation | Zod + zod-to-json-schema | 3.24.4 |
| Deployment | Vercel | Configured (framework: `nextjs` in `vercel.json`) |
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
├── vercel.json                  # Overrides Vercel framework to nextjs
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
│       ├── 00006_fix_match_jobs_search_path.sql # Fix match_jobs search path for pgvector operators
│       ├── 00007_match_jobs_with_keywords.sql # Keyword-filtered semantic job matching RPC
│       ├── 00008_add_job_posting_source_platform.sql # Added source_platform column to job_postings
│       └── 00009_add_notification_settings.sql # Add notification settings and push subscription to profiles
│
├── src/
│   ├── proxy.ts                        # Root proxy (middleware): next-intl + Supabase auth session refresh
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
│   │           ├── matches/           # Job matching board with search filters & country flags
│   │           ├── profile/           # Profile page with CvManager list and DangerZone delete
│   │           └── upload/
│   │
│   ├── components/
│   │   ├── CVUploadForm.tsx
│   │   ├── CvManager.tsx              # CV List selector, activation, deletion actions
│   │   ├── DangerZone.tsx             # Secure account deletion confirmation
│   │   ├── CookieConsent.tsx          # GDPR cookie consent banner (Essential/Analytics/Marketing)
│   │   ├── CountrySelector.tsx        # Flag filters for Sverige, Norge, Danmark, Finland
│   │   ├── DashboardNav.tsx
│   │   ├── DeepHarvestPanel.tsx       # UI panel to trigger deep harvesting on-demand
│   │   ├── KeywordSearch.tsx          # Search bar syncing query parameters to routing
│   │   ├── LimitSelector.tsx          # Limits matches to 10, 25, 50, or 100 per page
│   │   ├── NotificationSettings.tsx   # UI settings for email/push notifications
│   │   ├── PWAProvider.tsx
│   │   └── RefreshMatchesButton.tsx   # Triggers revalidation of job matching listings
│   │
│   └── lib/
│       ├── database.types.ts          # Auto-generated from Supabase
│       │
│       ├── supabase/
│       │   ├── client.ts              # Browser client
│       │   ├── server.ts              # Server & Service clients
│       │   └── middleware.ts          # Auth cookie sync middleware
│       │
│       ├── fp/
│       │   ├── result.ts              # Result monad wrapper for type-safe error handling
│       │   └── branded.ts             # Branded types (ProfileId, JobId, CvId) for compile-time safety
│       │
│       ├── harvesters/
│       │   ├── harvester-pipeline.ts  # Generic pure functional pipeline orchestrator (executeHarvestPipeline)
│       │   ├── sweden-harvester.ts    # JobTech Dev API (CC0 search)
│       │   ├── norway-harvester.ts    # NAV stilling-feed (Arbeidsplassen API)
│       │   ├── indeed-harvester.ts    # Indeed RSS aggregator
│       │   ├── jobindex-harvester.ts  # Jobindex.dk (Danish job board)
│       │   ├── duunitori-harvester.ts # Duunitori.fi (Finnish job board)
│       │   ├── facebook-harvester.ts  # Facebook group posts via Meta Graph API + Gemini structuring
│       │   ├── blocket-harvester.ts   # Blocket Jobb scraper
│       │   └── finn-harvester.ts      # FINN.no (Norwegian job board) + Gemini parsing
│       │
│       └── ai/
│           ├── cv-parser/             # Gemini parsing logic with transient retry fallbacks
│           ├── translation.ts         # Keyword translation with fallbacks and map lookup
│           └── embeddings/            # 768-d Gemini Embedding 2 generators
│               ├── index.ts           # Barrel export
│               ├── generator.ts       # generateEmbedding() + generateEmbeddingsBatch()
│               └── stringifiers.ts    # stringifyCvForEmbedding() + stringifyJobForEmbedding()
│           │
│           └── infrastructure/
│               └── notifications/
│                   └── service.ts     # Email & Push notification engine
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

### Functional Data Flow

The codebase is built on **Strict functional programming** concepts. Side effects are isolated, and functions return algebraic `Result` values instead of throwing exceptions.

```
FormData (PDF) → validateFile() → verifyAuth() → ArrayBuffer → Buffer
                                                                 ↓
  Result.success(StructuredData) ← parseCvWithRetry(pdfBuffer) ←─┘
        ↓
  stringifyCvForEmbedding()
        ↓
  Result.success(Embedding) ← generateEmbedding({ taskType: "query" })
        ↓
  supabase.rpc("create_cv_profile") (DB insert)
```

### Key patterns

- **Strict Functional Architecture** — Class inheritance is deprecated. Harvesters are defined as pure config objects (`HarvesterDefinition`) executed via `executeHarvestPipeline`.
- **Result ADT monad** — All critical business/data operations return `Result<T, E>` types to ensure compile-time error checks.
- **Type Branding** — ID values are wrapped in compile-time branded types (`ProfileId`, `JobId`, etc.) to prevent mixing up unrelated string IDs.
- **Server Components first** — Client Components only when UI state requires it.
- **Strict TypeScript** — `noUncheckedIndexedAccess: true`, no `any`, all Supabase queries typed via `database.types.ts`.
- **Zod everywhere** — `CvStructuredDataSchema` is both the Gemini output enforcer and the runtime validator.
- **Bilingual anchoring** — Stringifiers include both original Nordic terms and English translations in the same string (e.g. `"Welder (Svetsare)"`).
- **Service client vs server client** — `createServerClient()` respects RLS (user context). `createServiceClient()` bypasses RLS (harvesters, admin).
- **Notification & Alert System** — Hooked at the end of the harvest API. Calculates new matches against the `matches` table (acting as a notified audit log) and alerts users via Resend (email) and Web Push (push).
- **Tailwind v4** — CSS-first config via `@theme` in `globals.css`. Uses oklch color space.
- **Proxy instead of Middleware** — Next.js 16 deprecated `middleware.ts` in favor of `src/proxy.ts` (with `proxy` default/named export).

### Embedding task types

- `taskType: "document"` — Use when **storing** job postings or CVs for indexing.
- `taskType: "query"` — Use when a CV is **searching** for matching jobs.
- `taskType: "similarity"` — Use for direct pairwise comparison.

---

## 6. Key Files

| File | Purpose |
|---|---|
| `src/lib/fp/result.ts` | Algebraic Data Type (`Result<T, E>`) mapping helper. |
| `src/lib/fp/branded.ts` | Branded type enforcements (`ProfileId`, `JobId`, `CvId`). |
| `src/lib/harvesters/harvester-pipeline.ts` | Functional pipeline orchestrator `executeHarvestPipeline` running all normalizer/embedding/storage steps. |
| `src/lib/ai/cv-parser/schema.ts` | The Zod schema defining `CvStructuredData`. |
| `src/lib/ai/cv-parser/parser.ts` | `parseCv()` — orchestrates Gemini call, JSON parse, Zod validation. |
| `src/lib/ai/embeddings/generator.ts` | `generateEmbedding()` and `generateEmbeddingsBatch()` — Gemini gemini-embedding-2 wrapper. |
| `src/lib/database.types.ts` | Auto-generated TypeScript types from Supabase schema. |
| `src/proxy.ts` | Handles cookies session sync with Supabase and translations fallback next-intl routing. |
| `src/app/actions/cv-actions.ts` | `uploadAndProcessCv` Server Action — processes and uploads candidate CVs using monad flows. |
| `src/app/actions/match-actions.ts` | `getMatchesForUser` Server Action — matches job postings against active CV with keyword translations & country filters. |
| `src/app/actions/notification-actions.ts` | Server actions to update user notification preferences and save Web Push subscriptions. |
| `src/lib/infrastructure/notifications/service.ts` | Functional notification engine to scan, filter, and send email and push alerts. |

---

## 7. Gotchas

- **`match_jobs` RPC** — The Supabase function computes `1 - (job_embedding <=> query_embedding)` for cosine similarity.
- **Embedding dimensions** — Must be exactly 768. The generator validates this.
- **Multimodal PDF parsing** — `parseCv()` sends the PDF to Gemini as base64 `inlineData` (mimeType: `application/pdf`).
- **`raw_text` column** — Stores Gemini's raw JSON response (not the original PDF text).
- **PDF size limit** — 4MB max, 100 bytes min. Enforced in both `cv-actions.ts` and `parser.ts`.
- **`database.types.ts`** — Generated file. When reading `structured_data`, cast it to `CvStructuredData` after Zod validation.
- **Env vars** — Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL` (production). Optional: `RESEND_API_KEY` (email), `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (push), `FACEBOOK_ACCESS_TOKEN` + `FACEBOOK_GROUP_IDS` (FB harvester), `GEMINI_EMBEDDING_MODEL` (override), `ALLOW_MOCK_FALLBACKS` (dev only). See `.env.local.example`.
- **Next.js 16 proxy deprecation** — `src/proxy.ts` has replaced `src/middleware.ts` to adhere to Next.js 16 conventions. It must export a default function or a named function `proxy`.
- **Batch embedding limit** — Gemini allows max 100 texts per `batchEmbedContents` call.
- **`source_url` UNIQUE** on `job_postings` — This is the deduplication key for all harvesters.
- **Multi-CV support** — The database trigger automatically manages active/inactive flags.
- **Vercel Hobby plan limitations** — `vercel.json` has been simplified to `{ "framework": "nextjs" }`. Regional routing configurations (`regions: ["arn1"]`) are omitted.
- **Embedding model** — model is gemini-embedding-001 (text-embedding-004 was retired by Google 2026-01-14). 768-d is requested via outputDimensionality. Changing the model invalidates ALL stored embeddings — both cv_profiles.skills_embedding and job_postings.job_embedding must be regenerated.
- **Harvester mock fallbacks** — mock fallbacks only activate when ALLOW_MOCK_FALLBACKS=true. Never set this flag in production.
