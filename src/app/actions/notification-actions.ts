"use server";

import { createServerClient } from "@/lib/supabase/server";
import { Result, ok, fail } from "@/lib/fp/result";
import { revalidatePath } from "next/cache";

export async function updateNotificationPreferences(
  emailNotificationsEnabled: boolean,
  pushNotificationsEnabled: boolean
): Promise<Result<{ success: boolean }, Error>> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return fail(new Error("Unauthorized"));
    }

    const { error } = await (supabase.from("profiles") as any)
      .update({
        email_notifications_enabled: emailNotificationsEnabled,
        push_notifications_enabled: pushNotificationsEnabled,
      })
      .eq("id", user.id);

    if (error) {
      return fail(new Error(error.message));
    }

    revalidatePath("/profile");
    return ok({ success: true });
  } catch (error: any) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function savePushSubscription(
  subscription: any
): Promise<Result<{ success: boolean }, Error>> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return fail(new Error("Unauthorized"));
    }

    const { error } = await (supabase.from("profiles") as any)
      .update({
        push_subscription: subscription,
        push_notifications_enabled: subscription !== null,
      })
      .eq("id", user.id);

    if (error) {
      return fail(new Error(error.message));
    }

    revalidatePath("/profile");
    return ok({ success: true });
  } catch (error: any) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
}
