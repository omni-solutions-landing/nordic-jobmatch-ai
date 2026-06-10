"use client";

import { useState } from "react";
import { triggerHarvestAction, type HarvestActionResponse } from "@/app/actions/harvest-actions";
import { useRouter, useSearchParams } from "next/navigation";

export function DeepHarvestPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [isHarvesting, setIsHarvesting] = useState(false);
  const [lookbackDays, setLookbackDays] = useState(7);
  const [limit, setLimit] = useState(50);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<HarvestActionResponse | null>(null);

  // Auto-fill keyword from search URL parameters if empty
  const handleOpenToggle = () => {
    if (!isOpen && !keyword) {
      const q = searchParams.get("q") || "";
      setKeyword(q);
    }
    setIsOpen(!isOpen);
  };

  const handleHarvest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsHarvesting(true);
    setResult(null);
    setStatus("Ansluter till Nordic Job APIs...");

    try {
      setStatus("Söker och hämtar annonser från JobTech Dev (Sverige) & NAV (Norge)...");
      const res = await triggerHarvestAction({
        lookbackDays,
        limit,
        keyword: keyword.trim() || undefined,
      });
      
      setResult(res);
      if (res.success) {
        setStatus("Skörd slutförd framgångsrikt!");
        router.refresh();
      } else {
        setStatus("Skörden stötte på problem.");
      }
    } catch (err) {
      setStatus("Ett oväntat fel uppstod.");
      setResult({
        success: false,
        error:
          err instanceof Error && err.message
            ? err.message
            : "Ett okänt fel uppstod under skörden.",
      });
    } finally {
      setIsHarvesting(false);
    }
  };

  return (
    <div className="w-full bg-surface-1 border border-neutral-800 rounded-2xl overflow-hidden transition-all duration-300">
      {/* Panel Header/Trigger */}
      <button
        onClick={handleOpenToggle}
        className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-surface-2 transition-colors duration-200"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-aurora-teal/10 text-aurora-teal">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Sök i äldre annonser (Deep Harvest)</h3>
            <p className="text-xs text-neutral-400">Skörda jobb längre bak i tiden anpassat efter dina sökord.</p>
          </div>
        </div>
        <div className="text-neutral-500">
          <svg
            className={`w-5 h-5 transform transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Panel Content */}
      {isOpen && (
        <div className="px-6 pb-6 pt-2 border-t border-neutral-800/50 space-y-5 animate-slide-down">
          {isHarvesting ? (
            <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-4 border-neutral-800 border-t-aurora-teal animate-spin" />
                <div className="absolute inset-1.5 rounded-full border-4 border-dashed border-neutral-800 border-b-aurora-blue animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">Skördar aktiva jobbannonser...</p>
                <p className="text-xs text-neutral-400 max-w-sm">{status}</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleHarvest} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Lookback Days */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Tidsperiod</label>
                  <select
                    value={lookbackDays}
                    onChange={(e) => setLookbackDays(parseInt(e.target.value, 10))}
                    className="w-full px-4 py-2.5 bg-surface-2 border border-neutral-800 focus:border-aurora-teal focus:ring-1 focus:ring-aurora-teal rounded-xl text-sm text-white outline-none transition-all"
                  >
                    <option value={1}>Senaste dygnet (1 dag)</option>
                    <option value={7}>Senaste veckan (7 dagar)</option>
                    <option value={14}>Senaste 2 veckorna (14 dagar)</option>
                    <option value={30}>Senaste månaden (30 dagar)</option>
                  </select>
                </div>

                {/* Limit */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Max antal jobb</label>
                  <select
                    value={limit}
                    onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                    className="w-full px-4 py-2.5 bg-surface-2 border border-neutral-800 focus:border-aurora-teal focus:ring-1 focus:ring-aurora-teal rounded-xl text-sm text-white outline-none transition-all"
                  >
                    <option value={20}>Hämta max 20 jobb</option>
                    <option value={50}>Hämta max 50 jobb</option>
                    <option value={100}>Hämta max 100 jobb (Långsammare)</option>
                  </select>
                </div>

                {/* Keyword */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Nyckelordsfilter (valfritt)</label>
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="t.ex. Chaufför, lastbil..."
                    className="w-full px-4 py-2.5 bg-surface-2 border border-neutral-800 focus:border-aurora-teal focus:ring-1 focus:ring-aurora-teal rounded-xl text-sm text-white outline-none transition-all placeholder-neutral-600"
                  />
                </div>
              </div>

              <div className="text-xs text-neutral-500 leading-relaxed max-w-2xl">
                Genom att trycka på starta skickas en direktförfrågan till svenska Platsbanken (JobTech Dev API) och norska NAV för att hämta äldre aktiva jobbannonser. Jobben översätts, AI-vektoriseras och lagras i databasen för omedelbar matchning.
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-gradient-to-r from-aurora-teal to-aurora-blue hover:opacity-90 text-neutral-950 font-bold rounded-xl text-sm transition-all shadow-lg shadow-aurora-teal/10 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17" />
                  </svg>
                  Starta skörd
                </button>
              </div>
            </form>
          )}

          {/* Results Alert */}
          {result && (
            <div className={`p-4 rounded-xl text-sm flex items-start gap-3 border ${
              result.success 
                ? "bg-success/5 border-success/20 text-success" 
                : "bg-error/5 border-error/20 text-error"
            }`}>
              {result.success ? (
                <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <div className="space-y-1">
                <p className="font-bold">{result.success ? "Skörd klar!" : "Skörden stötte på fel"}</p>
                <div className="text-neutral-300 text-xs space-y-1 mt-1">
                  {result.results?.sweden && (
                    <p>🇸🇪 Sverige (JobTech): Hämtade {result.results.sweden.fetched} annonser, sparade {result.results.sweden.stored} st.</p>
                  )}
                  {result.results?.norway && (
                    <p>🇳🇴 Norge (NAV): Hämtade detaljer för {result.results.norway.fetched} annonser, sparade {result.results.norway.stored} st.</p>
                  )}
                  {result.results?.jobindex && (
                    <p>🇩🇰 Danmark (Jobindex): Hämtade {result.results.jobindex.fetched} annonser, sparade {result.results.jobindex.stored} st.</p>
                  )}
                  {result.results?.duunitori && (
                    <p>🇫🇮 Finland (Duunitori): Hämtade {result.results.duunitori.fetched} annonser, sparade {result.results.duunitori.stored} st.</p>
                  )}
                  {result.results?.facebook && (
                    <p>👥 Sociala medier (Facebook): Hämtade {result.results.facebook.fetched} poster, sparade {result.results.facebook.stored} st.</p>
                  )}
                  {result.error && (
                    <p className="text-error font-medium mt-1">{result.error}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
