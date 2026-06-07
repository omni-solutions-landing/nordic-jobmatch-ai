"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadAndProcessCv } from "@/app/actions/cv-actions";
import { getMatchesForUser, type JobMatch } from "@/app/actions/match-actions";
import type { CvStructuredData } from "@/lib/ai/cv-parser/schema";
import type { User } from "@supabase/supabase-js";

export default function HomePage() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  // Upload & Process state
  const [dragActive, setDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cvData, setCvData] = useState<CvStructuredData | null>(null);
  const [results, setResults] = useState<JobMatch[] | null>(null);

  const supabase = createClient();

  useEffect(() => {
    const initUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      setLoadingUser(false);
    };

    initUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  // Auth Operations
  const handleAuth = async (mode: "login" | "signup" | "demo") => {
    setAuthLoading(true);
    setAuthError("");
    setError(null);

    const email = mode === "demo" ? "demo@nordicjobmatch.ai" : authEmail;
    const password = mode === "demo" ? "DemoPassword123" : authPassword;

    if (!email || !password) {
      setAuthError("Fyll i både e-post och lösenord.");
      setAuthLoading(false);
      return;
    }

    try {
      if (mode === "login" || mode === "demo") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          // If demo auto-login fails due to non-existence, automatically register it
          if (mode === "demo" && error.message.toLowerCase().includes("invalid login")) {
            await handleAuth("signup");
            return;
          }
          setAuthError(error.message);
          setAuthLoading(false);
          return;
        }

        setUser(data.user);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) {
          setAuthError(error.message);
          setAuthLoading(false);
          return;
        }

        if (data.user) {
          // Explicitly create profile record. Cast to any to bypass Supabase schema typing bugs.
          const { error: profileError } = (await supabase.from("profiles").insert({
            id: data.user.id,
            email: data.user.email ?? email,
            full_name: email === "demo@nordicjobmatch.ai" ? "Nordisk Testare" : email.split("@")[0] || "Användare",
            country_code: "SE",
            current_status: "actively_looking",
          } as any)) as any;

          if (profileError) {
            console.error("Profile creation error during registration:", profileError);
          }

          // Sign in after signup
          await supabase.auth.signInWithPassword({ email, password });
        }
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Ett fel uppstod.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setResults(null);
    setCvData(null);
    setError(null);
  };

  // Drag & Drop Operations
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type !== "application/pdf") {
        setError("Endast PDF-filer stöds.");
        return;
      }
      await processFile(file);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const processFile = async (file: File) => {
    if (!user) {
      setError("Du måste logga in för att kunna ladda upp ett CV.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResults(null);
    setCvData(null);

    try {
      setProcessingStep("Laddar upp ditt CV...");
      const formData = new FormData();
      formData.append("cv", file);

      // 1. Process CV (Gemini API pipeline)
      const uploadResult = await uploadAndProcessCv(formData, user.id);

      if (!uploadResult.success) {
        setError(`Fel vid tolkning av CV (Steg: ${uploadResult.error.step}): ${uploadResult.error.message}`);
        setIsProcessing(false);
        return;
      }

      setProcessingStep("Analyserar certifikat och översätter kompetenser...");
      setCvData(uploadResult.data.structuredData);

      // 2. Fetch matches using custom vector search and gap analysis
      setProcessingStep("Söker efter optimala jobbmatchningar i Norden...");
      const matches = await getMatchesForUser(user.id, { limit: 5 });
      setResults(matches);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Ett okänt fel uppstod vid bearbetningen.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Helper for country names
  const getCountryLabel = (code: string) => {
    switch (code) {
      case "SE":
        return "Sverige (SE)";
      case "NO":
        return "Norge (NO)";
      case "DK":
        return "Danmark (DK)";
      case "FI":
        return "Finland (FI)";
      default:
        return code;
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center bg-surface-0 px-4 py-12 relative overflow-hidden">
      {/* Aurora background glow effect */}
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

      <div className="max-w-4xl w-full flex flex-col items-center">
        {/* Header Navigation Area */}
        <div className="w-full flex justify-between items-center mb-16">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-aurora-green to-aurora-blue animate-pulse-glow" />
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-neutral-400 bg-clip-text text-transparent">
              Nordic JobMatch AI
            </span>
          </div>

          {user && !loadingUser && (
            <div className="flex items-center gap-4 bg-surface-1 border border-neutral-800 rounded-full px-4 py-2 text-sm">
              <span className="text-neutral-400 max-w-[150px] truncate">
                {user.email}
              </span>
              <button
                onClick={handleSignOut}
                className="text-error font-medium hover:underline focus:outline-none"
              >
                Logga ut
              </button>
            </div>
          )}
        </div>

        {/* Hero Section */}
        <div className="text-center max-w-2xl mb-12 animate-fade-in">
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white mb-6">
            Hitta ditt nästa jobb{" "}
            <span className="bg-gradient-to-r from-aurora-green via-aurora-teal to-aurora-blue bg-clip-text text-transparent">
              över gränserna
            </span>{" "}
            i Norden
          </h2>
          <p className="text-lg text-neutral-400 leading-relaxed">
            Ladda upp ditt CV på svenska, norska eller engelska. Vår AI-motor
            översätter dina kompetenser, analyserar lokala certifikat och
            matchar dig direkt mot lediga jobb i hela Norden.
          </p>
        </div>

        {/* Central Card Area (Auth or Upload) */}
        <div className="w-full max-w-lg mb-12 animate-slide-up">
          {loadingUser ? (
            <div className="w-full h-64 flex items-center justify-center bg-surface-1 border border-neutral-800 rounded-2xl">
              <div className="h-8 w-8 rounded-full border-4 border-neutral-800 border-t-aurora-teal animate-spin" />
            </div>
          ) : !user ? (
            /* Authentication Panel */
            <div className="w-full bg-surface-1 border border-neutral-800 rounded-2xl p-8 shadow-xl">
              <h3 className="text-xl font-bold text-white mb-2">Kom igång med matchning</h3>
              <p className="text-sm text-neutral-400 mb-6">
                Logga in eller skapa ett testkonto för att testa vår AI-motor.
              </p>

              {authError && (
                <div className="mb-4 p-3 bg-error/10 border border-error/20 text-error rounded-lg text-sm">
                  {authError}
                </div>
              )}

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                    E-postadress
                  </label>
                  <input
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="namn@exempel.se"
                    className="w-full bg-surface-2 border border-neutral-800 focus:border-neutral-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                    Lösenord
                  </label>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-surface-2 border border-neutral-800 focus:border-neutral-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleAuth("login")}
                    disabled={authLoading}
                    className="w-full bg-surface-3 hover:bg-neutral-800 text-white font-medium py-3 rounded-xl transition-all text-sm disabled:opacity-50"
                  >
                    Logga in
                  </button>
                  <button
                    onClick={() => handleAuth("signup")}
                    disabled={authLoading}
                    className="w-full bg-surface-3 hover:bg-neutral-800 text-white font-medium py-3 rounded-xl transition-all text-sm disabled:opacity-50"
                  >
                    Skapa konto
                  </button>
                </div>
                <div className="relative flex items-center justify-center my-2">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-neutral-800" />
                  </div>
                  <span className="relative px-3 bg-surface-1 text-xs text-neutral-500 uppercase tracking-wider">
                    Eller
                  </span>
                </div>
                <button
                  onClick={() => handleAuth("demo")}
                  disabled={authLoading}
                  className="w-full bg-gradient-to-r from-aurora-green to-aurora-blue hover:opacity-90 text-neutral-950 font-bold py-3.5 rounded-xl transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {authLoading ? (
                    <div className="h-4 w-4 border-2 border-neutral-950 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    "Kör snabb demo (Auto-login)"
                  )}
                </button>
              </div>
            </div>
          ) : isProcessing ? (
            /* Pipeline Loading Status */
            <div className="w-full flex flex-col items-center justify-center p-12 text-center bg-surface-1 border border-neutral-800 rounded-2xl shadow-xl animate-fade-in">
              <div className="relative w-16 h-16 mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-neutral-800 border-t-aurora-teal animate-spin" />
                <div className="absolute inset-2 rounded-full border-4 border-dashed border-neutral-800 border-b-aurora-blue animate-spin duration-1500" />
              </div>
              <p className="text-lg font-medium text-white mb-2">{processingStep}</p>
              <p className="text-xs text-neutral-500 max-w-xs leading-relaxed">
                Vi tolkar certifikat, översätter kompetenser och gör gränsöverskridande semantisk matchning via pgvector.
              </p>
            </div>
          ) : (
            /* Upload File Drop Area */
            <div className="w-full">
              <form onSubmit={(e) => e.preventDefault()} onDragEnter={handleDrag} className="w-full">
                <label
                  htmlFor="cv-upload"
                  className={`flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300 ${
                    dragActive
                      ? "border-aurora-green bg-surface-2 scale-[1.01]"
                      : "border-neutral-800 bg-surface-1 hover:bg-surface-2 hover:border-neutral-700"
                  }`}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                >
                  <div className="flex flex-col items-center justify-center pt-5 pb-6 px-4 text-center">
                    <svg
                      className="w-12 h-12 text-neutral-400 mb-4 group-hover:text-neutral-300"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                      />
                    </svg>
                    <p className="mb-2 text-sm text-neutral-200">
                      <span className="font-semibold">Klicka för att välja</span> eller dra och släpp ditt CV här
                    </p>
                    <p className="text-xs text-neutral-500 mb-1">
                      Endast PDF-format stöds (max 4MB)
                    </p>
                  </div>
                  <input
                    id="cv-upload"
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={handleFileChange}
                    disabled={isProcessing}
                  />
                </label>
              </form>
            </div>
          )}
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="w-full max-w-lg mb-8 p-4 bg-error/10 border border-error/20 text-error rounded-2xl text-sm flex items-start gap-3 animate-fade-in">
            <svg
              className="w-5 h-5 mt-0.5 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="font-semibold">Bearbetningsfel</p>
              <p className="mt-1 text-neutral-300 leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {/* CV Structured Profile summary */}
        {cvData && (
          <div className="w-full bg-surface-1 border border-neutral-800 rounded-2xl p-6 mb-8 shadow-md animate-slide-up">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-aurora-green" />
              Analyserad CV-profil: {cvData.personal?.full_name}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-neutral-300">
              <div>
                <span className="block text-neutral-500 text-xs">E-post</span>
                <span className="truncate block">{cvData.personal?.email || "Ej angivet"}</span>
              </div>
              <div>
                <span className="block text-neutral-500 text-xs">Ort</span>
                <span>
                  {cvData.personal?.location?.city
                    ? `${cvData.personal.location.city}, ${cvData.personal.location.country_code}`
                    : "Ej angivet"}
                </span>
              </div>
              <div>
                <span className="block text-neutral-500 text-xs">Erfarenheter</span>
                <span>{cvData.experiences?.length || 0} st roller</span>
              </div>
              <div>
                <span className="block text-neutral-500 text-xs">Certifikat &amp; Körkort</span>
                <span>{cvData.certifications?.length || 0} st registrerade</span>
              </div>
            </div>
            {cvData.professional_summary && (
              <div className="mt-4 pt-4 border-t border-neutral-800">
                <span className="block text-neutral-500 text-xs mb-1">Sammanfattning</span>
                <p className="italic text-neutral-400 text-sm">
                  "{cvData.professional_summary}"
                </p>
              </div>
            )}
          </div>
        )}

        {/* Job posting match results list */}
        {results && results.length > 0 && (
          <div className="w-full animate-slide-up">
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              Hittade jobbmatchningar i Norden
              <span className="text-xs font-normal text-neutral-500 px-2 py-0.5 bg-surface-1 border border-neutral-800 rounded-full">
                {results.length} resultat
              </span>
            </h3>

            <div className="space-y-4">
              {results.map((match, index) => (
                <div
                  key={match.job_posting.id || index}
                  className="bg-surface-1 border border-neutral-800 rounded-2xl p-6 transition-all duration-300 hover:border-neutral-700 hover:shadow-md"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                    <div>
                      <h4 className="text-lg font-bold text-white hover:text-aurora-teal transition-colors">
                        {match.job_posting.title}
                      </h4>
                      <p className="text-sm text-neutral-400">
                        {match.job_posting.company} &bull; {match.job_posting.location} &bull;{" "}
                        <span className="text-neutral-500 text-xs font-medium bg-surface-2 border border-neutral-800 px-2 py-0.5 rounded-full">
                          {getCountryLabel(match.job_posting.country)}
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <span className="inline-block text-xs font-bold uppercase tracking-wider text-aurora-green bg-aurora-green/10 border border-aurora-green/20 px-3 py-1 rounded-full">
                          {Math.round(match.match_score * 100)}% Match
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* AI Explanation / Fallback Deterministic Explanation */}
                  <p className="text-sm text-neutral-300 leading-relaxed mb-4 p-3.5 bg-surface-2 border border-neutral-850 rounded-xl">
                    {match.explanation_summary}
                  </p>

                  {/* Hard Prerequisites / Gap analysis */}
                  <div className="flex flex-wrap items-center gap-2 text-xs border-t border-neutral-850 pt-4 mt-2">
                    <span className="text-neutral-500 font-medium mr-2">Formella krav:</span>
                    {match.missing_prerequisites.length === 0 ? (
                      <span className="text-success font-semibold flex items-center gap-1">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2.5"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        Uppfyller alla formella krav
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {match.job_posting.hard_requirements.map((req, rIdx) => {
                          const isMissing = match.missing_prerequisites.includes(req);
                          return (
                            <span
                              key={rIdx}
                              className={`px-2 py-0.5 rounded-md font-medium border ${
                                isMissing
                                  ? "text-error bg-error/5 border-error/20"
                                  : "text-neutral-400 bg-neutral-800 border-neutral-750"
                              }`}
                            >
                              {req} {isMissing ? "(saknas)" : "✓"}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {match.job_posting.source_url && (
                      <a
                        href={match.job_posting.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-aurora-blue font-bold hover:underline inline-flex items-center gap-1"
                      >
                        Visa annons
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer / System Status indicators */}
      <footer className="mt-24 text-center text-xs text-neutral-600 flex flex-col items-center gap-4">
        <p>Nordic JobMatch AI © 2026. Data och tjänster skyddas enligt GDPR för nordiska medborgare.</p>
        <div className="flex flex-wrap justify-center gap-3">
          {[
            { label: "Supabase DB", active: true },
            { label: "pgvector Matcher", active: true },
            { label: "Gemini 2.5 Flash", active: true },
            { label: "Multilingual parser", active: true },
          ].map(({ label, active }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-surface-1 border border-neutral-850"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  active ? "bg-success animate-pulse-glow" : "bg-neutral-500"
                }`}
              />
              <span className="font-medium text-neutral-500">{label}</span>
            </div>
          ))}
        </div>
      </footer>
    </main>
  );
}
