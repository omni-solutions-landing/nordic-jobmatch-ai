import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Integritetspolicy | Privacy Policy",
  description: "GDPR compliance, cookies, and data deletion policy for Nordic JobMatch AI.",
};

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tNav = await getTranslations("Navigation");

  // Multilingual content
  const content: Record<string, {
    title: string;
    intro: string;
    sections: Array<{ h: string; p: string }>;
    leadDpa: string;
    contact: string;
  }> = {
    sv: {
      title: "Integritetspolicy (GDPR)",
      intro: "Nordic JobMatch AI värnar om din personliga integritet. Denna policy förklarar hur vi samlar in, lagrar, använder och skyddar din information i enlighet med dataskyddsförordningen (GDPR).",
      sections: [
        {
          h: "1. Rättslig grund för behandling",
          p: "Vi behandlar din kontoinformation och dina uppladdade CV-filer på grundval av avtal (Art 6.1.b GDPR) för att kunna erbjuda vår matchningstjänst. För automatiserat beslutsfattande (AI-matchning mot jobb) och delning av profil ber vi om ditt uttryckliga samtycke (Art 22.2.c & Art 6.1.a GDPR)."
        },
        {
          h: "2. Vilka uppgifter behandlas?",
          p: "Vi sparar namn, e-postadress, födelseland (valfritt), samt allt innehåll i de CV-dokument du laddar upp (arbetshistorik, utbildningar, kompetenser och språk). Vi skapar även matematiska vektorembeddings (768 dimensioner) av ditt CV för att utföra matchningen. Dessa vektorer är personuppgifter och raderas i samband med att CV:t tas bort."
        },
        {
          h: "3. Överföring till tredje part",
          p: "Dina CV-data behandlas säkert i Supabase (databas) och Vercel (hosting). CV-analys och embedding sker via Google Gemini API. Vi säljer aldrig dina data och delar dem inte utan ditt medgivande."
        },
        {
          h: "4. Datalagring och retention",
          p: "Dina CV-profiler och embeddings sparas så länge du har ett konto hos oss. Om du väljer att radera ett specifikt CV eller ditt konto tas all data bort permanent inom 30 dagar från våra system och backups."
        },
        {
          h: "5. Dina rättigheter (GDPR)",
          p: "Du har rätt att begära registerutdrag över dina data, rätt till rättelse, samt rätt till radering (rätten att bli bortglömd). Du kan radera ditt konto och all tillhörande data direkt via din profilinställningssida."
        }
      ],
      leadDpa: "Tillsynsmyndighet: Integritetsskyddsmyndigheten (IMY), Sverige.",
      contact: "Kontakt: dpo@nordicjobmatch.ai"
    },
    no: {
      title: "Personvernerklæring (GDPR)",
      intro: "Nordic JobMatch AI ivaretar ditt personvern. Denne erklæringen forklarer hvordan vi samler inn, lagrer, bruker og beskytter informasjonen din i samsvar med GDPR.",
      sections: [
        {
          h: "1. Rettslig grunnlag for behandling",
          p: "Vi behandler kontoinformasjonen din og dine opplastede CV-filer på grunnlag av avtale (Art 6.1.b GDPR). For automatiserte avgjørelser (AI-matching mot jobber) ber vi om ditt samtykke (Art 22.2.c & Art 6.1.a GDPR)."
        },
        {
          h: "2. Hvilke opplysninger behandles?",
          p: "Vi lagrer navn, e-postadresse, land og innholdet i dine opplastede CV-dokumenter (arbeidserfaring, utdanning, kompetanse og språk). Vi genererer også vektorembeddings (768 dimensjoner) av din CV for å utføre søket. Disse slettes når CV-en slettes."
        },
        {
          h: "3. Overføring til tredjepart",
          p: "Dine data lagres sikkert i Supabase og Vercel. CV-analyse og embeddings skjer via Google Gemini API."
        },
        {
          h: "4. Datalagring og sletting",
          p: "Dine CV-profiler og embeddings lagres så lenge du har en aktiv konto. Hvis du sletter kontoen din, slettes all data permanent innen 30 dager."
        },
        {
          h: "5. Dine rettigheter",
          p: "Du har rett til innsyn, retting og sletting (retten til å bli glemt). Du kan slette kontoen din og all tilhørende data direkte under profilsiden."
        }
      ],
      leadDpa: "Tilsynsmyndighet: Datatilsynet, Norge.",
      contact: "Kontakt: dpo@nordicjobmatch.ai"
    },
    en: {
      title: "Privacy Policy (GDPR)",
      intro: "Nordic JobMatch AI respects your personal privacy. This policy explains how we collect, store, use, and protect your information in accordance with the General Data Protection Regulation (GDPR).",
      sections: [
        {
          h: "1. Legal Basis for Processing",
          p: "We process your account information and uploaded CV files based on performance of a contract (Art 6.1.b GDPR). For automated decision-making (AI job matching), we obtain your explicit consent (Art 22.2.c & Art 6.1.a GDPR)."
        },
        {
          h: "2. What Data Is Processed?",
          p: "We store name, email address, country (optional), and the text content of your CV. We generate mathematical vector embeddings (768 dimensions) from your CV for semantic matching. These are personal data and are purged when you delete your CV."
        },
        {
          h: "3. Data Processors",
          p: "Your data is hosted securely in Supabase (database) and Vercel (web app). Parsing and vector embeddings are performed via Google Gemini API."
        },
        {
          h: "4. Data Retention",
          p: "Your CV profiles and embeddings are saved as long as your account is active. If you delete your account or a specific CV, it is permanently purged within 30 days."
        },
        {
          h: "5. Your Rights",
          p: "You have the right of access, rectification, and erasure ('right to be forgotten'). You can delete your account and all associated data instantly in your profile dashboard."
        }
      ],
      leadDpa: "Lead DPA: Integritetsskyddsmyndigheten (IMY), Sweden.",
      contact: "Contact: dpo@nordicjobmatch.ai"
    }
  };

  const activeContent = (content[locale] || content.en) as {
    title: string;
    intro: string;
    sections: Array<{ h: string; p: string }>;
    leadDpa: string;
    contact: string;
  };

  return (
    <main className="min-h-screen bg-surface-0 relative py-12 px-4 sm:px-6 lg:px-8">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute top-0 left-1/2 h-[500px] w-[700px] -translate-x-1/2 rounded-full opacity-10 blur-3xl"
          style={{
            background: "radial-gradient(circle, var(--color-aurora-teal), var(--color-aurora-blue), transparent 70%)",
          }}
        />
      </div>

      <div className="max-w-3xl mx-auto bg-surface-1 border border-neutral-800 rounded-2xl p-6 sm:p-10 shadow-xl">
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-neutral-800">
          <Link
            href="/"
            className="text-xs font-semibold text-neutral-400 hover:text-white flex items-center gap-1 transition-colors"
          >
            ← Hem / Home
          </Link>
          <div className="flex gap-2 text-xs">
            <Link href="/sv/privacy" className={`px-2 py-1 rounded ${locale === "sv" ? "bg-surface-2 text-white font-bold" : "text-neutral-500"}`}>SV</Link>
            <Link href="/no/privacy" className={`px-2 py-1 rounded ${locale === "no" ? "bg-surface-2 text-white font-bold" : "text-neutral-500"}`}>NO</Link>
            <Link href="/en/privacy" className={`px-2 py-1 rounded ${locale === "en" ? "bg-surface-2 text-white font-bold" : "text-neutral-500"}`}>EN</Link>
          </div>
        </div>

        <h1 className="text-3xl font-extrabold text-white tracking-tight mb-4 bg-gradient-to-r from-white via-neutral-200 to-neutral-400 bg-clip-text text-transparent">
          {activeContent.title}
        </h1>
        <p className="text-neutral-400 text-sm leading-relaxed mb-8">
          {activeContent.intro}
        </p>

        <div className="space-y-8 mb-8">
          {activeContent.sections.map((sec, idx) => (
            <section key={idx} className="space-y-2">
              <h2 className="text-base font-bold text-white">{sec.h}</h2>
              <p className="text-neutral-400 text-sm leading-relaxed">{sec.p}</p>
            </section>
          ))}
        </div>

        <div className="pt-6 border-t border-neutral-800 text-xs text-neutral-500 space-y-1">
          <p>{activeContent.leadDpa}</p>
          <p>{activeContent.contact}</p>
        </div>
      </div>
    </main>
  );
}
