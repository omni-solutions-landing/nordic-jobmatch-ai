"use client";

import { useRouter, useSearchParams } from "next/navigation";

const COUNTRIES = [
  { code: "", label: "Alla länder", flag: "🌍" },
  { code: "SE", label: "Sverige", flag: "🇸🇪" },
  { code: "NO", label: "Norge", flag: "🇳🇴" },
  { code: "DK", label: "Danmark", flag: "🇩🇰" },
  { code: "FI", label: "Finland", flag: "🇫🇮" },
];

export function CountrySelector() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentCountry = searchParams.get("country") || "";

  const handleSelect = (code: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (code) {
      params.set("country", code);
    } else {
      params.delete("country");
    }
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {COUNTRIES.map((c) => {
        const isActive = currentCountry === c.code;
        return (
          <button
            key={c.code}
            onClick={() => handleSelect(c.code)}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl border transition-all duration-300 ${
              isActive
                ? "bg-gradient-to-r from-aurora-teal to-aurora-blue text-neutral-950 border-transparent shadow-lg shadow-aurora-teal/10"
                : "bg-surface-1 border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700"
            }`}
          >
            <span className="text-sm">{c.flag}</span>
            <span>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
