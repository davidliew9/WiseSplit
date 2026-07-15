# WiseSplit

A small Splitwise-style PWA for roommate households. The app uses Supabase Auth and Supabase Postgres so household members can share expenses from different phones.

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

## Supabase Setup

Add project credentials to `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

In Supabase, open SQL Editor and run `supabase/schema.sql`. It creates:

- `households`
- `household_members`
- `expenses`
- `expense_splits`
- `settlements`
- row level security policies
- helper functions for household creation and invite-code joining
- validation triggers that keep expenses and settlements inside one household

If you already ran an older development schema and do not need to keep that test data, run `supabase/reset-dev.sql` first, then run `supabase/schema.sql`.

## App Flow

1. Create an account or sign in.
2. Create a household and add roommate names.
3. Share the invite code shown in the top bar.
4. Roommates sign in and join with that code.
5. Add expenses, view balances, and record settlements.

Roommate names can exist before someone joins. If Alex is already listed as a placeholder and signs up using the display name `Alex`, joining with the invite code claims that member row for Alex's account.
