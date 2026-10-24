-- Squad Arena database
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
--
-- Only the round server touches these tables, with the secret key. Row-level security is on with
-- no policies, so the public (publishable) key can read or write nothing here.

create extension if not exists pgcrypto;

-- ---------- people ----------
create table if not exists profiles (
  id          text primary key,                       -- Privy user id (did:privy:…)
  name        text not null default '',
  avatar      text,
  handle      text,                                   -- X handle, taken from their first X proof
  email       text,
  wallet      text,                                   -- main Solana address (the Google wallet, else the first linked one)
  wallets     text[] not null default '{}',           -- every Solana address linked in Privy
  bal_tsol    numeric(20,9) not null default 25 check (bal_tsol >= 0),   -- practice credits
  bal_sol     numeric(20,9) not null default 0  check (bal_sol  >= 0),   -- real SOL held for the user
  topup_at    timestamptz,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz not null default now()
);

-- ---------- rounds ----------
create table if not exists rounds (
  key          text primary key,                      -- L.<tf>.<start ms>
  tf           text not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  field_top    text[] not null default '{}',          -- the 15 coins fixed at the open
  field_bench  text[] not null default '{}',          -- the 10 on deck
  live         boolean not null default true,         -- false when the server joined too late to score it
  lcs          jsonb,                                 -- bracket checkpoints and cuts
  results      jsonb,                                 -- winners per market
  settled_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists rounds_open on rounds (ends_at) where settled_at is null;

-- ---------- bets ----------
create table if not exists bets (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references profiles(id),
  round_key    text not null,
  tf           text not null,
  round_start  bigint not null,                       -- ms since epoch
  market       text not null check (market in ('top','lcs','eff','bust')),
  mint         text not null,
  currency     text not null check (currency in ('tSOL','SOL')),
  stake        numeric(20,9) not null check (stake > 0),
  weight       numeric(10,6) not null check (weight > 0 and weight <= 1),
  quote        numeric(14,4),
  status       text not null default 'open' check (status in ('open','won','lost','refund')),
  payout       numeric(20,9) not null default 0,
  why          text,
  pass_used    boolean not null default false,
  receipt      text,
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);
create index if not exists bets_pool  on bets (round_key, market, currency);
create index if not exists bets_user  on bets (user_id, created_at desc);
create index if not exists bets_open  on bets (status) where status = 'open';

create table if not exists squad_members (
  user_id    text not null references profiles(id),
  mint       text not null,
  joined_at  timestamptz not null default now(),
  primary key (user_id, mint)
);

-- ---------- squads: proofs and chat ----------
create table if not exists proofs (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references profiles(id),
  mint        text not null,
  task        text not null,
  url         text not null unique,
  created_at  timestamptz not null default now(),
  unique (user_id, mint, task)
);
create table if not exists proof_marks (
  proof_id    uuid not null references proofs(id) on delete cascade,
  user_id     text not null references profiles(id),
  kind        text not null check (kind in ('check','flag')),
  created_at  timestamptz not null default now(),
  primary key (proof_id, user_id, kind)
);
create table if not exists chat (
  id          bigint generated always as identity primary key,
  user_id     text not null references profiles(id),
  chan        text not null,
  body        text not null check (char_length(body) <= 280),
  sys         boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists chat_recent on chat (created_at desc);

-- ---------- money ----------
create table if not exists ledger (
  id          bigint generated always as identity primary key,
  user_id     text not null references profiles(id),
  currency    text not null,
  amount      numeric(20,9) not null,                 -- + credit, - debit
  balance     numeric(20,9) not null,                 -- balance after this line
  kind        text not null,                          -- bet, payout, refund, deposit, withdraw, withdraw_refund, topup
  ref         text,
  created_at  timestamptz not null default now()
);
create unique index if not exists ledger_once on ledger (kind, ref) where ref is not null;   -- nothing is credited twice

create table if not exists deposits (
  sig         text primary key,                       -- Solana transaction signature
  user_id     text not null references profiles(id),
  network     text not null,
  from_addr   text not null,
  lamports    bigint not null check (lamports > 0),
  created_at  timestamptz not null default now()
);
create table if not exists withdrawals (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references profiles(id),
  network     text not null,
  to_addr     text not null,
  lamports    bigint not null check (lamports > 0),
  status      text not null default 'pending' check (status in ('pending','sent','confirmed','failed')),
  sig         text,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists withdrawals_open on withdrawals (status) where status in ('pending','sent');

-- ---------- atomic money moves (called by the server only) ----------
create or replace function sa_add(p_user text, p_currency text, p_amount numeric, p_kind text, p_ref text)
returns numeric language plpgsql security definer set search_path = public as $$
declare nb numeric;
begin
  if p_currency = 'tSOL' then
    update profiles set bal_tsol = bal_tsol + p_amount where id = p_user and bal_tsol + p_amount >= 0 returning bal_tsol into nb;
  elsif p_currency = 'SOL' then
    update profiles set bal_sol = bal_sol + p_amount where id = p_user and bal_sol + p_amount >= 0 returning bal_sol into nb;
  else
    raise exception 'unknown currency %', p_currency;
  end if;
  if nb is null then raise exception 'insufficient balance' using errcode = 'P0001'; end if;
  insert into ledger (user_id, currency, amount, balance, kind, ref) values (p_user, p_currency, p_amount, nb, p_kind, p_ref);
  return nb;
end $$;

create or replace function place_bet(p_user text, p_round text, p_tf text, p_round_start bigint, p_market text, p_mint text,
                                     p_currency text, p_stake numeric, p_weight numeric, p_quote numeric)
returns bets language plpgsql security definer set search_path = public as $$
declare b bets;
begin
  insert into bets (user_id, round_key, tf, round_start, market, mint, currency, stake, weight, quote)
    values (p_user, p_round, p_tf, p_round_start, p_market, p_mint, p_currency, p_stake, p_weight, p_quote) returning * into b;
  perform sa_add(p_user, p_currency, -p_stake, 'bet', b.id::text);
  insert into squad_members (user_id, mint) values (p_user, p_mint) on conflict do nothing;
  return b;
end $$;

create or replace function settle_bet(p_bet uuid, p_status text, p_payout numeric, p_why text, p_receipt text)
returns bets language plpgsql security definer set search_path = public as $$
declare b bets; credit numeric;
begin
  update bets set status = p_status, payout = case when p_status = 'won' then p_payout else 0 end,
                  why = p_why, receipt = p_receipt, settled_at = now()
    where id = p_bet and status = 'open' returning * into b;
  if b.id is null then return null; end if;          -- already settled
  credit := case when p_status = 'won' then p_payout when p_status = 'refund' then b.stake else 0 end;
  if credit > 0 then perform sa_add(b.user_id, b.currency, credit, case when p_status = 'won' then 'payout' else 'refund' end, b.id::text); end if;
  return b;
end $$;

create or replace function use_streak_pass(p_bet uuid, p_user text, p_mint text)
returns bets language plpgsql security definer set search_path = public as $$
declare b bets;
begin
  update bets set mint = p_mint, pass_used = true
    where id = p_bet and user_id = p_user and status = 'open' and market = 'lcs' and not pass_used returning * into b;
  if b.id is not null then insert into squad_members (user_id, mint) values (p_user, p_mint) on conflict do nothing; end if;
  return b;
end $$;

create or replace function topup_practice(p_user text)
returns numeric language plpgsql security definer set search_path = public as $$
declare cur numeric; at timestamptz;
begin
  select bal_tsol, topup_at into cur, at from profiles where id = p_user for update;
  if cur is null or cur >= 5 or (at is not null and at > now() - interval '24 hours') then return null; end if;
  update profiles set topup_at = now() where id = p_user;
  return sa_add(p_user, 'tSOL', 25 - cur, 'topup', p_user || ':' || to_char(now(), 'YYYY-MM-DD'));
end $$;

create or replace function credit_deposit(p_user text, p_sig text, p_network text, p_from text, p_lamports bigint)
returns numeric language plpgsql security definer set search_path = public as $$
begin
  insert into deposits (sig, user_id, network, from_addr, lamports) values (p_sig, p_user, p_network, p_from, p_lamports)
    on conflict (sig) do nothing;
  if not found then return null; end if;              -- this transaction was credited before
  return sa_add(p_user, 'SOL', p_lamports / 1e9, 'deposit', p_sig);
end $$;

create or replace function request_withdrawal(p_user text, p_network text, p_to text, p_lamports bigint)
returns withdrawals language plpgsql security definer set search_path = public as $$
declare w withdrawals;
begin
  insert into withdrawals (user_id, network, to_addr, lamports) values (p_user, p_network, p_to, p_lamports) returning * into w;
  perform sa_add(p_user, 'SOL', -(p_lamports / 1e9), 'withdraw', w.id::text);
  return w;
end $$;

create or replace function finish_withdrawal(p_id uuid, p_status text, p_sig text, p_error text)
returns withdrawals language plpgsql security definer set search_path = public as $$
declare w withdrawals;
begin
  update withdrawals set status = p_status, sig = coalesce(p_sig, sig), error = p_error, updated_at = now()
    where id = p_id and status in ('pending','sent') returning * into w;
  if w.id is not null and p_status = 'failed' then
    perform sa_add(w.user_id, 'SOL', w.lamports / 1e9, 'withdraw_refund', w.id::text);
  end if;
  return w;
end $$;

-- ---------- lock it down: only the server (secret key) gets in ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','rounds','bets','squad_members','proofs','proof_marks','chat','ledger','deposits','withdrawals'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;

revoke all on function sa_add(text,text,numeric,text,text) from public, anon, authenticated;
revoke all on function place_bet(text,text,text,bigint,text,text,text,numeric,numeric,numeric) from public, anon, authenticated;
revoke all on function settle_bet(uuid,text,numeric,text,text) from public, anon, authenticated;
revoke all on function use_streak_pass(uuid,text,text) from public, anon, authenticated;
revoke all on function topup_practice(text) from public, anon, authenticated;
revoke all on function credit_deposit(text,text,text,text,bigint) from public, anon, authenticated;
revoke all on function request_withdrawal(text,text,text,bigint) from public, anon, authenticated;
revoke all on function finish_withdrawal(uuid,text,text,text) from public, anon, authenticated;
grant execute on function sa_add(text,text,numeric,text,text), place_bet(text,text,text,bigint,text,text,text,numeric,numeric,numeric),
  settle_bet(uuid,text,numeric,text,text), use_streak_pass(uuid,text,text), topup_practice(text),
  credit_deposit(text,text,text,text,bigint), request_withdrawal(text,text,text,bigint), finish_withdrawal(uuid,text,text,text)
  to service_role;
