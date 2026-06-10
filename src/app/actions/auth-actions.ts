"use server";

import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type AuthResult =
  | { success: true }
  | { success: false; error: string };

export async function loginAction(formData: FormData): Promise<AuthResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { success: false, error: "Fyll i både e-post och lösenord." };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { success: false, error: error.message };
  }

  redirect("/upload");
}

export async function registerAction(formData: FormData): Promise<AuthResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const fullName = (formData.get("fullName") as string) || email.split("@")[0] || "Användare";

  if (!email || !password) {
    return { success: false, error: "Fyll i både e-post och lösenord." };
  }

  if (password.length < 6) {
    return { success: false, error: "Lösenordet måste vara minst 6 tecken." };
  }

  const supabase = await createServerClient();

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { success: false, error: error.message };
  }

  if (data.user) {
    // Create profile record (the on_auth_user_created trigger also does this;
    // ON CONFLICT in the trigger makes the duplicate attempt harmless)
    const { error: profileError } = await supabase.from("profiles").insert({
      id: data.user.id,
      email: data.user.email ?? email,
      full_name: fullName,
      country_code: "SE",
      current_status: "actively_looking",
    });

    if (profileError) {
      console.error("Profile creation error:", profileError);
    }
  }

  redirect("/upload");
}

export async function forgotPasswordAction(formData: FormData): Promise<AuthResult> {
  const email = formData.get("email") as string;

  if (!email) {
    return { success: false, error: "Ange din e-postadress." };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/auth/callback?type=recovery`,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function demoLoginAction(): Promise<AuthResult> {
  const supabase = await createServerClient();
  const email = "demo@nordicjobmatch.ai";
  const password = "DemoPassword123";

  // Try login first
  const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });

  if (loginError) {
    // If user doesn't exist, create it
    if (loginError.message.toLowerCase().includes("invalid login")) {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });

      if (signUpError) {
        return { success: false, error: signUpError.message };
      }

      if (data.user) {
        const { error: profileError } = await supabase.from("profiles").insert({
          id: data.user.id,
          email,
          full_name: "Nordisk Testare",
          country_code: "SE",
          current_status: "actively_looking",
        });

        if (profileError) console.error("Demo profile creation error:", profileError);

        // Sign in after signup
        await supabase.auth.signInWithPassword({ email, password });
      }
    } else {
      return { success: false, error: loginError.message };
    }
  }

  redirect("/upload");
}
