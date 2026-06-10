"use client";

import { useState } from "react";
import { deleteUserAccountAction } from "@/app/actions/gdpr-actions";

interface DangerZoneProps {
  profileId: string;
}

export function DangerZone({ profileId }: DangerZoneProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmText !== "RADERA") {
      setError("Du måste skriva RADERA för att bekräfta.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await deleteUserAccountAction(profileId);
      if (!res.success) {
        setError(res.error || "Ett fel uppstod vid radering av kontot.");
        setLoading(false);
      }
    } catch {
      setError("Ett oväntat fel uppstod.");
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface-1 border border-aurora-orange/20 rounded-2xl p-6">
      <h3 className="text-lg font-bold text-aurora-orange flex items-center gap-2 mb-2">
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        Farozoon (Danger Zone)
      </h3>
      <p className="text-neutral-400 text-sm mb-4">
        Om du raderar ditt konto kommer all din kontodata, dina CV-profiler, matchningsresultat och din inloggning att tas bort permanent enligt GDPR-kraven. Denna åtgärd kan inte ångras.
      </p>

      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="px-4 py-2 bg-aurora-orange/10 hover:bg-aurora-orange/20 border border-aurora-orange/30 hover:border-aurora-orange/50 text-aurora-orange text-sm font-semibold rounded-xl transition-all"
        >
          Radera mitt konto
        </button>
      ) : (
        <form onSubmit={handleDelete} className="space-y-4 max-w-md">
          {error && (
            <div className="p-3 bg-aurora-orange/10 border border-aurora-orange/20 text-aurora-orange text-xs rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs text-neutral-400 mb-1.5 font-medium">
              Skriv <span className="font-bold text-white">RADERA</span> nedan för att bekräfta permanent radering:
            </label>
            <input
              type="text"
              required
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Skriv RADERA"
              className="w-full bg-surface-2 border border-neutral-800 focus:border-neutral-700 text-white placeholder-neutral-600 rounded-xl px-4 py-2.5 text-sm outline-none transition-all"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || confirmText !== "RADERA"}
              className="px-4 py-2 bg-aurora-orange text-neutral-950 hover:bg-opacity-90 disabled:opacity-30 disabled:hover:bg-aurora-orange text-sm font-bold rounded-xl transition-all"
            >
              {loading ? "Raderar konto..." : "Ja, radera mitt konto permanent"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setConfirmText("");
                setError(null);
              }}
              disabled={loading}
              className="px-4 py-2 bg-surface-2 hover:bg-surface-3 border border-neutral-800 text-neutral-300 hover:text-white text-sm font-semibold rounded-xl transition-all"
            >
              Avbryt
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
