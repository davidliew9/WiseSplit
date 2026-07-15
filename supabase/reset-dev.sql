-- Destructive helper for early development only.
-- Run this before schema.sql if you already applied an older WiseSplit schema
-- and you do not need to keep any Supabase data from that test project.

drop table if exists expense_splits cascade;
drop table if exists settlements cascade;
drop table if exists expenses cascade;
drop table if exists household_members cascade;
drop table if exists households cascade;
drop function if exists public.create_household(text, text);
drop function if exists public.join_household_by_invite(text, text);
drop function if exists public.is_household_member(uuid);
drop function if exists public.validate_expense_member_ids();
drop function if exists public.validate_expense_split_member_ids();
drop function if exists public.validate_settlement_member_ids();
