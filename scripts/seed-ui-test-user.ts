/**
 * Seeds (or removes) a throwaway confirmed user with a long-filename CV for
 * UI verification of the profile page. NOT for production data.
 *
 * Run:    npx tsx scripts/seed-ui-test-user.ts
 * Clean:  npx tsx scripts/seed-ui-test-user.ts --cleanup
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const EMAIL = "ui-test-cv-card@example.com";
const PASSWORD = "UiTest-CvCard-2026!";

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

async function main(): Promise<void> {
  loadEnvLocal();
  const service = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Remove any previous instance of the test user
  const { data: list } = await service.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === EMAIL);
  if (existing) {
    await service.auth.admin.deleteUser(existing.id);
    console.log("removed existing test user");
  }

  if (process.argv.includes("--cleanup")) {
    console.log("cleanup done");
    return;
  }

  const { data: created, error } = await service.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`);

  const embedding = `[${Array.from({ length: 768 }, () => 0.01).join(",")}]`;
  const { error: insErr } = await service.from("cv_profiles").insert({
    profile_id: created.user.id,
    filename: "CV_Jari_Chaufför_BAS_20260527_slutversion_extra_lang.pdf",
    raw_text: "{}",
    structured_data: {},
    skills_embedding: embedding,
    is_active: true,
  });
  if (insErr) throw new Error(`cv insert failed: ${insErr.message}`);

  console.log(`seeded ${EMAIL} (password: ${PASSWORD})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
