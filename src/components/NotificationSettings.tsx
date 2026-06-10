"use client";

import { useState, useEffect } from "react";
import { updateNotificationPreferences, savePushSubscription } from "@/app/actions/notification-actions";
import type { Json } from "@/lib/database.types";

interface NotificationSettingsProps {
  readonly initialEmailEnabled: boolean;
  readonly initialPushEnabled: boolean;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function NotificationSettings({
  initialEmailEnabled,
  initialPushEnabled,
}: NotificationSettingsProps) {
  const [emailEnabled, setEmailEnabled] = useState(initialEmailEnabled);
  const [pushEnabled, setPushEnabled] = useState(initialPushEnabled);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window
    ) {
      // Browser feature detection can only run on the client; setting it in
      // an initializer would break SSR hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsSupported(true);
    }
  }, []);

  const handleEmailToggle = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    const nextState = !emailEnabled;

    const result = await updateNotificationPreferences(nextState, pushEnabled);
    if (result.success) {
      setEmailEnabled(nextState);
      setSuccessMsg("E-postinställningar sparades.");
    } else {
      setErrorMsg("Kunde inte spara inställningar: " + result.error.message);
    }
    setLoading(false);
  };

  const handlePushToggle = async () => {
    if (!isSupported) {
      setErrorMsg("Push-notiser stöds inte av din webbläsare.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const nextState = !pushEnabled;

    try {
      if (nextState) {
        // Request permission
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setErrorMsg("Tillåtelse för aviseringar nekades.");
          setLoading(false);
          return;
        }

        // Get Service Worker registration
        const registration = await navigator.serviceWorker.ready;
        
        // VAPID Public Key
        const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidPublicKey) {
          setErrorMsg("VAPID public key saknas i konfigurationen.");
          setLoading(false);
          return;
        }

        const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

        // Subscribe user
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedVapidKey,
        });

        // Save subscription
        const result = await savePushSubscription(subscription.toJSON() as Json);
        if (result.success) {
          setPushEnabled(true);
          setSuccessMsg("Push-notiser har aktiverats.");
        } else {
          setErrorMsg("Kunde inte spara push-prenumeration: " + result.error.message);
        }
      } else {
        // Unsubscribe
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
        }

        // Delete from database
        const result = await savePushSubscription(null);
        if (result.success) {
          setPushEnabled(false);
          setSuccessMsg("Push-notiser inaktiverade.");
        } else {
          setErrorMsg("Kunde inte ta bort push-prenumeration: " + result.error.message);
        }
      }
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg("Ett fel uppstod vid konfiguration av push-notiser: " + message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-surface-1 border border-neutral-800 rounded-2xl p-6">
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <svg
          className="w-5 h-5 text-neutral-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        Aviseringar
      </h2>

      <p className="text-xs text-neutral-400 mb-6">
        Få automatiska notiser direkt när nya jobb matchar din profil vid den dagliga skanningen.
      </p>

      {errorMsg && (
        <div className="mb-4 p-3 bg-red-950/40 border border-red-900/50 text-red-200 text-xs rounded-xl">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="mb-4 p-3 bg-emerald-950/40 border border-emerald-900/50 text-emerald-200 text-xs rounded-xl">
          {successMsg}
        </div>
      )}

      <div className="space-y-4">
        {/* Email toggle */}
        <div className="flex items-center justify-between p-3 bg-surface-2/40 border border-neutral-800/60 rounded-xl">
          <div>
            <span className="block text-sm font-semibold text-white">E-postaviseringar</span>
            <span className="text-xs text-neutral-500">Skicka mail vid nya matchningar</span>
          </div>
          <button
            onClick={handleEmailToggle}
            disabled={loading}
            className={`w-10 h-6 rounded-full transition-colors relative outline-none ${
              emailEnabled ? "bg-aurora-green" : "bg-neutral-800"
            } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            aria-label="Toggle Email Notifications"
          >
            <span
              className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${
                emailEnabled ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Push toggle */}
        <div className="flex items-center justify-between p-3 bg-surface-2/40 border border-neutral-800/60 rounded-xl">
          <div>
            <span className="block text-sm font-semibold text-white">Push-notiser</span>
            <span className="text-xs text-neutral-500">Avisera direkt i webbläsaren</span>
          </div>
          <button
            onClick={handlePushToggle}
            disabled={loading || !isSupported}
            className={`w-10 h-6 rounded-full transition-colors relative outline-none ${
              pushEnabled ? "bg-aurora-green" : "bg-neutral-800"
            } ${loading || !isSupported ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            aria-label="Toggle Push Notifications"
          >
            <span
              className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${
                pushEnabled ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>
    </section>
  );
}
