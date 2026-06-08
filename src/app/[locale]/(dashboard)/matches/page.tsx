import type { Metadata } from "next";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getMatchesForUser, type JobMatch } from "@/app/actions/match-actions";
import { RefreshMatchesButton } from "@/components/RefreshMatchesButton";
import { KeywordSearch } from "@/components/KeywordSearch";
import { DeepHarvestPanel } from "@/components/DeepHarvestPanel";
import { LimitSelector } from "@/components/LimitSelector";
import { CountrySelector } from "@/components/CountrySelector";

export const metadata: Metadata = {
  title: "Matchningar",
  description: "Dina AI-drivna jobbmatchningar i hela Norden.",
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

function MatchScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  let colorClass = "text-error bg-error/10 border-error/20";
  if (pct >= 80) colorClass = "text-success bg-success/10 border-success/20";
  else if (pct >= 60) colorClass = "text-aurora-teal bg-aurora-teal/10 border-aurora-teal/20";
  else if (pct >= 40) colorClass = "text-warning bg-warning/10 border-warning/20";

  return (
    <span className={`inline-flex items-center text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full border ${colorClass}`}>
      {pct}% Match
    </span>
  );
}

function MatchCard({ match }: { match: JobMatch }) {
  return (
    <div className="bg-surface-1 border border-neutral-800 rounded-2xl p-6 transition-all duration-300 hover:border-neutral-700 hover:shadow-lg hover:shadow-black/20 group">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-white group-hover:text-aurora-teal transition-colors truncate">
            {match.job_posting.title}
          </h3>
          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-sm text-neutral-400">
            <span>{match.job_posting.company}</span>
            <span className="text-neutral-700">•</span>
            <span>{match.job_posting.location}</span>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                COUNTRY_COLORS[match.job_posting.country] ?? "bg-surface-2 text-neutral-400 border-neutral-800"
              }`}
            >
              {COUNTRY_LABELS[match.job_posting.country] ?? match.job_posting.country}
            </span>
          </div>
        </div>
        <MatchScoreBadge score={match.match_score} />
      </div>

      {/* AI Explanation */}
      <p className="text-sm text-neutral-300 leading-relaxed mb-4 p-3.5 bg-surface-2 border border-neutral-800 rounded-xl">
        {match.explanation_summary}
      </p>

      {/* Requirements gap */}
      <div className="flex flex-wrap items-center gap-2 text-xs border-t border-neutral-800 pt-4">
        <span className="text-neutral-500 font-medium mr-1">Formella krav:</span>
        {match.job_posting.hard_requirements.length === 0 ? (
          <span className="text-neutral-500">Inga specificerade</span>
        ) : match.missing_prerequisites.length === 0 ? (
          <span className="text-success font-semibold flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
            Uppfyller alla
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {match.job_posting.hard_requirements.map((req, i) => {
              const isMissing = match.missing_prerequisites.includes(req);
              return (
                <span
                  key={i}
                  className={`px-2 py-0.5 rounded-md font-medium border ${
                    isMissing
                      ? "text-error bg-error/5 border-error/20"
                      : "text-neutral-400 bg-neutral-800/50 border-neutral-700"
                  }`}
                >
                  {req} {isMissing ? "✗" : "✓"}
                </span>
              );
            })}
          </div>
        )}

        {match.job_posting.source_url && (
          <a
            href={match.job_posting.source_url}
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

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; limit?: string; country?: string }>;
}) {
  const { q, limit: limitParam, country } = await searchParams;
  const limit = limitParam ? parseInt(limitParam, 10) : 10;
  
  const keywords = q
    ? q
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
    : [];

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const matchesResult = await getMatchesForUser(user!.id, {
    limit,
    keywords,
    countries: country ? [country.toUpperCase()] : undefined,
  });

  const matches = matchesResult.success ? matchesResult.value : [];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Dina jobbmatchningar</h1>
          <p className="text-neutral-400">
            AI-matchade jobb baserat på ditt CV och kompetenser.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RefreshMatchesButton />
          {matches.length > 0 && (
            <span className="text-sm text-neutral-500 bg-surface-1 border border-neutral-800 px-3 py-1.5 rounded-full">
              {matches.length} resultat
            </span>
          )}
        </div>
      </div>

      {/* Keyword Search Filter Bar */}
      <div className="p-4 bg-surface-1/40 border border-neutral-800 rounded-2xl flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <KeywordSearch />
          <LimitSelector />
        </div>
        <div className="border-t border-neutral-800/40 pt-4">
          <CountrySelector />
        </div>
      </div>

      {/* Deep Harvest Control Panel */}
      <DeepHarvestPanel />

      {/* No matches state */}
      {matches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-2xl bg-surface-1 border border-neutral-800 flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Inga matchningar ännu</h2>
          <p className="text-neutral-400 mb-6 max-w-sm">
            Ladda upp ditt CV för att få AI-drivna jobbmatchningar i hela Norden.
          </p>
          <Link
            href="/upload"
            className="bg-gradient-to-r from-aurora-green to-aurora-blue text-neutral-950 font-bold px-6 py-3 rounded-xl hover:opacity-90 transition-all text-sm"
          >
            Ladda upp CV
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {matches.map((match, index) => (
            <MatchCard key={match.job_posting.id || index} match={match} />
          ))}
        </div>
      )}
    </div>
  );
}
