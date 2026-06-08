export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-surface-0 px-4 py-12 relative overflow-hidden">
      {/* Aurora background */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -top-1/4 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full opacity-15 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, var(--color-aurora-green), var(--color-aurora-teal), var(--color-aurora-blue), transparent 70%)",
          }}
        />
      </div>

      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-aurora-green to-aurora-blue animate-pulse-glow" />
        <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-neutral-400 bg-clip-text text-transparent">
          Nordic JobMatch AI
        </span>
      </div>

      {children}
    </main>
  );
}
