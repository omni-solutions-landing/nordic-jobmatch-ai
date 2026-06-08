-- ============================================================================
-- Nordic JobMatch AI — Migration: Add source_platform column to job_postings
-- Version:  00008
-- Date:     2026-06-08
-- ============================================================================

-- Add source_platform column
ALTER TABLE public.job_postings
ADD COLUMN source_platform TEXT NOT NULL DEFAULT 'platsbanken';

-- Create index for fast filtering by platform
CREATE INDEX idx_job_postings_source_platform ON public.job_postings(source_platform);

-- Update existing rows based on country
UPDATE public.job_postings
SET source_platform = 'platsbanken'
WHERE country = 'SE';

UPDATE public.job_postings
SET source_platform = 'arbeidsplassen'
WHERE country = 'NO';

COMMENT ON COLUMN public.job_postings.source_platform IS 'Source platform of the job posting (e.g. platsbanken, arbeidsplassen, indeed, jobindex, duunitori, blocket, facebook).';
