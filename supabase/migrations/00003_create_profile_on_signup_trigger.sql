-- ============================================================================
-- Nordic JobMatch AI — Migration: Auto-create Profile Trigger
-- Version:  00003
-- Date:     2026-06-08
-- ============================================================================
-- Automatically inserts a row in public.profiles when a new user signs up
-- in auth.users, preventing foreign key violations during CV uploads.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, country_code, current_status)
  VALUES (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'SE',
    'actively_looking'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- Create the trigger
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
