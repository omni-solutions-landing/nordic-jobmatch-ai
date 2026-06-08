"use client";

import { useEffect, useState } from "react";

export function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Consent state
  const [consent, setConsent] = useState({
    essential: true, // Always true
    analytics: false,
    marketing: false,
  });

  useEffect(() => {
    // Check if consent already exists
    const stored = localStorage.getItem("nordic-jobmatch-cookie-consent");
    if (!stored) {
      setShowBanner(true);
    } else {
      try {
        const parsed = JSON.parse(stored);
        setConsent({ ...parsed, essential: true });
      } catch (e) {
        setShowBanner(true);
      }
    }
  }, []);

  const handleAcceptAll = () => {
    const newConsent = { essential: true, analytics: true, marketing: true };
    setConsent(newConsent);
    localStorage.setItem("nordic-jobmatch-cookie-consent", JSON.stringify(newConsent));
    setShowBanner(false);
  };

  const handleRejectAll = () => {
    const newConsent = { essential: true, analytics: false, marketing: false };
    setConsent(newConsent);
    localStorage.setItem("nordic-jobmatch-cookie-consent", JSON.stringify(newConsent));
    setShowBanner(false);
  };

  const handleSaveSettings = () => {
    localStorage.setItem("nordic-jobmatch-cookie-consent", JSON.stringify(consent));
    setShowBanner(false);
    setShowSettings(false);
  };

  if (!showBanner) {
    return (
      // Small persistent link in the footer/corner to reopen settings
      <button
        onClick={() => {
          setShowBanner(true);
          setShowSettings(true);
        }}
        className="fixed bottom-4 left-4 z-40 bg-surface-2 hover:bg-surface-3 border border-neutral-800 text-neutral-400 hover:text-white px-3 py-1.5 text-xs font-semibold rounded-lg shadow-xl transition-all"
      >
        Cookie-inställningar
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-4 sm:p-6 bg-gradient-to-t from-neutral-950/90 to-neutral-950/40 backdrop-blur-md">
      <div className="max-w-4xl mx-auto bg-surface-1 border border-neutral-800 rounded-2xl shadow-2xl p-6 sm:p-8 animate-in slide-in-from-bottom duration-300">
        {!showSettings ? (
          <div>
            <h3 className="text-lg font-bold text-white mb-2">Vi bryr oss om din integritet 🍪</h3>
            <p className="text-neutral-400 text-sm leading-relaxed mb-6">
              Vi använder cookies för att förbättra din upplevelse, analysera trafik och för funktionalitet relaterad till jobbsökande. Enligt GDPR har du rätt att välja vilka cookies du godkänner. Läs mer i vår{" "}
              <a href="/privacy" className="text-aurora-green hover:underline">
                integritetspolicy
              </a>
              .
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-end items-center">
              <button
                onClick={() => setShowSettings(true)}
                className="w-full sm:w-auto px-4 py-2 bg-surface-2 hover:bg-surface-3 border border-neutral-800 text-neutral-300 hover:text-white text-sm font-semibold rounded-xl transition-all text-center"
              >
                Anpassa val
              </button>
              
              {/* Equal Prominence for Reject and Accept */}
              <button
                onClick={handleRejectAll}
                className="w-full sm:w-auto px-5 py-2.5 bg-surface-2 hover:bg-surface-3 border border-neutral-700 hover:border-neutral-600 text-white text-sm font-semibold rounded-xl transition-all text-center"
              >
                Avvisa alla (Endast nödvändiga)
              </button>
              <button
                onClick={handleAcceptAll}
                className="w-full sm:w-auto px-5 py-2.5 bg-aurora-green hover:bg-opacity-95 text-neutral-950 text-sm font-bold rounded-xl transition-all text-center shadow-lg shadow-aurora-green/10"
              >
                Godkänn alla
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h3 className="text-lg font-bold text-white mb-4">Anpassa cookie-inställningar</h3>
            <div className="space-y-4 mb-6">
              {/* Essential */}
              <div className="flex items-start justify-between p-4 bg-surface-2/40 border border-neutral-800/60 rounded-xl">
                <div className="pr-4">
                  <h4 className="text-sm font-semibold text-white">Nödvändiga (Essential)</h4>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Krävs för att applikationen ska fungera, till exempel för att hålla dig inloggad och spara dina val. Dessa kan inte stängas av.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={true}
                  disabled={true}
                  className="h-4 w-4 rounded border-neutral-800 bg-surface-2 text-aurora-green focus:ring-0 focus:ring-offset-0 shrink-0 cursor-not-allowed accent-aurora-green"
                />
              </div>

              {/* Analytics */}
              <div className="flex items-start justify-between p-4 bg-surface-2/40 border border-neutral-800/60 rounded-xl">
                <div className="pr-4">
                  <h4 className="text-sm font-semibold text-white">Analys & Statistik</h4>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Hjälper oss att förstå hur webbplatsen används så att vi kan förbättra funktionalitet och användarupplevelse.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={consent.analytics}
                  onChange={(e) => setConsent({ ...consent, analytics: e.target.checked })}
                  className="h-4 w-4 rounded border-neutral-800 bg-surface-2 text-aurora-green focus:ring-0 focus:ring-offset-0 shrink-0 cursor-pointer accent-aurora-green"
                />
              </div>

              {/* Marketing */}
              <div className="flex items-start justify-between p-4 bg-surface-2/40 border border-neutral-800/60 rounded-xl">
                <div className="pr-4">
                  <h4 className="text-sm font-semibold text-white">Marknadsföring</h4>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Används för att visa relevanta jobbannonser och anpassat innehåll baserat på dina preferenser.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={consent.marketing}
                  onChange={(e) => setConsent({ ...consent, marketing: e.target.checked })}
                  className="h-4 w-4 rounded border-neutral-800 bg-surface-2 text-aurora-green focus:ring-0 focus:ring-offset-0 shrink-0 cursor-pointer accent-aurora-green"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-end items-center">
              <button
                onClick={() => setShowSettings(false)}
                className="w-full sm:w-auto px-4 py-2 bg-surface-2 hover:bg-surface-3 border border-neutral-800 text-neutral-300 hover:text-white text-sm font-semibold rounded-xl transition-all text-center"
              >
                Tillbaka
              </button>
              <button
                onClick={handleSaveSettings}
                className="w-full sm:w-auto px-5 py-2.5 bg-aurora-green hover:bg-opacity-95 text-neutral-950 text-sm font-bold rounded-xl transition-all text-center"
              >
                Spara val
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
