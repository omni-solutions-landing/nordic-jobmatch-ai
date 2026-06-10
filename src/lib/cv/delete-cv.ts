/**
 * CV deletion — client-injectable core so the flow is testable outside the
 * Next.js Server Action context (see scripts/test-cv-delete.ts).
 *
 * Policy decisions:
 *  - Deleting the ACTIVE CV promotes the most recently updated remaining CV
 *    to active. The matches view treats "no active CV" as "no profile" and
 *    falls back to mock data, so leaving the user without an active CV after
 *    deleting one of several would silently break matching.
 *  - Rows in `matches` are kept. They are the per-user notification audit
 *    log and saved/applied state; they reference profile_id (the user), not
 *    the CV, and deleting them would re-trigger notifications for jobs the
 *    user has already seen. Full cleanup is the GDPR delete RPC's job.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { pickNextActiveCv } from "./next-active";

export interface DeleteCvOutcome {
  readonly deleted: boolean;
  /** Id of the CV promoted to active, when the deleted CV was the active one. */
  readonly promotedCvId: string | null;
  readonly error?: string;
}

export async function deleteCvForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  cvId: string,
): Promise<DeleteCvOutcome> {
  // .select() makes PostgREST return the deleted rows, so an RLS-filtered
  // no-op (0 rows) is distinguishable from a successful delete.
  const { data: deletedRows, error: deleteError } = await supabase
    .from("cv_profiles")
    .delete()
    .eq("id", cvId)
    .eq("profile_id", userId)
    .select("id, is_active");

  if (deleteError) {
    return { deleted: false, promotedCvId: null, error: deleteError.message };
  }

  if (!deletedRows || deletedRows.length === 0) {
    return {
      deleted: false,
      promotedCvId: null,
      error: "CV:t kunde inte hittas eller har redan raderats.",
    };
  }

  const wasActive = deletedRows.some((row) => row.is_active);
  if (!wasActive) {
    return { deleted: true, promotedCvId: null };
  }

  const { data: remaining, error: remainingError } = await supabase
    .from("cv_profiles")
    .select("id, updated_at")
    .eq("profile_id", userId);

  if (remainingError) {
    // The delete itself succeeded; report success but surface the follow-up
    // problem so the caller can log it.
    return {
      deleted: true,
      promotedCvId: null,
      error: `CV raderat, men nästa CV kunde inte aktiveras: ${remainingError.message}`,
    };
  }

  const next = pickNextActiveCv(remaining ?? []);
  if (!next) {
    return { deleted: true, promotedCvId: null };
  }

  // The set_active_cv_profile trigger deactivates all other CVs for the user.
  const { error: promoteError } = await supabase
    .from("cv_profiles")
    .update({ is_active: true })
    .eq("id", next.id)
    .eq("profile_id", userId);

  if (promoteError) {
    return {
      deleted: true,
      promotedCvId: null,
      error: `CV raderat, men nästa CV kunde inte aktiveras: ${promoteError.message}`,
    };
  }

  return { deleted: true, promotedCvId: next.id };
}
