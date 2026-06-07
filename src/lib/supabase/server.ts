/**
 * Supabase Client — Server
 *
 * Creates Supabase clients for use in Server Components, Server Actions,
 * and Route Handlers. Two variants:
 *
 *   1. `createServerClient()` — Uses the anon key + user cookies (RLS-aware).
 *   2. `createServiceClient()` — Uses the service_role key (bypasses RLS).
 *      Only use this for server-side operations like harvesters and admin tasks.
 */

import { createServerClient as _createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";

/**
 * Server client that respects RLS via the user's auth cookie.
 * Use in Server Components, Server Actions, and Route Handlers.
 */
export async function createServerClient() {
  const cookieStore = await cookies();

  return _createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll can throw in Server Components (read-only context).
            // This is expected — the middleware handles cookie refresh.
          }
        },
      },
    },
  );
}

/**
 * Admin client that bypasses RLS entirely.
 * ⚠️  NEVER expose to the client. Server-side only.
 *
 * Use for:
 *  - Job posting harvesters (inserting into job_postings)
 *  - Admin operations
 *  - Background processing
 */
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
