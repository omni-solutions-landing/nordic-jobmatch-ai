import type { Metadata } from "next";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import type { CvStructuredData } from "@/lib/ai/cv-parser/schema";
import { CvManager } from "@/components/CvManager";
import { DangerZone } from "@/components/DangerZone";
import { NotificationSettings } from "@/components/NotificationSettings";

export const metadata: Metadata = {
  title: "Profil",
  description: "Din analyserade CV-profil och kompetenser.",
};

export default async function ProfilePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch profile and all CV profiles (fully typed via database.types.ts)
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, country_code, current_status, email_notifications_enabled, push_notifications_enabled")
    .eq("id", user!.id)
    .maybeSingle();

  const { data: cvProfiles } = await supabase
    .from("cv_profiles")
    .select("id, filename, is_active, updated_at, structured_data")
    .eq("profile_id", user!.id)
    .order("updated_at", { ascending: false });

  const activeCv = cvProfiles?.find((cv) => cv.is_active) ?? null;
  // structured_data is JSONB — cast after the parser's Zod validation guarantees the shape
  // (see CLAUDE.md gotcha on database.types.ts)
  const cvData = (activeCv?.structured_data as CvStructuredData | undefined) ?? null;

  const lastUpdated = activeCv?.updated_at
    ? new Date(activeCv.updated_at).toLocaleDateString("sv-SE", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2 bg-gradient-to-r from-white via-neutral-200 to-neutral-400 bg-clip-text text-transparent">
          Profilinställningar
        </h1>
        <p className="text-neutral-400">
          Hantera dina uppladdade CV:n, kontouppgifter och integritetsinställningar.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column - Account info and CV Manager */}
        <div className="lg:col-span-1 space-y-6">
          {/* Account info card */}
          <section className="bg-surface-1 border border-neutral-800 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Konto
            </h2>
            <div className="space-y-3 text-sm">
              <div className="bg-surface-2/40 border border-neutral-800/60 rounded-xl p-3">
                <span className="block text-neutral-500 text-xs mb-0.5">Namn</span>
                <span className="text-white font-medium">{profile?.full_name || cvData?.personal?.full_name || "Ej angivet"}</span>
              </div>
              <div className="bg-surface-2/40 border border-neutral-800/60 rounded-xl p-3">
                <span className="block text-neutral-500 text-xs mb-0.5">E-post</span>
                <span className="text-white font-medium truncate block">{user!.email}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-surface-2/40 border border-neutral-800/60 rounded-xl p-3">
                  <span className="block text-neutral-500 text-xs mb-0.5">Land</span>
                  <span className="text-white font-medium">{profile?.country_code || "SE"}</span>
                </div>
                <div className="bg-surface-2/40 border border-neutral-800/60 rounded-xl p-3">
                  <span className="block text-neutral-500 text-xs mb-0.5">Status</span>
                  <span className="text-white font-medium capitalize truncate block">{profile?.current_status?.replace("_", " ") || "Aktiv"}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Notification settings card */}
          <NotificationSettings
            initialEmailEnabled={profile?.email_notifications_enabled ?? true}
            initialPushEnabled={profile?.push_notifications_enabled ?? false}
          />

          {/* CV Manager card */}
          <section className="bg-surface-1 border border-neutral-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7v12m0 0l-4-4m4 4l4-4M16 17V5m0 0l-4 4m4-4l4 4" />
                </svg>
                Dina CV:n
              </h2>
              <Link
                href="/upload"
                className="text-xs font-bold text-aurora-green hover:underline flex items-center gap-0.5"
              >
                + Lägg till
              </Link>
            </div>
            {cvProfiles && cvProfiles.length > 0 ? (
              <CvManager cvs={cvProfiles} />
            ) : (
              <div className="text-center py-6 border border-dashed border-neutral-800 rounded-xl">
                <p className="text-xs text-neutral-500 mb-3">Inget CV uppladdat än.</p>
                <Link
                  href="/upload"
                  className="inline-flex px-3 py-1.5 bg-aurora-green text-neutral-950 text-xs font-bold rounded-lg hover:opacity-90 transition-all"
                >
                  Ladda upp ditt första CV
                </Link>
              </div>
            )}
          </section>

          {/* GDPR Danger Zone */}
          <DangerZone profileId={user!.id} />
        </div>

        {/* Right column - Active CV Details */}
        <div className="lg:col-span-2 space-y-6">
          {cvData ? (
            <>
              {/* CV Summary Section */}
              <section className="bg-surface-1 border border-neutral-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-neutral-800/60">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-aurora-green" />
                    Aktivt CV: {activeCv?.filename}
                  </h2>
                  {lastUpdated && (
                    <span className="text-xs text-neutral-500">Senast synkad: {lastUpdated}</span>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-neutral-300 mb-6">
                  <div className="bg-surface-2/20 border border-neutral-800/40 rounded-xl p-3.5">
                    <span className="block text-neutral-500 text-xs mb-1">Ort</span>
                    <span className="font-medium text-white truncate block">
                      {cvData.personal?.location?.city
                        ? `${cvData.personal.location.city}, ${cvData.personal.location.country_code}`
                        : "Ej angivet"}
                    </span>
                  </div>
                  <div className="bg-surface-2/20 border border-neutral-800/40 rounded-xl p-3.5">
                    <span className="block text-neutral-500 text-xs mb-1">Erfarenheter</span>
                    <span className="font-medium text-white block">{cvData.experiences?.length || 0} roller</span>
                  </div>
                  <div className="bg-surface-2/20 border border-neutral-800/40 rounded-xl p-3.5">
                    <span className="block text-neutral-500 text-xs mb-1">Utbildningar</span>
                    <span className="font-medium text-white block">{cvData.education?.length || 0} st</span>
                  </div>
                  <div className="bg-surface-2/20 border border-neutral-800/40 rounded-xl p-3.5">
                    <span className="block text-neutral-500 text-xs mb-1">Certifikat</span>
                    <span className="font-medium text-white block">{cvData.certifications?.length || 0} st</span>
                  </div>
                </div>

                {cvData.professional_summary && (
                  <div className="pt-4 border-t border-neutral-800/60">
                    <span className="block text-neutral-500 text-xs mb-2">Sammanfattning</span>
                    <p className="italic text-neutral-300 text-sm leading-relaxed bg-surface-2/20 border border-neutral-800/30 rounded-xl p-4">
                      &quot;{cvData.professional_summary}&quot;
                    </p>
                  </div>
                )}
              </section>

              {/* Skills */}
              {cvData.skills && (
                <section className="bg-surface-1 border border-neutral-800 rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-white mb-4">Kompetenser</h2>
                  <div className="space-y-4">
                    {[
                      { label: "Tekniska", items: cvData.skills.technical },
                      { label: "Verktyg & plattformar", items: cvData.skills.tools_and_platforms },
                      { label: "Branschspecifika", items: cvData.skills.industry_specific },
                      { label: "Maskiner & utrustning", items: cvData.skills.machinery_and_equipment },
                      { label: "Mjuka kompetenser", items: cvData.skills.soft },
                    ]
                      .filter((g) => g.items && g.items.length > 0)
                      .map((group) => (
                        <div key={group.label}>
                          <span className="block text-neutral-500 text-xs mb-2">{group.label}</span>
                          <div className="flex flex-wrap gap-1.5">
                            {group.items!.map((skill, i) => (
                              <span
                                key={i}
                                className="px-2.5 py-1 text-xs font-medium text-neutral-300 bg-surface-2 border border-neutral-850 rounded-lg hover:border-neutral-700 transition-all cursor-default"
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </section>
              )}

              {/* Languages */}
              {cvData.languages && cvData.languages.length > 0 && (
                <section className="bg-surface-1 border border-neutral-800 rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-white mb-4">Språk</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {cvData.languages.map((lang, i) => (
                      <div key={i} className="bg-surface-2/40 border border-neutral-800 rounded-xl p-3">
                        <span className="text-sm font-semibold text-white">{lang.language}</span>
                        {lang.proficiency && (
                          <span className="block text-xs text-neutral-500 mt-0.5 capitalize">
                            {lang.proficiency}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Certifications */}
              {cvData.certifications && cvData.certifications.length > 0 && (
                <section className="bg-surface-1 border border-neutral-800 rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-white mb-4">Certifikat & körkort</h2>
                  <div className="space-y-3">
                    {cvData.certifications.map((cert, i) => (
                      <div key={i} className="flex items-start gap-3 bg-surface-2/30 border border-neutral-800 rounded-xl p-4">
                        <div className="h-8 w-8 rounded-lg bg-aurora-teal/10 border border-aurora-teal/20 flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4 text-aurora-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                          </svg>
                        </div>
                        <div>
                          <span className="text-sm font-semibold text-white">{cert.name}</span>
                          {cert.name_english && cert.name_english !== cert.name && (
                            <span className="text-xs text-neutral-500 ml-2">({cert.name_english})</span>
                          )}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-neutral-500">
                            {cert.category && <span className="capitalize">{cert.category.replace("_", " ")}</span>}
                            {cert.nordic_code && <span>Kod: {cert.nordic_code}</span>}
                            {cert.license_classes && cert.license_classes.length > 0 && (
                              <span>Klasser: {cert.license_classes.join(", ")}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            /* No CV active state */
            <section className="bg-surface-1 border border-neutral-800 rounded-2xl p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
              <div className="w-16 h-16 rounded-2xl bg-surface-2 border border-neutral-800 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-white mb-2">Inget aktivt CV valt</h2>
              <p className="text-sm text-neutral-400 mb-6 max-w-sm">
                Välj ett av dina CV:n till vänster som aktivt, eller ladda upp ett nytt för att visa din analyserade profil här.
              </p>
              <Link
                href="/upload"
                className="inline-flex bg-gradient-to-r from-aurora-green to-aurora-blue text-neutral-950 font-bold px-6 py-3 rounded-xl hover:opacity-90 transition-all text-sm shadow-md shadow-aurora-green/10"
              >
                Ladda upp CV
              </Link>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
