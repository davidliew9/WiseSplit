create extension if not exists "pgcrypto";

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  role text not null default 'member',
  created_at timestamptz not null default now()
);

create unique index if not exists household_members_user_unique
  on household_members (household_id, user_id)
  where user_id is not null;

create unique index if not exists household_members_display_name_unique
  on household_members (household_id, lower(display_name));

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  title text not null,
  amount_cents integer not null check (amount_cents > 0),
  paid_by_member_id uuid not null references household_members(id),
  note text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists expense_splits (
  expense_id uuid not null references expenses(id) on delete cascade,
  participant_member_id uuid not null references household_members(id),
  owed_cents integer not null check (owed_cents >= 0),
  primary key (expense_id, participant_member_id)
);

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  from_member_id uuid not null references household_members(id),
  to_member_id uuid not null references household_members(id),
  amount_cents integer not null check (amount_cents > 0),
  note text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (from_member_id <> to_member_id)
);

create or replace function public.validate_expense_member_ids()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from household_members
    where id = new.paid_by_member_id
      and household_id = new.household_id
  ) then
    raise exception 'Expense payer must belong to the expense household';
  end if;

  return new;
end;
$$;

create or replace function public.validate_expense_split_member_ids()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from expenses
    join household_members
      on household_members.household_id = expenses.household_id
     and household_members.id = new.participant_member_id
    where expenses.id = new.expense_id
  ) then
    raise exception 'Expense participant must belong to the expense household';
  end if;

  return new;
end;
$$;

create or replace function public.validate_settlement_member_ids()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from household_members
    where id = new.from_member_id
      and household_id = new.household_id
  ) then
    raise exception 'Settlement sender must belong to the settlement household';
  end if;

  if not exists (
    select 1
    from household_members
    where id = new.to_member_id
      and household_id = new.household_id
  ) then
    raise exception 'Settlement receiver must belong to the settlement household';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_expense_member_ids on expenses;
create trigger validate_expense_member_ids
  before insert or update on expenses
  for each row execute function public.validate_expense_member_ids();

drop trigger if exists validate_expense_split_member_ids on expense_splits;
create trigger validate_expense_split_member_ids
  before insert or update on expense_splits
  for each row execute function public.validate_expense_split_member_ids();

drop trigger if exists validate_settlement_member_ids on settlements;
create trigger validate_settlement_member_ids
  before insert or update on settlements
  for each row execute function public.validate_settlement_member_ids();

alter table households enable row level security;
alter table household_members enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;
alter table settlements enable row level security;

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from household_members
    where household_id = target_household_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.rename_household(
  target_household_id uuid,
  household_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_household_member(target_household_id) then
    raise exception 'Only group members can rename this group';
  end if;

  if nullif(trim(household_name), '') is null then
    raise exception 'Group name cannot be empty';
  end if;

  update households
  set name = trim(household_name)
  where id = target_household_id;
end;
$$;

create or replace function public.create_household(
  household_name text,
  member_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household_id uuid;
  new_invite_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  loop
    new_invite_code := 'WISE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from households where invite_code = new_invite_code);
  end loop;

  insert into households (name, invite_code, created_by)
  values (nullif(trim(household_name), ''), new_invite_code, auth.uid())
  returning id into new_household_id;

  insert into household_members (household_id, user_id, display_name, role)
  values (new_household_id, auth.uid(), nullif(trim(member_display_name), ''), 'admin');

  return new_household_id;
end;
$$;

create or replace function public.join_household_by_invite(
  invite text,
  member_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_household_id uuid;
  existing_member_id uuid;
  normalized_invite text := upper(trim(invite));
  normalized_name text := nullif(trim(member_display_name), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select id into target_household_id
  from households
  where invite_code = normalized_invite;

  if target_household_id is null then
    raise exception 'Invite code not found';
  end if;

  select id into existing_member_id
  from household_members
  where household_id = target_household_id
    and user_id = auth.uid();

  if existing_member_id is not null then
    return target_household_id;
  end if;

  select id into existing_member_id
  from household_members
  where household_id = target_household_id
    and lower(display_name) = lower(normalized_name)
    and user_id is null;

  if existing_member_id is not null then
    update household_members
    set user_id = auth.uid()
    where id = existing_member_id;
  else
    insert into household_members (household_id, user_id, display_name)
    values (target_household_id, auth.uid(), normalized_name);
  end if;

  return target_household_id;
end;
$$;

drop policy if exists "members can read households" on households;
drop policy if exists "authenticated users can create households" on households;
drop policy if exists "members can read household members" on household_members;
drop policy if exists "members can add household members" on household_members;
drop policy if exists "members can update their household members" on household_members;
drop policy if exists "members can read expenses" on expenses;
drop policy if exists "members can add expenses" on expenses;
drop policy if exists "members can read expense splits" on expense_splits;
drop policy if exists "members can add expense splits" on expense_splits;
drop policy if exists "members can read settlements" on settlements;
drop policy if exists "members can add settlements" on settlements;

create policy "members can read households"
  on households for select
  using (public.is_household_member(id));

create policy "authenticated users can create households"
  on households for insert
  with check (auth.uid() = created_by);

create policy "members can read household members"
  on household_members for select
  using (public.is_household_member(household_id));

create policy "members can add household members"
  on household_members for insert
  with check (
    public.is_household_member(household_id)
    and (user_id is null or user_id = auth.uid())
  );

create policy "members can update their household members"
  on household_members for update
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "members can read expenses"
  on expenses for select
  using (public.is_household_member(household_id));

create policy "members can add expenses"
  on expenses for insert
  with check (
    public.is_household_member(household_id)
    and created_by = auth.uid()
  );

create policy "members can read expense splits"
  on expense_splits for select
  using (
    exists (
      select 1
      from expenses
      where expenses.id = expense_splits.expense_id
        and public.is_household_member(expenses.household_id)
    )
  );

create policy "members can add expense splits"
  on expense_splits for insert
  with check (
    exists (
      select 1
      from expenses
      where expenses.id = expense_splits.expense_id
        and public.is_household_member(expenses.household_id)
    )
  );

create policy "members can read settlements"
  on settlements for select
  using (public.is_household_member(household_id));

create policy "members can add settlements"
  on settlements for insert
  with check (
    public.is_household_member(household_id)
    and created_by = auth.uid()
  );

grant usage on schema public to authenticated;

grant select, insert, update on table households to authenticated;
grant select, insert, update on table household_members to authenticated;
grant select, insert on table expenses to authenticated;
grant select, insert on table expense_splits to authenticated;
grant select, insert on table settlements to authenticated;

grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.rename_household(uuid, text) to authenticated;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household_by_invite(text, text) to authenticated;
