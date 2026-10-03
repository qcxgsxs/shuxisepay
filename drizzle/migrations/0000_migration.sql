create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password text not null,
  role text not null,
  banned boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  created_by uuid,
  reset_token text,
  created_at timestamptz not null default now()
);
create table public.sessions (token text primary key, account_id uuid not null references public.accounts(id) on delete cascade, created_at timestamptz not null default now());
create table public.currencies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null, symbol text not null default '',
  rate_expr text not null default '1', rate_log10 double precision not null default 0,
  visibility jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.balances (account_id uuid not null references public.accounts(id) on delete cascade, currency_id uuid not null references public.currencies(id) on delete cascade, amount double precision not null default 0, primary key(account_id, currency_id));
create table public.settings (key text primary key, value jsonb not null);
create table public.logs (id bigserial primary key, account_id uuid, username text, role text, action text not null, detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table public.products (
  id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.accounts(id) on delete cascade,
  name text not null, description text not null default '', price double precision not null, currency_id uuid not null references public.currencies(id) on delete cascade,
  stock integer not null default 0, images text[] not null default '{}', videos text[] not null default '{}', area jsonb not null default '{"type":"world"}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(), owner_id uuid references public.accounts(id) on delete set null,
  name text not null, currency_ids uuid[] not null default '{}', fee_normal double precision not null default 30,
  created_at timestamptz not null default now()
);
create table public.api_keys (id uuid primary key default gen_random_uuid(), payment_method_id uuid not null references public.payment_methods(id) on delete cascade, key text not null unique, created_at timestamptz not null default now());
create table public.facilities (
  id uuid primary key default gen_random_uuid(), engineer_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null, name text not null, lat double precision, lng double precision, radius_m double precision not null default 50,
  fee double precision not null default 0, currency_id uuid references public.currencies(id) on delete set null, ip text,
  created_at timestamptz not null default now()
);
create table public.presence (account_id uuid not null references public.accounts(id) on delete cascade, facility_id uuid not null references public.facilities(id) on delete cascade, since timestamptz not null default now(), last_charged timestamptz not null default now(), primary key(account_id, facility_id));
create table public.messages (id bigserial primary key, from_id uuid not null references public.accounts(id) on delete cascade, to_id uuid not null references public.accounts(id) on delete cascade, body text not null, created_at timestamptz not null default now());

do $$ declare t text; begin
  foreach t in array array['accounts','sessions','currencies','balances','settings','logs','products','payment_methods','api_keys','facilities','presence','messages'] loop
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;

insert into public.accounts(username, password, role) values ('七彩星光', 'QiCaiXingGuang#2026@StarPay!', 'top');
insert into public.currencies(code, name, symbol, rate_expr, rate_log10) values
  ('RMB','人民币','￥','1',0),
  ('XMY','厦门元','XMY$','9^24', 24*log(9::numeric)::double precision);
insert into public.settings(key, value) values
  ('fees', '{"bank":5,"normal":30,"other":15}'),
  ('bank_gift', '{"currency":"XMY","amount":100000000}'),
  ('operators', '[{"symbol":"あ","kind":"tetration"},{"symbol":"い","kind":"iterated"}]'),
  ('wallpapers', '{}'), ('icon', '{}'), ('theme', '{"hue":30,"layout":"board"}'), ('role_perms', '{}');