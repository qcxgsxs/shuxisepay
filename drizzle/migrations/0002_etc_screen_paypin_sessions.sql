ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS pay_pin_hash text, ADD COLUMN IF NOT EXISTS pay_reset_token text, ADD COLUMN IF NOT EXISTS must_reset boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS etc_enabled boolean NOT NULL DEFAULT true;
UPDATE public.accounts SET must_reset = true, reset_token = COALESCE(reset_token, md5(random()::text || id::text)), password = '' WHERE password <> '' AND password_hash IS NULL;
UPDATE public.accounts SET password = '' WHERE password <> '' AND password_hash IS NOT NULL;
COMMENT ON COLUMN public.accounts.password IS 'DEPRECATED: always empty; only password_hash is used';
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(), ADD COLUMN IF NOT EXISTS user_agent text, ADD COLUMN IF NOT EXISTS ip text, ADD COLUMN IF NOT EXISTS last_seen timestamptz NOT NULL DEFAULT now(), ADD COLUMN IF NOT EXISTS impersonated_by uuid;
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.currencies ADD COLUMN IF NOT EXISTS rate_sign smallint NOT NULL DEFAULT 1;