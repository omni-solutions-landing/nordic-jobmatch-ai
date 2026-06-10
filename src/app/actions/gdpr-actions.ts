"use server";

import { createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

export type DeleteResult =
  | { success: true; message?: string }
  | { success: false; error: string };

/**
 * GDPR Art. 17 right to erasure. Purges all user data:
 *   1. Relational data (matches, cv_profiles, profiles) via RPC
 *   2. Authentication account (auth.users) via Admin client
 *   3. Signs the user out and redirects to /login
 */
export async function deleteUserAccountAction(profileId: string): Promise<DeleteResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.id !== profileId) {
    return { success: false, error: "Du har inte behörighet att radera det här kontot." };
  }

  const { data, error } = await supabase.rpc("delete_user_data", {
    target_profile_id: profileId,
  });

  if (error) {
    console.error("GDPR data deletion RPC failed:", error);
    return { success: false, error: `Kunde inte radera kontodata: ${error.message}` };
  }

  // 2. Delete auth user (requires service role bypass client)
  try {
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { error: authError } = await adminClient.auth.admin.deleteUser(profileId);
    if (authError) {
      console.error("GDPR auth deletion failed:", authError);
      return { success: false, error: `Kunde inte radera användarkonto: ${authError.message}` };
    }
  } catch (err) {
    console.error("GDPR admin client failure:", err);
    return { success: false, error: "Ett internt fel uppstod vid radering av kontot." };
  }

  // 3. Log deletion for compliance audit trail (contains only metadata, no personal data)
  console.log(
    JSON.stringify({
      event: "user_data_deleted",
      profile_id: profileId,
      result: data,
      timestamp: new Date().toISOString(),
    })
  );

  // 4. Sign out
  await supabase.auth.signOut();

  redirect("/login");
}
