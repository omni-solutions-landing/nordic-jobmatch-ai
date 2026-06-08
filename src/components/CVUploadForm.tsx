"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { uploadAndProcessCv } from "@/app/actions/cv-actions";

export default function CVUploadForm({
  profileId,
  hasExistingCv,
}: {
  profileId: string;
  hasExistingCv: boolean;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const processFile = useCallback(
    async (file: File) => {
      if (file.type !== "application/pdf") {
        setError("Endast PDF-filer stöds.");
        return;
      }
      if (file.size > 4 * 1024 * 1024) {
        setError("Filen är för stor (max 4 MB).");
        return;
      }

      setIsProcessing(true);
      setError(null);
      setSuccess(false);

      try {
        setProcessingStep("Laddar upp ditt CV...");
        const formData = new FormData();
        formData.append("cv", file);

        setProcessingStep("Analyserar med Gemini AI...");
        const result = await uploadAndProcessCv(formData, profileId);

        if (!result.success) {
          setError(
            `Fel vid ${result.error.step}: ${result.error.message}`
          );
          setIsProcessing(false);
          return;
        }

        setProcessingStep("Klart! Omdirigerar till matchningar...");
        setSuccess(true);

        // Short delay to show success state before navigating
        setTimeout(() => {
          router.push("/matches");
          router.refresh();
        }, 1200);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Ett okänt fel uppstod vid bearbetningen."
        );
        setIsProcessing(false);
      }
    },
    [profileId, router]
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) await processFile(file);
    },
    [processFile]
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await processFile(file);
    },
    [processFile]
  );

  // Processing state
  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-surface-1 border border-neutral-800 rounded-2xl shadow-xl animate-fade-in">
        {success ? (
          <>
            <div className="w-16 h-16 rounded-full bg-success/10 border-2 border-success/30 flex items-center justify-center mb-6">
              <svg className="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-white mb-2">CV analyserat!</p>
            <p className="text-sm text-neutral-400">Omdirigerar till dina matchningar...</p>
          </>
        ) : (
          <>
            <div className="relative w-16 h-16 mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-neutral-800 border-t-aurora-teal animate-spin" />
              <div className="absolute inset-2 rounded-full border-4 border-dashed border-neutral-800 border-b-aurora-blue animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
            </div>
            <p className="text-lg font-medium text-white mb-2">{processingStep}</p>
            <p className="text-xs text-neutral-500 max-w-xs leading-relaxed">
              Vi tolkar certifikat, översätter kompetenser och skapar din semantiska profil.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error */}
      {error && (
        <div className="p-4 bg-error/10 border border-error/20 text-error rounded-xl text-sm flex items-start gap-3 animate-fade-in">
          <svg className="w-5 h-5 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="font-semibold">Bearbetningsfel</p>
            <p className="mt-1 text-neutral-300">{error}</p>
          </div>
        </div>
      )}

      {/* Drop zone */}
      <form onSubmit={(e) => e.preventDefault()} onDragEnter={handleDrag}>
        <label
          htmlFor="cv-upload"
          className={`flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300 ${
            dragActive
              ? "border-aurora-green bg-aurora-green/5 scale-[1.01]"
              : "border-neutral-800 bg-surface-1 hover:bg-surface-2 hover:border-neutral-700"
          }`}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
        >
          <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-surface-2 border border-neutral-800 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="mb-2 text-sm text-neutral-200">
              <span className="font-semibold text-white">Klicka för att välja</span> eller dra och släpp
            </p>
            <p className="text-xs text-neutral-500">
              Endast PDF • Max 4 MB • Svenska, norska eller engelska
            </p>
          </div>
          <input
            id="cv-upload"
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={handleFileChange}
          />
        </label>
      </form>

      {/* Existing CV notice */}
      {hasExistingCv && (
        <div className="p-4 bg-info/5 border border-info/20 rounded-xl text-sm text-neutral-300 flex items-start gap-3">
          <svg className="w-5 h-5 text-info mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>
            Du har redan ett analyserat CV. Ladda upp en ny version för att uppdatera din profil
            och få nya matchningar.
          </p>
        </div>
      )}
    </div>
  );
}
