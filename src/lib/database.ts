import type { SupabaseClient, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { fromCents, toCents } from "@/lib/money";
import type { Expense, Household, Person, Settlement } from "@/lib/types";

type HouseholdRow = {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
};

type MemberRow = {
  id: string;
  household_id: string;
  user_id: string | null;
  display_name: string;
  created_at: string;
};

type ExpenseRow = {
  id: string;
  household_id: string;
  title: string;
  amount_cents: number;
  paid_by_member_id: string;
  note: string | null;
  created_at: string;
};

type ExpenseSplitRow = {
  expense_id: string;
  participant_member_id: string;
  owed_cents: number;
};

type SettlementRow = {
  id: string;
  household_id: string;
  from_member_id: string;
  to_member_id: string;
  amount_cents: number;
  note: string | null;
  created_at: string;
};

function getSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }

  return supabase;
}

function mapHousehold(
  row: HouseholdRow,
  members: MemberRow[],
  expenses: ExpenseRow[],
  splits: ExpenseSplitRow[],
  settlements: SettlementRow[]
): Household {
  const people: Person[] = members
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .map((member) => ({
      id: member.id,
      name: member.display_name,
      userId: member.user_id
    }));

  return {
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    people,
    expenses: expenses
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map<Expense>((expense) => ({
        id: expense.id,
        title: expense.title,
        amount: fromCents(expense.amount_cents),
        paidById: expense.paid_by_member_id,
        note: expense.note ?? undefined,
        createdAt: expense.created_at,
        splits: splits
          .filter((split) => split.expense_id === expense.id)
          .map((split) => ({
            personId: split.participant_member_id,
            amount: fromCents(split.owed_cents)
          }))
      })),
    settlements: settlements
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map<Settlement>((settlement) => ({
        id: settlement.id,
        fromId: settlement.from_member_id,
        toId: settlement.to_member_id,
        amount: fromCents(settlement.amount_cents),
        note: settlement.note ?? undefined,
        createdAt: settlement.created_at
      })),
    createdAt: row.created_at
  };
}

export async function getCurrentUser() {
  const client = getSupabase();
  const { data, error } = await client.auth.getUser();
  if (error) {
    if (error.name === "AuthSessionMissingError" || error.message.toLowerCase().includes("session missing")) {
      return null;
    }

    throw error;
  }
  return data.user;
}

export function onAuthStateChange(callback: (user: User | null) => void) {
  const client = getSupabase();
  return client.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
}

export async function signUpWithPassword(email: string, password: string) {
  const client = getSupabase();
  const redirectTo = typeof window === "undefined" ? undefined : window.location.origin;
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: redirectTo ? { emailRedirectTo: redirectTo } : undefined
  });
  if (error) throw error;
  return data;
}

export async function signInWithPassword(email: string, password: string) {
  const client = getSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const client = getSupabase();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function loadFirstHousehold(): Promise<Household | null> {
  const client = getSupabase();
  const { data: households, error: householdError } = await client
    .from("households")
    .select("id,name,invite_code,created_at")
    .order("created_at", { ascending: true })
    .limit(1);

  if (householdError) throw householdError;
  const household = households?.[0] as HouseholdRow | undefined;
  if (!household) return null;

  return loadHousehold(household.id);
}

export async function loadHousehold(householdId: string): Promise<Household> {
  const client = getSupabase();
  const [householdResult, memberResult, expenseResult, settlementResult] = await Promise.all([
    client.from("households").select("id,name,invite_code,created_at").eq("id", householdId).single(),
    client.from("household_members").select("id,household_id,user_id,display_name,created_at").eq("household_id", householdId),
    client.from("expenses").select("id,household_id,title,amount_cents,paid_by_member_id,note,created_at").eq("household_id", householdId),
    client.from("settlements").select("id,household_id,from_member_id,to_member_id,amount_cents,note,created_at").eq("household_id", householdId)
  ]);

  if (householdResult.error) throw householdResult.error;
  if (memberResult.error) throw memberResult.error;
  if (expenseResult.error) throw expenseResult.error;
  if (settlementResult.error) throw settlementResult.error;

  const expenses = (expenseResult.data ?? []) as ExpenseRow[];
  const expenseIds = expenses.map((expense) => expense.id);
  const splitResult = expenseIds.length
    ? await client
        .from("expense_splits")
        .select("expense_id,participant_member_id,owed_cents")
        .in("expense_id", expenseIds)
    : { data: [], error: null };

  if (splitResult.error) throw splitResult.error;

  return mapHousehold(
    householdResult.data as HouseholdRow,
    (memberResult.data ?? []) as MemberRow[],
    expenses,
    (splitResult.data ?? []) as ExpenseSplitRow[],
    (settlementResult.data ?? []) as SettlementRow[]
  );
}

export async function createHousehold(name: string, displayName: string, roommateNames: string[]) {
  const client = getSupabase();
  const { data, error } = await client.rpc("create_household", {
    household_name: name,
    member_display_name: displayName
  });

  if (error) throw error;
  const householdId = data as string;
  await addRoommates(householdId, roommateNames.filter((roommate) => roommate.toLowerCase() !== displayName.toLowerCase()));
  return loadHousehold(householdId);
}

export async function joinHousehold(inviteCode: string, displayName: string) {
  const client = getSupabase();
  const { data, error } = await client.rpc("join_household_by_invite", {
    invite: inviteCode,
    member_display_name: displayName
  });

  if (error) throw error;
  return loadHousehold(data as string);
}

export async function addRoommates(householdId: string, names: string[]) {
  const client = getSupabase();
  const cleanNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (!cleanNames.length) return;

  const { error } = await client.from("household_members").insert(
    cleanNames.map((name) => ({
      household_id: householdId,
      display_name: name
    }))
  );

  if (error) throw error;
}

export async function insertExpense(householdId: string, expense: Expense) {
  const client = getSupabase();
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to add an expense.");

  const { data, error } = await client
    .from("expenses")
    .insert({
      household_id: householdId,
      title: expense.title,
      amount_cents: toCents(expense.amount),
      paid_by_member_id: expense.paidById,
      note: expense.note,
      created_by: user.id
    })
    .select("id")
    .single();

  if (error) throw error;

  const { error: splitError } = await client.from("expense_splits").insert(
    expense.splits.map((split) => ({
      expense_id: data.id,
      participant_member_id: split.personId,
      owed_cents: toCents(split.amount)
    }))
  );

  if (splitError) throw splitError;
  return data.id as string;
}

export async function insertSettlement(householdId: string, settlement: Settlement) {
  const client = getSupabase();
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to record a settlement.");

  const { error } = await client.from("settlements").insert({
    household_id: householdId,
    from_member_id: settlement.fromId,
    to_member_id: settlement.toId,
    amount_cents: toCents(settlement.amount),
    note: settlement.note,
    created_by: user.id
  });

  if (error) throw error;
}
