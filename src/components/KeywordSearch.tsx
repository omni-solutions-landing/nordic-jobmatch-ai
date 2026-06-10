"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function KeywordSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [input, setInput] = useState("");

  // Populate input from URL query parameter on mount/URL change. The URL is
  // an external system (back/forward navigation must reset the field), so
  // this is a legitimate external-state sync.
  useEffect(() => {
    const query = searchParams.get("q") || "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInput(query);
  }, [searchParams]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    if (input.trim()) {
      params.set("q", input.trim());
    } else {
      params.delete("q");
    }
    router.push(`?${params.toString()}`);
  };

  const handleClear = () => {
    setInput("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    router.push(`?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl">
      <div className="relative flex items-center">
        <div className="absolute left-4 text-neutral-500 pointer-events-none">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Filtrera på nyckelord (t.ex. Chaufför, CE, lastbil)..."
          className="w-full pl-12 pr-20 py-3 bg-surface-1 border border-neutral-800 hover:border-neutral-700 focus:border-aurora-teal focus:ring-1 focus:ring-aurora-teal text-white text-sm rounded-2xl outline-none transition-all duration-300 placeholder-neutral-500 shadow-inner"
        />
        <div className="absolute right-2 flex items-center gap-1.5">
          {input && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1.5 text-neutral-500 hover:text-white rounded-lg transition-colors"
              title="Rensa sökning"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <button
            type="submit"
            className="px-4 py-1.5 bg-gradient-to-r from-aurora-green to-aurora-blue text-neutral-950 text-xs font-bold rounded-xl hover:opacity-90 transition-all shadow-md shadow-aurora-green/10"
          >
            Sök
          </button>
        </div>
      </div>
    </form>
  );
}
