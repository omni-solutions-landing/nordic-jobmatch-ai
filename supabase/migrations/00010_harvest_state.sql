-- Cursor persistence for incremental feed harvesters.
--
-- The NAV stilling-feed (Arbeidsplassen) is an append-only paginated feed:
-- consumers are expected to remember the last page they processed and walk
-- forward via next_url on each run. Without a persisted cursor a stateless
-- run can only see the newest (often nearly empty) page.

CREATE TABLE IF NOT EXISTS public.harvest_state (
  source     TEXT PRIMARY KEY,
  cursor     TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.harvest_state IS
  'Per-source harvester cursors (e.g. NAV feed page id). Service-role access only.';

-- No policies on purpose: with RLS enabled and no policies, only the
-- service-role key (which bypasses RLS) can read or write this table.
ALTER TABLE public.harvest_state ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_harvest_state_updated_at
  BEFORE UPDATE ON public.harvest_state
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);
