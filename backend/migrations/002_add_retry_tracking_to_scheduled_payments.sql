-- Migration: 002_add_retry_tracking_to_scheduled_payments
--
-- Adds retry tracking columns to scheduled_payments so the job can:
--   • record how many broadcast attempts have been made (retry_count)
--   • store the last Stellar error message for debugging (last_error)
--   • prevent re-processing rows that have permanently failed (status = 'failed')
--
-- Safe to run multiple times (all statements are idempotent).

-- 1. retry_count — incremented on every failed broadcast attempt.
--    Defaults to 0 so existing rows are treated as never-attempted.
ALTER TABLE public.scheduled_payments
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

-- 2. last_error — stores the most recent Stellar error message.
--    NULL means no failure has occurred yet.
ALTER TABLE public.scheduled_payments
  ADD COLUMN IF NOT EXISTS last_error TEXT;

-- 3. Extend the status check constraint to include 'failed'.
--    We drop and recreate because ALTER CONSTRAINT is not supported for CHECK in PG < 15.
ALTER TABLE public.scheduled_payments
  DROP CONSTRAINT IF EXISTS scheduled_payments_status_check;

ALTER TABLE public.scheduled_payments
  ADD CONSTRAINT scheduled_payments_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

-- 4. Partial index so the job query (WHERE status = 'pending' AND retry_count < 3)
--    stays fast even as the table grows with completed/failed rows.
CREATE INDEX IF NOT EXISTS idx_scheduled_payments_pending_retryable
  ON public.scheduled_payments (retry_count)
  WHERE status = 'pending';
