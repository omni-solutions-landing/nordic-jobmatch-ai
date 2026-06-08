"use client";

import { useState } from "react";
import Link from "next/link";
import { forgotPasswordAction } from "@/app/actions/auth-actions";

export default function ForgotPasswordPage() {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError("");
    const result = await forgotPasswordAction(formData);
    if (result.success) {
      setSuccess(true);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }

  return (
    <div className="w-full max-w-md animate-slide-up">
      <div className="bg-surface-1 border border-neutral-800 rounded-2xl p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-white mb-2">Glömt lösenordet?</h1>
        <p className="text-sm text-neutral-400 mb-8">
          Ange din e-postadress så skickar vi en återställningslänk.
        </p>

        {error && (
          <div className="mb-6 p-3 bg-error/10 border border-error/20 text-error rounded-xl text-sm">
            {error}
          </div>
        )}

        {success ? (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success/10 border border-success/20 mb-4">
              <svg className="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-white mb-2">E-post skickad!</h2>
            <p className="text-sm text-neutral-400 mb-6">
              Kolla din inkorg för en länk att återställa ditt lösenord.
            </p>
            <Link
              href="/login"
              className="text-brand-400 hover:text-brand-300 text-sm font-medium transition-colors"
            >
              ← Tillbaka till inloggning
            </Link>
          </div>
        ) : (
          <form action={handleSubmit} className="space-y-5">
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

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-xl transition-all text-sm disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Skickar...
                </span>
              ) : (
                "Skicka återställningslänk"
              )}
            </button>

            <p className="text-center text-sm text-neutral-500">
              <Link href="/login" className="text-brand-400 hover:text-brand-300 font-medium transition-colors">
                ← Tillbaka till inloggning
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
