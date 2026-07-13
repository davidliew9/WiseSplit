create extension if not exists "pgcrypto";

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid references auth.users(id),
  display_name text not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (household_id, display_name)
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  title text not null,
  amount_cents integer not null check (amount_cents > 0),
  paid_by_name text not null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table expense_splits (
  expense_id uuid not null references expenses(id) on delete cascade,
  participant_name text not null,
  owed_cents integer not null check (owed_cents >= 0),
  primary key (expense_id, participant_name)
);

create table settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  from_name text not null,
  to_name text not null,
  amount_cents integer not null check (amount_cents > 0),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table households enable row level security;
alter table household_members enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;
alter table settlements enable row level security;

-- Minimal policy shape: users can see and edit households where they are members.
-- Tighten invite acceptance and display-name rules before production use.
create policy "members can read households"
  on households for select using (
    exists (
      select 1 from household_members
      where household_members.household_id = households.id
      and household_members.user_id = auth.uid()
    )
  );

create policy "members can read household members"
  on household_members for select using (
    exists (
      select 1 from household_members self
      where self.household_id = household_members.household_id
      and self.user_id = auth.uid()
    )
  );

create policy "members can read expenses"
  on expenses for select using (
    exists (
      select 1 from household_members
      where household_members.household_id = expenses.household_id
      and household_members.user_id = auth.uid()
    )
  );

create policy "members can read expense splits"
  on expense_splits for select using (
    exists (
      select 1 from expenses
      join household_members on household_members.household_id = expenses.household_id
      where expenses.id = expense_splits.expense_id
      and household_members.user_id = auth.uid()
    )
  );

create policy "members can read settlements"
  on settlements for select using (
    exists (
      select 1 from household_members
      where household_members.household_id = settlements.household_id
      and household_members.user_id = auth.uid()
    )
  );
