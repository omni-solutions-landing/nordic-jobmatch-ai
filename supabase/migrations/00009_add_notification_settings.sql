-- ============================================================================
-- Nordic JobMatch AI — Migration: Add Notification Settings to Profiles
-- Version:  00009
-- Date:     2026-06-08
-- ============================================================================

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS push_subscription JSONB DEFAULT NULL;

COMMENT ON COLUMN public.profiles.email_notifications_enabled IS 'Flag indicating if the user wants to receive match notifications via email.';
COMMENT ON COLUMN public.profiles.push_notifications_enabled IS 'Flag indicating if the user has subscribed to push notifications.';
COMMENT ON COLUMN public.profiles.push_subscription IS 'Web Push subscription object (endpoint, expirationTime, keys).';
