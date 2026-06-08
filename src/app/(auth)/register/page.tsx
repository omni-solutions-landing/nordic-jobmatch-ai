"use client";

import { useState } from "react";
import Link from "next/link";
import { registerAction, demoLoginAction } from "@/app/actions/auth-actions";

export default function RegisterPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError("");
    const result = await registerAction(formData);
    if (!result.success) {
      setError(result.error);
      setLoading(false);
    }
  }

  async function handleDemo() {
    setLoading(true);
    setError("");
    const result = await demoLoginAction();
    if (!result.success) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md animate-slide-up">
      <div className="bg-surface-1 border border-neutral-800 rounded-2xl p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-white mb-2">Skapa konto</h1>
        <p className="text-sm text-neutral-400 mb-8">
          Registrera dig gratis och börja matcha jobb i Norden.
        </p>

        {error && (
          <div className="mb-6 p-3 bg-error/10 border border-error/20 text-error rounded-xl text-sm">
            {error}
          </div>
        )}

        <form action={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="fullName" className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
              Ditt namn
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              placeholder="Anna Svensson"
              className="w-full bg-surface-2 border border-neutral-800 focus:border-brand-500 text-white rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
              E-postadress
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="namn@exempel.se"
              className="w-full bg-surface-2 border border-neutral-800 focus:border-brand-500 text-white rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
              Lösenord
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              placeholder="Minst 6 tecken"
              className="w-full bg-surface-2 border border-neutral-800 focus:border-brand-500 text-white rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-xl transition-all text-sm disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Skapar konto...
              </span>
            ) : (
              "Skapa konto"
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="relative flex items-center justify-center my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-800" />
          </div>
          <span className="relative px-3 bg-surface-1 text-xs text-neutral-500 uppercase tracking-wider">
            Eller
          </span>
        </div>

        <button
          onClick={handleDemo}
          disabled={loading}
          className="w-full bg-gradient-to-r from-aurora-green to-aurora-blue hover:opacity-90 text-neutral-950 font-bold py-3 rounded-xl transition-all text-sm disabled:opacity-50"
        >
          Kör snabb demo (Auto-login)
        </button>

        <p className="mt-6 text-center text-sm text-neutral-500">
          Har redan konto?{" "}
          <Link href="/login" className="text-brand-400 hover:text-brand-300 font-medium transition-colors">
            Logga in
          </Link>
        </p>
      </div>
    </div>
  );
}
