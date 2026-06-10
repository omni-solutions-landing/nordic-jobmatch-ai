import type { Metadata } from "next";
import CVUploadForm from "@/components/CVUploadForm";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Ladda upp CV",
  description: "Ladda upp ditt CV och få AI-drivna jobbmatchningar i hela Norden.",
};

export default async function UploadPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Multi-CV support: a user can have several CVs, but at most one is active
  // (enforced by the set_active_cv_profile trigger). Query the active one only —
  // using maybeSingle() without the is_active filter would throw as soon as a
  // user has more than one CV.
  const { data: cvProfile } = await supabase
    .from("cv_profiles")
    .select("structured_data, updated_at")
    .eq("profile_id", user!.id)
    .eq("is_active", true)
    .maybeSingle();

  const hasExistingCv = !!cvProfile?.structured_data;
  const lastUpdated = cvProfile?.updated_at
    ? new Date(cvProfile.updated_at).toLocaleDateString("sv-SE", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-3">
          {hasExistingCv ? "Uppdatera ditt CV" : "Ladda upp ditt CV"}
        </h1>
        <p className="text-neutral-400 leading-relaxed">
          {hasExistingCv
            ? "Ditt CV analyserades senast den " +
              lastUpdated +
              ". Ladda upp en ny version för att uppdatera dina matchningar."
            : "Vi analyserar ditt CV med Gemini AI, extraherar kompetenser och certifikat, och matchar dig mot lediga jobb i Sverige, Norge, Danmark och Finland."}
        </p>
      </div>

      {/* Pipeline steps */}
      <div className="grid grid-cols-4 gap-3 mb-8">
        {[
          { step: "1", label: "Ladda upp", desc: "PDF-fil" },
          { step: "2", label: "AI-analys", desc: "Gemini 2.5" },
          { step: "3", label: "Vektorisering", desc: "768-dim" },
          { step: "4", label: "Matchning", desc: "pgvector" },
        ].map((item) => (
          <div
            key={item.step}
            className="bg-surface-1 border border-neutral-800 rounded-xl p-3 text-center"
          >
            <div className="text-xs font-bold text-aurora-teal mb-1">Steg {item.step}</div>
            <div className="text-sm font-semibold text-white">{item.label}</div>
            <div className="text-xs text-neutral-500 mt-0.5">{item.desc}</div>
          </div>
        ))}
      </div>

      <CVUploadForm profileId={user!.id} hasExistingCv={hasExistingCv} />
    </div>
  );
}
