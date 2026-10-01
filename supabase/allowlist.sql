-- Optional: limit the app to named people, on top of the Microsoft tenant
-- and ALLOWED_EMAIL_DOMAINS checks. Run once in Supabase -> SQL Editor,
-- then set USE_ALLOWLIST_TABLE=true on Railway.

create table if not exists public.allowed_users (
  email text primary key,
  added_at timestamptz not null default now()
);

-- RLS on with no policies: nobody can read or change the list through the
-- API; you manage it in the Supabase Table Editor.
alter table public.allowed_users enable row level security;

-- The server calls this with the signed-in person's token; it only answers
-- "is my own email on the list?".
create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_users
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

revoke execute on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated;

-- Add people (repeat for each, or use Table Editor -> allowed_users -> Insert row):
-- insert into public.allowed_users (email) values ('someone@yourcompany.com');
