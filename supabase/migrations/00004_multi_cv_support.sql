-- ============================================================================
-- Nordic JobMatch AI — Migration: Multi-CV Support
-- Version:  00004
-- Date:     2026-06-08
-- ============================================================================

-- Drop the unique CV profile constraint so users can upload multiple CVs
ALTER TABLE public.cv_profiles DROP CONSTRAINT IF EXISTS cv_profiles_one_per_profile;

-- Add filename and is_active columns with defaults
ALTER TABLE public.cv_profiles ADD COLUMN IF NOT EXISTS filename TEXT NOT NULL DEFAULT 'Namnlöst CV';
ALTER TABLE public.cv_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;

-- Create function to automatically manage active CV states
CREATE OR REPLACE FUNCTION public.set_active_cv_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- If the new/updated CV is marked active, deactivate all other CVs for this profile
  IF NEW.is_active = true THEN
    UPDATE public.cv_profiles
    SET is_active = false
    WHERE profile_id = NEW.profile_id AND id != NEW.id;
  END IF;

  -- If it is the first/only CV for the profile, make it active
  IF NOT EXISTS (
    SELECT 1 FROM public.cv_profiles
    WHERE profile_id = NEW.profile_id AND id != NEW.id
  ) THEN
    NEW.is_active = true;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop trigger if exists to avoid errors on reapplying
DROP TRIGGER IF EXISTS trg_set_active_cv_profile ON public.cv_profiles;

-- Bind the trigger
CREATE TRIGGER trg_set_active_cv_profile
  BEFORE INSERT OR UPDATE OF is_active ON public.cv_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_active_cv_profile();

-- Create helper function to activate a specific CV
CREATE OR REPLACE FUNCTION public.make_cv_active(p_cv_profile_id UUID, p_profile_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Updating this row triggers set_active_cv_profile() which deactivates the rest
  UPDATE public.cv_profiles
  SET is_active = true
  WHERE id = p_cv_profile_id AND profile_id = p_profile_id;
END;
$$;

-- Create function to insert new CV profiles safely
CREATE OR REPLACE FUNCTION public.create_cv_profile(
  p_profile_id UUID,
  p_filename TEXT,
  p_raw_text TEXT,
  p_structured_data JSONB,
  p_skills_embedding VECTOR(768)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.cv_profiles (profile_id, filename, raw_text, structured_data, skills_embedding, is_active)
  VALUES (p_profile_id, p_filename, p_raw_text, p_structured_data, p_skills_embedding, true)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
