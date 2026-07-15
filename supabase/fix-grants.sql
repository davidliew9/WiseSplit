-- Run this in Supabase SQL Editor if you see:
-- permission denied for table households

grant usage on schema public to authenticated;

grant select, insert, update on table households to authenticated;
grant select, insert, update on table household_members to authenticated;
grant select, insert on table expenses to authenticated;
grant select, insert on table expense_splits to authenticated;
grant select, insert on table settlements to authenticated;

grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household_by_invite(text, text) to authenticated;
