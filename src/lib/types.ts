export type Person = {
  id: string;
  name: string;
};

export type ExpenseSplit = {
  personId: string;
  amount: number;
};

export type Expense = {
  id: string;
  title: string;
  amount: number;
  paidById: string;
  splits: ExpenseSplit[];
  note?: string;
  createdAt: string;
};

export type Settlement = {
  id: string;
  fromId: string;
  toId: string;
  amount: number;
  note?: string;
  createdAt: string;
};

export type Household = {
  id: string;
  name: string;
  inviteCode: string;
  people: Person[];
  expenses: Expense[];
  settlements: Settlement[];
  createdAt: string;
};

export type ActivityItem = {
  id: string;
  kind: "expense" | "settlement";
  title: string;
  description: string;
  amount: number;
  createdAt: string;
};

export type SuggestedSettlement = {
  fromId: string;
  toId: string;
  amount: number;
};
