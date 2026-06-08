import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import webpush from "web-push";

// Initialize web-push with VAPID keys
if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:support@nordicjobmatch.ai",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

interface NewMatchNotification {
  profileId: string;
  email: string;
  fullName: string;
  emailEnabled: boolean;
  pushEnabled: boolean;
  pushSubscription: any;
  matches: Array<{
    id: string;
    title: string;
    company: string;
    similarity: number;
  }>;
}

/**
 * Sends email notification using Resend REST API
 */
async function sendEmailAlert(
  email: string,
  fullName: string,
  matches: NewMatchNotification["matches"]
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === "re_default_key_placeholder") {
    console.info(`[Notifications] Resend API key is not configured. Email mock sent to ${email}:`, matches);
    return true;
  }

  const matchesHtml = matches
    .map(
      (m) => `
      <div style="margin-bottom: 16px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h3 style="margin: 0 0 4px 0; color: #1e293b;">${m.title}</h3>
        <p style="margin: 0 0 8px 0; color: #64748b; font-size: 14px;">${m.company}</p>
        <span style="background-color: #f1f5f9; color: #475569; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">
          Matchningsscore: ${Math.round(m.similarity * 100)}%
        </span>
      </div>
    `
    )
    .join("");

  const firstMatch = matches[0];
  const subject =
    matches.length === 1 && firstMatch
      ? `Nytt matchande jobb: ${firstMatch.title}`
      : `Vi hittade ${matches.length} nya matchande jobb!`;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>Hej ${fullName}!</h2>
      <p>Vi har hittat nya lediga jobb i Norden som matchar din profil:</p>
      <div style="margin: 20px 0;">
        ${matchesHtml}
      </div>
      <p style="margin-top: 30px;">
        <a href="${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/matches" 
           style="background-color: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Visa alla mina matchningar
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
      <p style="color: #94a3b8; font-size: 12px;">
        Detta mail skickades automatiskt eftersom du har aktiverat e-postaviseringar på Nordic JobMatch AI.
      </p>
    </div>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Nordic JobMatch <noreply@nordicjobmatch.ai>",
        to: email,
        subject: subject,
        html: html,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Notifications] Resend API error: ${errText}`);
      return false;
    }

    console.log(`[Notifications] Email alert successfully sent to ${email}`);
    return true;
  } catch (err) {
    console.error("[Notifications] Failed to send email via Resend:", err);
    return false;
  }
}

/**
 * Sends push notification via Web Push
 */
async function sendPushAlert(
  subscription: any,
  matches: NewMatchNotification["matches"]
): Promise<boolean> {
  if (!subscription) return false;

  const payload = JSON.stringify({
    title: "Nya matchande jobb!",
    body:
      matches.length === 1 && matches[0]
        ? `${matches[0].title} på ${matches[0].company}`
        : `Vi hittade ${matches.length} nya jobb som matchar din profil.`,
    url: "/matches",
  });

  try {
    await webpush.sendNotification(subscription, payload);
    console.log("[Notifications] Push notification successfully sent");
    return true;
  } catch (err) {
    console.error("[Notifications] Web Push notification failed:", err);
    return false;
  }
}

/**
 * Scans active CV profiles, calculates semantic matches, compares against notified matches,
 * stores new matches in the database, and alerts users via their preferred channels.
 */
export async function matchAndAlertUsersOfNewJobs(): Promise<{
  processedUsers: number;
  newMatchesFound: number;
  notificationsSent: number;
}> {
  const supabase = createServiceClient();

  // 1. Fetch active CV profiles with skills embeddings
  const { data: cvProfiles, error: cvsError } = await supabase
    .from("cv_profiles")
    .select("profile_id, skills_embedding")
    .eq("is_active", true);

  if (cvsError || !cvProfiles) {
    console.error("[Notifications] Error fetching active CV profiles:", cvsError);
    return { processedUsers: 0, newMatchesFound: 0, notificationsSent: 0 };
  }

  let processedUsers = 0;
  let newMatchesFound = 0;
  let notificationsSent = 0;

  for (const cv of cvProfiles) {
    if (!cv.skills_embedding) continue;

    // 2. Fetch profile notification settings
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, full_name, email_notifications_enabled, push_notifications_enabled, push_subscription")
      .eq("id", cv.profile_id)
      .single();

    if (profileError || !profile) continue;

    // Check if notifications are enabled
    const emailEnabled = profile.email_notifications_enabled;
    const pushEnabled = profile.push_notifications_enabled;
    if (!emailEnabled && !pushEnabled) continue;

    processedUsers++;

    // 3. Find semantic matches using the existing match_jobs RPC function
    const { data: semanticMatches, error: matchError } = await supabase.rpc("match_jobs", {
      query_embedding: cv.skills_embedding,
      match_threshold: 0.6, // Match score threshold for alerts (60%)
      match_count: 20,
    });

    if (matchError || !semanticMatches || semanticMatches.length === 0) continue;

    // 4. Query already notified matches for this profile
    const { data: notifiedMatches, error: notifiedError } = await supabase
      .from("matches")
      .select("job_posting_id")
      .eq("profile_id", profile.id);

    if (notifiedError) continue;

    const notifiedJobIds = new Set(notifiedMatches?.map((m) => m.job_posting_id) || []);

    // 5. Filter out already notified matches
    const newMatches = semanticMatches.filter((m) => !notifiedJobIds.has(m.id));
    if (newMatches.length === 0) continue;

    newMatchesFound += newMatches.length;

    // 6. Record these new matches in the matches table to prevent double alerting
    const rowsToInsert = newMatches.map((m) => ({
      profile_id: profile.id,
      job_posting_id: m.id,
      match_score: m.similarity,
      status: "saved" as const,
      missing_skills: [] as string[],
    }));

    const { error: insertError } = await supabase.from("matches").insert(rowsToInsert);
    if (insertError) {
      console.error("[Notifications] Error recording matches:", insertError);
      continue;
    }

    // 7. Dispatch alerts
    const alertsToTrigger: Promise<any>[] = [];

    if (emailEnabled) {
      alertsToTrigger.push(sendEmailAlert(profile.email, profile.full_name || "Användare", newMatches));
    }

    if (pushEnabled && profile.push_subscription) {
      alertsToTrigger.push(sendPushAlert(profile.push_subscription, newMatches));
    }

    if (alertsToTrigger.length > 0) {
      await Promise.all(alertsToTrigger);
      notificationsSent++;
    }
  }

  return {
    processedUsers,
    newMatchesFound,
    notificationsSent,
  };
}
