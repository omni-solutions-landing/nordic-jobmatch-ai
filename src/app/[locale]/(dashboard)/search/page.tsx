import type { Metadata } from "next";
import { searchJobs, type JobSearchResult } from "@/app/actions/search-actions";
import { KeywordSearch } from "@/components/KeywordSearch";
import { LimitSelector } from "@/components/LimitSelector";
import { CountrySelector } from "@/components/CountrySelector";

export const metadata: Metadata = {
  title: "Sök jobb",
  description: "Fritextsök bland alla insamlade jobbannonser i hela Norden.",
};

const COUNTRY_LABELS: Record<string, string> = {
  SE: "🇸🇪 Sverige",
  NO: "🇳🇴 Norge",
  DK: "🇩🇰 Danmark",
  FI: "🇫🇮 Finland",
};

const COUNTRY_COLORS: Record<string, string> = {
  SE: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  NO: "bg-red-500/10 text-red-400 border-red-500/20",
  DK: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  FI: "bg-sky-500/10 text-sky-400 border-sky-500/20",
};

function formatSalary(salaryInfo: JobSearchResult["salary_info"]): string | null {
  if (!salaryInfo || typeof salaryInfo !== "object" || Array.isArray(salaryInfo)) {
    return null;
  }
  const s = salaryInfo as Record<string, unknown>;
  if (typeof s["raw"] === "string" && s["raw"].length > 0) return s["raw"];
  const range = [s["min"], s["max"]].filter((v) => typeof v === "number").join("–");
  if (!range) return null;
  const parts = [range];
  if (typeof s["currency"] === "string") parts.push(s["currency"]);
  if (typeof s["period"] === "string") parts.push(`/ ${s["period"]}`);
  return parts.join(" ");
}

function excerpt(text: string, maxLength = 260): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > maxLength * 0.6 ? lastSpace : maxLength)}…`;
}

function JobCard({ job }: { job: JobSearchResult }) {
  const salary = formatSalary(job.salary_info);
  const posted = new Date(job.created_at).toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="bg-surface-1 border border-neutral-800 rounded-2xl p-6 transition-all duration-300 hover:border-neutral-700 hover:shadow-lg hover:shadow-black/20 group">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-white group-hover:text-aurora-teal transition-colors truncate">
            {job.title}
          </h3>
          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-sm text-neutral-400">
            <span>{job.company}</span>
            <span className="text-neutral-700">•</span>
            <span>{job.location}</span>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                COUNTRY_COLORS[job.country] ?? "bg-surface-2 text-neutral-400 border-neutral-800"
              }`}
            >
              {COUNTRY_LABELS[job.country] ?? job.country}
            </span>
          </div>
        </div>
        {job.similarity !== null && (
          <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full border text-aurora-teal bg-aurora-teal/10 border-aurora-teal/20">
            {Math.round(job.similarity * 100)}% Relevans
          </span>
        )}
      </div>

      <p className="text-sm text-neutral-300 leading-relaxed mb-4">
        {excerpt(job.description)}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500 border-t border-neutral-800 pt-4">
        <span>Publicerad {posted}</span>
        {salary && <span className="text-neutral-400">💰 {salary}</span>}
        {job.source_platform && (
          <span className="px-2 py-0.5 rounded-md bg-neutral-800/50 border border-neutral-700 text-neutral-400">
            {job.source_platform}
          </span>
        )}
        {job.source_url && (
          <a
            href={job.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-aurora-blue text-xs font-bold hover:underline inline-flex items-center gap-1"
          >
            Visa annons
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; limit?: string; country?: string }>;
}) {
  const { q, limit: limitParam, country } = await searchParams;
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  const searchResult = await searchJobs({
    query: q,
    limit,
    countries: country ? [country.toUpperCase()] : undefined,
  });

  const jobs = searchResult.success ? searchResult.value : [];
  const hasQuery = !!q?.trim();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Sök jobb</h1>
          <p className="text-neutral-400">
            Fritextsök bland alla insamlade jobbannonser i Norden — inget CV krävs.
          </p>
        </div>
        {jobs.length > 0 && (
          <span className="text-sm text-neutral-500 bg-surface-1 border border-neutral-800 px-3 py-1.5 rounded-full">
            {jobs.length} resultat
          </span>
        )}
      </div>

      {/* Search + filter bar */}
      <div className="p-4 bg-surface-1/40 border border-neutral-800 rounded-2xl flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <KeywordSearch />
          <LimitSelector defaultLimit="50" />
        </div>
        <div className="border-t border-neutral-800/40 pt-4">
          <CountrySelector />
        </div>
      </div>

      {/* Error state */}
      {!searchResult.success && (
        <div className="p-4 bg-aurora-orange/10 border border-aurora-orange/20 text-aurora-orange text-sm rounded-xl">
          {searchResult.error.message}
        </div>
      )}

      {/* Results */}
      {searchResult.success && jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-2xl bg-surface-1 border border-neutral-800 flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">
            {hasQuery ? "Inga jobb hittades" : "Inga jobbannonser ännu"}
          </h2>
          <p className="text-neutral-400 max-w-sm">
            {hasQuery
              ? "Prova ett annat sökord eller ta bort landsfiltret."
              : "Den dagliga skanningen har inte samlat in några annonser ännu. Titta tillbaka senare."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
