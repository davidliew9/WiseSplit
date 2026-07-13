import type { Household } from "@/lib/types";

export function createSampleHousehold(): Household {
  const now = new Date().toISOString();
  const people = [
    { id: "person-david", name: "David" },
    { id: "person-alex", name: "Alex" },
    { id: "person-sam", name: "Sam" }
  ];

  return {
    id: "household-demo",
    name: "Apartment 4B",
    inviteCode: "WISE-4B",
    people,
    expenses: [
      {
        id: "expense-groceries",
        title: "Groceries",
        amount: 90,
        paidById: "person-david",
        splits: [
          { personId: "person-david", amount: 30 },
          { personId: "person-alex", amount: 30 },
          { personId: "person-sam", amount: 30 }
        ],
        note: "Weekly basics",
        createdAt: now
      }
    ],
    settlements: [],
    createdAt: now
  };
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
