import { formatCurrency } from "@/lib/money";
import type { ActivityItem, Household } from "@/lib/types";

export function getPersonName(household: Household, personId: string) {
  return household.people.find((person) => person.id === personId)?.name ?? "Unknown";
}

export function recentActivity(household: Household): ActivityItem[] {
  const expenses: ActivityItem[] = household.expenses.map((expense) => ({
    id: expense.id,
    kind: "expense",
    title: expense.title,
    description: `${getPersonName(household, expense.paidById)} paid ${formatCurrency(expense.amount)}`,
    amount: expense.amount,
    createdAt: expense.createdAt
  }));

  const settlements: ActivityItem[] = household.settlements.map((settlement) => ({
    id: settlement.id,
    kind: "settlement",
    title: "Settlement",
    description: `${getPersonName(household, settlement.fromId)} paid ${getPersonName(
      household,
      settlement.toId
    )}`,
    amount: settlement.amount,
    createdAt: settlement.createdAt
  }));

  return [...expenses, ...settlements].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}
