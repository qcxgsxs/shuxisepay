alter table public.accounts add column if not exists password_hash text;
alter table public.accounts alter column password set default '';