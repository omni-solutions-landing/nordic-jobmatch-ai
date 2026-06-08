import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import PWAProvider from "@/components/PWAProvider";
import { CookieConsent } from "@/components/CookieConsent";
import "../globals.css";

export const metadata: Metadata = {
  title: {
    default: "Nordic JobMatch AI",
    template: "%s | Nordic JobMatch AI",
  },
  description:
    "AI-powered cross-border job matching across Sweden, Norway, Denmark, and Finland. " +
    "Upload your CV and discover opportunities across the Nordics.",
  keywords: [
    "Nordic jobs",
    "Sweden jobs",
    "Norway jobs",
    "Denmark jobs",
    "Finland jobs",
    "cross-border employment",
    "AI job matching",
    "CV parser",
    "Nordic labor market",
  ],
  authors: [{ name: "Nordic JobMatch AI" }],
  openGraph: {
    type: "website",
    locale: "sv_SE",
    siteName: "Nordic JobMatch AI",
    title: "Nordic JobMatch AI — Cross-Border Job Matching",
    description:
      "AI-powered job matching across all Nordic countries. One CV, four countries.",
  },
  robots: {
    index: true,
    follow: true,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Nordic JobMatch",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#10b981",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Validate locale
  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  // Fetch translation messages
  const messages = await getMessages();

  return (
    <html lang={locale} className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased bg-neutral-950 text-neutral-100">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <PWAProvider>
            {children}
            <CookieConsent />
          </PWAProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}
