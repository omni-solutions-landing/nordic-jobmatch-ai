"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function LimitSelector({
  defaultLimit = "10",
}: {
  defaultLimit?: "10" | "25" | "50" | "100";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentLimit = searchParams.get("limit") || defaultLimit;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("limit", e.target.value);
    // Reset to first page or just push parameters
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2 bg-surface-2 border border-neutral-800 hover:border-neutral-700 rounded-xl px-3 py-2 transition-colors">
      <span className="text-xs text-neutral-400 font-medium whitespace-nowrap">Visa:</span>
      <select
        value={currentLimit}
        onChange={handleChange}
        className="bg-transparent text-xs font-bold text-white outline-none border-none cursor-pointer pr-1 focus:ring-0 focus:border-none"
      >
        <option value="10" className="bg-surface-1 text-white">10 matchningar</option>
        <option value="25" className="bg-surface-1 text-white">25 matchningar</option>
        <option value="50" className="bg-surface-1 text-white">50 matchningar</option>
        <option value="100" className="bg-surface-1 text-white">100 matchningar</option>
      </select>
    </div>
  );
}
