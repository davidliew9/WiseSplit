# WiseSplit

A small Splitwise-style PWA for roommate households. The current MVP is local-first so it can be used immediately in one browser, while the project includes a Supabase client stub and starter Postgres schema for moving the data to a shared backend.

## What Works

- Create or join a household
- Add roommates
- Add an expense with a payer and participants
- Split expenses equally or by custom owed amounts
- View expense details, including payer net position
- View household balances
- See suggested settlement payments
- Record payments between roommates
- View recent activity
- Install as a basic PWA

For the example:

```txt
Groceries: $90
Paid by: David

David owes: $30
Alex owes: $30
Sam owes: $30
```

David paid $90 but personally owed $30, so David is owed $60. Alex owes $30 and Sam owes $30.

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Supabase Path

Add project credentials to `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

The starter database schema is in `supabase/schema.sql`. It models:

- `households`
- `household_members`
- `expenses`
- `expense_splits`
- `settlements`

The current UI stores data in `localStorage`. The next backend step is replacing the local household state with Supabase Auth plus row-level-secured reads/writes against those tables.
