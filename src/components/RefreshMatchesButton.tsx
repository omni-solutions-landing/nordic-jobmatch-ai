"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RefreshMatchesButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <button
      onClick={handleRefresh}
      disabled={isPending}
      className="inline-flex items-center gap-2 px-4 py-2 bg-surface-1 hover:bg-surface-2 border border-neutral-800 hover:border-neutral-700 text-neutral-300 hover:text-white text-sm font-semibold rounded-xl transition-all disabled:opacity-50 shrink-0"
    >
      <svg
        className={`w-4 h-4 transition-transform ${isPending ? "animate-spin text-aurora-green" : "text-neutral-400"}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3 3L22 4"
        />
      </svg>
      {isPending ? "Söker..." : "Sök igen"}
    </button>
  );
}
