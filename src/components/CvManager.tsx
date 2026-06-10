"use client";

import { useState } from "react";
import { activateCvAction, deleteCvAction } from "@/app/actions/cv-actions";

interface CvInfo {
  id: string;
  filename: string;
  is_active: boolean;
  updated_at: string;
}

interface CvManagerProps {
  cvs: CvInfo[];
}

export function CvManager({ cvs }: CvManagerProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleActivate = async (id: string) => {
    setLoadingId(id);
    setError(null);
    try {
      const res = await activateCvAction(id);
      if (!res.success) {
        setError(res.error || "Misslyckades med att aktivera CV.");
      }
    } catch {
      setError("Ett oväntat fel uppstod.");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Är du säker på att du vill radera "${name}"? Det går inte att ångra.`)) {
      return;
    }
    setLoadingId(id);
    setError(null);
    try {
      const res = await deleteCvAction(id);
      if (!res.success) {
        setError(res.error || "Misslyckades med att radera CV.");
      }
    } catch {
      setError("Ett oväntat fel uppstod.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 bg-aurora-orange/10 border border-aurora-orange/20 text-aurora-orange text-sm rounded-xl">
          {error}
        </div>
      )}

      <div className="grid gap-3">
        {cvs.map((cv) => {
          const isSelected = cv.is_active;
          const formattedDate = new Date(cv.updated_at).toLocaleDateString("sv-SE", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });

          return (
            <div
              key={cv.id}
              className={`p-4 rounded-xl border transition-all duration-300 flex flex-wrap items-center justify-between gap-3 min-w-0 overflow-hidden ${
                isSelected
                  ? "bg-surface-2/60 border-aurora-green/30 shadow-lg shadow-aurora-green/5"
                  : "bg-surface-1 border-neutral-800 hover:border-neutral-700"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border ${
                    isSelected
                      ? "bg-aurora-green/10 border-aurora-green/20 text-aurora-green"
                      : "bg-surface-2 border-neutral-800 text-neutral-400"
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-white truncate pr-2">
                    {cv.filename}
                  </h4>
                  <p className="text-xs text-neutral-500 mt-0.5">Uppdaterat {formattedDate}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isSelected ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full bg-aurora-green/10 text-aurora-green border border-aurora-green/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-aurora-green animate-pulse" />
                    Aktivt
                  </span>
                ) : (
                  <button
                    onClick={() => handleActivate(cv.id)}
                    disabled={loadingId !== null}
                    className="px-3 py-1.5 text-xs font-semibold text-neutral-300 bg-surface-2 hover:bg-surface-3 border border-neutral-800 rounded-lg hover:text-white transition-all disabled:opacity-50"
                  >
                    {loadingId === cv.id ? "Aktiverar..." : "Aktivera"}
                  </button>
                )}

                <button
                  onClick={() => handleDelete(cv.id, cv.filename)}
                  disabled={loadingId !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-aurora-orange bg-aurora-orange/10 hover:bg-aurora-orange/20 border border-aurora-orange/30 hover:border-aurora-orange/50 rounded-lg transition-all disabled:opacity-50"
                  title="Radera CV"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  {loadingId === cv.id ? "Raderar..." : "Radera"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
