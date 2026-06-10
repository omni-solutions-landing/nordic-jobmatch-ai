/**
 * Live end-to-end test of CV deletion (the deleteCvForUser core used by
 * deleteCvAction), running against the real database through an
 * authenticated, RLS-bound client:
 *
 *  1. deleting a non-active CV removes exactly that row
 *  2. deleting the ACTIVE CV promotes the most recently updated remaining CV
 *  3. the deleted rows (incl. skills_embedding) are verifiably gone
 *  4. deleting an unknown id reports failure instead of silent success
 *
 * Creates a throwaway confirmed user and removes it afterwards.
 *
 * Run: npx tsx scripts/test-cv-delete.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { deleteCvForUser } from "@/lib/cv/delete-cv";

function loadEnvLocal(): void {
  const content = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

function assert(cond: boolean, label: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const anon = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  const email = `cv-delete-test-${Date.now()}@example.com`;
  const password = `Test-${Math.random().toString(36).slice(2)}-1234`;

  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) throw new Error(`createUser failed: ${createErr?.message}`);
  const uid = created.user.id;

  try {
    const embedding = `[${Array.from({ length: 768 }, () => 0.01).join(",")}]`;

    async function insertCv(filename: string, active: boolean): Promise<string> {
      const { data, error } = await service
        .from("cv_profiles")
        .insert({
          profile_id: uid,
          filename,
          raw_text: "{}",
          structured_data: {},
          skills_embedding: embedding,
          is_active: active,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`insert ${filename} failed: ${error?.message}`);
      return data.id;
    }

    // Three CVs; cv3 inserted last with is_active=true (trigger deactivates others)
    const cv1 = await insertCv("cv1.pdf", false);
    const cv2 = await insertCv("cv2.pdf", false);
    const cv3 = await insertCv("cv3-active.pdf", true);

    const { error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`);

    // 1. Delete a non-active CV
    const r1 = await deleteCvForUser(anon, uid, cv1);
    assert(r1.deleted && r1.promotedCvId === null, "non-active CV deleted without promotion");

    // 2. Delete the ACTIVE CV → cv2 (most recently updated remaining) promoted
    const r2 = await deleteCvForUser(anon, uid, cv3);
    assert(r2.deleted, "active CV deleted");
    assert(r2.promotedCvId === cv2, "remaining CV promoted to active");

    const { data: afterRows } = await service
      .from("cv_profiles")
      .select("id, is_active, skills_embedding")
      .eq("profile_id", uid);
    assert((afterRows ?? []).length === 1, "exactly one CV row remains");
    assert(afterRows?.[0]?.id === cv2 && afterRows[0].is_active === true, "remaining CV is active");
    assert(
      !(afterRows ?? []).some((r) => r.id === cv1 || r.id === cv3),
      "deleted rows (incl. skills_embedding) are gone from the database",
    );

    // 3. Deleting an unknown/foreign id fails loudly instead of silently
    const r3 = await deleteCvForUser(anon, uid, "00000000-0000-0000-0000-000000000000");
    assert(!r3.deleted && !!r3.error, "deleting unknown CV id reports an error");

    // 4. Delete the last CV → no promotion target, user has zero CVs
    const r4 = await deleteCvForUser(anon, uid, cv2);
    assert(r4.deleted && r4.promotedCvId === null, "last CV deleted, nothing to promote");

    const { count } = await service
      .from("cv_profiles")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", uid);
    assert(count === 0, "no CV rows remain for the user");
  } finally {
    await service.auth.admin.deleteUser(uid);
    console.log("test user removed");
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
