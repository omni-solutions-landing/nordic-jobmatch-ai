import Link from "next/link";
import { useTranslations } from "next-intl";
import { createServerClient } from "@/lib/supabase/server";

export default async function LandingPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Load translations
  // Note: we can resolve t on server components since they run in the translation context
  const tLanding = await import(`../../../messages/sv.json`).then(m => m.default.Landing); // fallback static load if needed, but next-intl useTranslations is standard
  return <LandingClient user={user} />;
}

// Keep it simple and use a Client/Server wrapper or server side translations
import { getTranslations } from "next-intl/server";

async function LandingClient({ user }: { user: any }) {
  const t = await getTranslations("Landing");
  const tNav = await getTranslations("Navigation");

  const COUNTRIES = [
    { flag: "🇸🇪", name: "Sverige", status: "Aktiv", statusColor: "text-success" },
    { flag: "🇳🇴", name: "Norge", status: "Aktiv", statusColor: "text-success" },
    { flag: "🇩🇰", name: "Danmark", status: "Kommande", statusColor: "text-warning" },
    { flag: "🇫🇮", name: "Finland", status: "Kommande", statusColor: "text-warning" },
  ];

  const FEATURES = [
    {
      title: t("feature_1_title"),
      description: t("feature_1_desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      title: t("feature_2_title"),
      description: t("feature_2_desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      title: t("feature_3_title"),
      description: t("feature_3_desc"),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  return (
    <main className="min-h-screen bg-surface-0 relative overflow-hidden">
      {/* Aurora background */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -top-1/4 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full opacity-15 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, var(--color-aurora-green), var(--color-aurora-teal), var(--color-aurora-blue), transparent 70%)",
          }}
        />
        <div
          className="absolute top-1/2 left-1/3 h-[500px] w-[600px] rounded-full opacity-10 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, var(--color-aurora-purple), var(--color-aurora-blue), transparent 70%)",
          }}
        />
      </div>

      {/* Navigation */}
      <header className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-aurora-green to-aurora-blue animate-pulse-glow" />
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-neutral-400 bg-clip-text text-transparent">
            Nordic JobMatch AI
          </span>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <Link
              href="/upload"
              className="bg-gradient-to-r from-aurora-green to-aurora-blue text-neutral-950 font-bold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all text-sm"
            >
              {tNav("dashboard")}
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="text-neutral-400 hover:text-white font-medium px-4 py-2.5 text-sm transition-colors"
              >
                {tNav("login")}
              </Link>
              <Link
                href="/register"
                className="bg-gradient-to-r from-aurora-green to-aurora-blue text-neutral-950 font-bold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all text-sm"
              >
                {tNav("register")}
              </Link>
            </>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-24 text-center animate-fade-in">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white mb-6 leading-tight">
          Hitta ditt nästa jobb{" "}
          <span className="bg-gradient-to-r from-aurora-green via-aurora-teal to-aurora-blue bg-clip-text text-transparent">
            över gränserna
          </span>
          {" "}i Norden
        </h1>
        <p className="text-lg md:text-xl text-neutral-400 max-w-2xl mx-auto leading-relaxed mb-10">
          {t("description")}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href={user ? "/upload" : "/register"}
            className="bg-gradient-to-r from-aurora-green to-aurora-blue text-neutral-950 font-bold px-8 py-4 rounded-xl hover:opacity-90 transition-all text-base shadow-lg shadow-aurora-green/20"
          >
            {user ? t("cta_upload") : tNav("register")}
          </Link>
          {!user && (
            <Link
              href="/login"
              className="text-neutral-300 hover:text-white font-medium px-8 py-4 rounded-xl border border-neutral-800 hover:border-neutral-700 transition-all text-base"
            >
              {tNav("login")}
            </Link>
          )}
        </div>
      </section>

      {/* Countries */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {COUNTRIES.map((c) => (
            <div
              key={c.name}
              className="bg-surface-1 border border-neutral-800 rounded-xl p-4 text-center hover:border-neutral-700 transition-colors"
            >
              <span className="text-3xl mb-2 block">{c.flag}</span>
              <span className="text-sm font-semibold text-white block">{c.name}</span>
              <span className={`text-xs font-medium ${c.statusColor}`}>{c.status}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <h2 className="text-2xl font-bold text-white text-center mb-12">
          {t("features_title")}
        </h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="bg-surface-1 border border-neutral-800 rounded-2xl p-6 hover:border-neutral-700 transition-all group"
            >
              <div className="w-12 h-12 rounded-xl bg-surface-2 border border-neutral-800 flex items-center justify-center text-aurora-teal mb-4 group-hover:scale-105 transition-transform">
                {feature.icon}
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{feature.title}</h3>
              <p className="text-sm text-neutral-400 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-800/60 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-neutral-600">
            Nordic JobMatch AI © 2026. Data och tjänster skyddas enligt GDPR.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { label: "Supabase DB", active: true },
              { label: "pgvector", active: true },
              { label: "Gemini 2.5 Flash", active: true },
            ].map(({ label, active }) => (
              <div
                key={label}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-surface-1 border border-neutral-800"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    active ? "bg-success animate-pulse-glow" : "bg-neutral-500"
                  }`}
                />
                <span className="font-medium text-xs text-neutral-500">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
