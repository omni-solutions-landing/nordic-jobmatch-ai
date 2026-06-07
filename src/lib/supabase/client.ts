/**
 * Supabase Client — Browser
 *
 * Creates a Supabase client for use in Client Components.
 * Uses the anon key and respects RLS policies.
 * Gracefully handles missing environment variables during build time prerendering.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Return a dummy proxy to prevent prerendering / build-time crashes
    return new Proxy({} as any, {
      get(target, prop) {
        if (prop === "auth") {
          return {
            getUser: async () => ({ data: { user: null }, error: null }),
            onAuthStateChange: () => ({
              data: { subscription: { unsubscribe: () => {} } },
            }),
          };
        }
        return () => ({
          data: null,
          error: null,
        });
      },
    });
  }

  return createBrowserClient<Database>(url, key);
}
