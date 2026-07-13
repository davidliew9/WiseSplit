import type { Expense, Household, SuggestedSettlement } from "@/lib/types";
import { fromCents, toCents } from "@/lib/money";

export function calculateExpenseNet(expense: Expense) {
  const netCents = new Map<string, number>();
  const paidCents = toCents(expense.amount);
  netCents.set(expense.paidById, paidCents);

  for (const split of expense.splits) {
    netCents.set(split.personId, (netCents.get(split.personId) ?? 0) - toCents(split.amount));
  }

  return Object.fromEntries(
    [...netCents.entries()].map(([personId, cents]) => [personId, fromCents(cents)])
  );
}

export function calculateBalances(household: Household) {
  const balances = new Map(household.people.map((person) => [person.id, 0]));

  for (const expense of household.expenses) {
    balances.set(expense.paidById, (balances.get(expense.paidById) ?? 0) + toCents(expense.amount));

    for (const split of expense.splits) {
      balances.set(split.personId, (balances.get(split.personId) ?? 0) - toCents(split.amount));
    }
  }

  for (const settlement of household.settlements) {
    balances.set(settlement.fromId, (balances.get(settlement.fromId) ?? 0) + toCents(settlement.amount));
    balances.set(settlement.toId, (balances.get(settlement.toId) ?? 0) - toCents(settlement.amount));
  }

  return Object.fromEntries(
    [...balances.entries()].map(([personId, cents]) => [personId, fromCents(cents)])
  );
}

export function suggestSettlements(household: Household): SuggestedSettlement[] {
  const balances = calculateBalances(household);
  const debtors = Object.entries(balances)
    .filter(([, amount]) => amount < -0.005)
    .map(([personId, amount]) => ({ personId, cents: Math.abs(toCents(amount)) }))
    .sort((a, b) => b.cents - a.cents);
  const creditors = Object.entries(balances)
    .filter(([, amount]) => amount > 0.005)
    .map(([personId, amount]) => ({ personId, cents: toCents(amount) }))
    .sort((a, b) => b.cents - a.cents);

  const suggestions: SuggestedSettlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const cents = Math.min(debtor.cents, creditor.cents);

    if (cents > 0) {
      suggestions.push({
        fromId: debtor.personId,
        toId: creditor.personId,
        amount: fromCents(cents)
      });
    }

    debtor.cents -= cents;
    creditor.cents -= cents;

    if (debtor.cents === 0) debtorIndex += 1;
    if (creditor.cents === 0) creditorIndex += 1;
  }

  return suggestions;
}

export function validateExpenseSplits(expense: Pick<Expense, "amount" | "splits">) {
  const expected = toCents(expense.amount);
  const actual = expense.splits.reduce((total, split) => total + toCents(split.amount), 0);
  return expected === actual;
}
