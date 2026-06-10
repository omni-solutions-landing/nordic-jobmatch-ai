import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nordic JobMatch AI",
    short_name: "NordicJobMatch",
    description: "AI-driven cross-border job matching across the Nordics.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#10b981",
    // Next's Manifest type only allows a single purpose per icon, so the
    // "any maskable" combination is expressed as separate entries.
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
