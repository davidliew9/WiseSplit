"use client";

import {
  Activity,
  Check,
  CircleDollarSign,
  Copy,
  HandCoins,
  Home,
  Plus,
  ReceiptText,
  Scale,
  Users
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { recentActivity, getPersonName } from "@/lib/activity";
import {
  calculateBalances,
  calculateExpenseNet,
  suggestSettlements,
  validateExpenseSplits
} from "@/lib/balances";
import { formatCurrency, fromCents, parseMoneyInput, toCents } from "@/lib/money";
import { createSampleHousehold, makeId } from "@/lib/sample-data";
import type { Expense, ExpenseSplit, Household, Person, Settlement } from "@/lib/types";

const STORAGE_KEY = "wisesplit.household.v1";

function createInviteCode() {
  return `WISE-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function splitEvenly(amount: number, personIds: string[]): ExpenseSplit[] {
  const totalCents = toCents(amount);
  const base = Math.floor(totalCents / personIds.length);
  let remainder = totalCents - base * personIds.length;

  return personIds.map((personId) => {
    const cents = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return { personId, amount: fromCents(cents) };
  });
}

function personLabel(household: Household, personId: string) {
  return getPersonName(household, personId);
}

export default function HomePage() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setHousehold(JSON.parse(saved));
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (household) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(household));
    }
  }, [household]);

  const selectedExpense = useMemo(
    () => household?.expenses.find((expense) => expense.id === selectedExpenseId) ?? null,
    [household, selectedExpenseId]
  );

  if (!household) {
    return <Onboarding onReady={setHousehold} />;
  }

  const activeHousehold = household;
  const balances = calculateBalances(activeHousehold);
  const suggestions = suggestSettlements(activeHousehold);
  const activity = recentActivity(activeHousehold);
  const totalSpent = activeHousehold.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const outstanding = Object.values(balances)
    .filter((amount) => amount > 0)
    .reduce((sum, amount) => sum + amount, 0);

  function updateHousehold(updater: (current: Household) => Household) {
    setHousehold((current) => (current ? updater(current) : current));
  }

  function addExpense(expense: Expense) {
    updateHousehold((current) => ({
      ...current,
      expenses: [expense, ...current.expenses]
    }));
    setSelectedExpenseId(expense.id);
  }

  function addSettlement(settlement: Settlement) {
    updateHousehold((current) => ({
      ...current,
      settlements: [settlement, ...current.settlements]
    }));
  }

  function addPerson(name: string) {
    updateHousehold((current) => ({
      ...current,
      people: [...current.people, { id: makeId("person"), name }]
    }));
  }

  async function copyInvite() {
    await navigator.clipboard?.writeText(activeHousehold.inviteCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Household</p>
          <h1>{activeHousehold.name}</h1>
        </div>
        <div className="topbar-actions">
          <button className="invite-button" onClick={copyInvite} type="button" title="Copy invite code">
            {copied ? <Check size={18} /> : <Copy size={18} />}
            <span>{activeHousehold.inviteCode}</span>
          </button>
        </div>
      </header>

      <section className="summary-grid" aria-label="Household summary">
        <Metric icon={<ReceiptText size={20} />} label="Total expenses" value={formatCurrency(totalSpent)} />
        <Metric icon={<Scale size={20} />} label="Still unsettled" value={formatCurrency(outstanding)} />
        <Metric icon={<Users size={20} />} label="Roommates" value={activeHousehold.people.length.toString()} />
      </section>

      <section className="workspace-grid">
        <div className="stack">
          <ExpenseForm household={activeHousehold} onAddExpense={addExpense} />
          <SettlementForm household={activeHousehold} suggestions={suggestions} onAddSettlement={addSettlement} />
        </div>

        <div className="stack">
          <BalancesPanel household={activeHousehold} balances={balances} suggestions={suggestions} />
          <PeoplePanel people={activeHousehold.people} onAddPerson={addPerson} />
        </div>
      </section>

      <section className="details-grid">
        <div className="panel">
          <div className="panel-title">
            <ReceiptText size={19} />
            <h2>Expenses</h2>
          </div>
          <div className="expense-list">
            {activeHousehold.expenses.map((expense) => (
              <button
                className={`expense-row ${expense.id === selectedExpenseId ? "selected" : ""}`}
                key={expense.id}
                onClick={() => setSelectedExpenseId(expense.id)}
                type="button"
              >
                <span>
                  <strong>{expense.title}</strong>
                  <small>{personLabel(activeHousehold, expense.paidById)} paid</small>
                </span>
                <strong>{formatCurrency(expense.amount)}</strong>
              </button>
            ))}
          </div>
        </div>

        <ExpenseDetails household={activeHousehold} expense={selectedExpense ?? activeHousehold.expenses[0] ?? null} />

        <div className="panel">
          <div className="panel-title">
            <Activity size={19} />
            <h2>Recent activity</h2>
          </div>
          <div className="activity-list">
            {activity.map((item) => (
              <div className="activity-row" key={`${item.kind}-${item.id}`}>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </div>
                <span>{formatCurrency(item.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function Onboarding({ onReady }: { onReady: (household: Household) => void }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [householdName, setHouseholdName] = useState("Apartment");
  const [roommates, setRoommates] = useState("David\nAlex\nSam");
  const [inviteCode, setInviteCode] = useState("");
  const [yourName, setYourName] = useState("David");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const names =
      mode === "create"
        ? roommates
            .split("\n")
            .map((name) => name.trim())
            .filter(Boolean)
        : [yourName.trim() || "You"];
    const people = names.map<Person>((name) => ({ id: makeId("person"), name }));

    onReady({
      id: makeId("household"),
      name: mode === "create" ? householdName.trim() || "Household" : "Joined household",
      inviteCode: mode === "create" ? createInviteCode() : inviteCode.trim().toUpperCase() || createInviteCode(),
      people,
      expenses: [],
      settlements: [],
      createdAt: new Date().toISOString()
    });
  }

  return (
    <main className="onboarding">
      <section className="onboarding-panel">
        <div className="brand-mark">
          <Home size={30} />
        </div>
        <p className="eyebrow">WiseSplit</p>
        <h1>Shared expenses without spreadsheet archaeology.</h1>

        <div className="segmented" role="tablist" aria-label="Household setup">
          <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")} type="button">
            Create
          </button>
          <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")} type="button">
            Join
          </button>
        </div>

        <form className="form" onSubmit={submit}>
          {mode === "create" ? (
            <>
              <label>
                Household name
                <input value={householdName} onChange={(event) => setHouseholdName(event.target.value)} />
              </label>
              <label>
                Roommates
                <textarea
                  rows={4}
                  value={roommates}
                  onChange={(event) => setRoommates(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Invite code
                <input
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value)}
                  placeholder="WISE-4B"
                />
              </label>
              <label>
                Your name
                <input value={yourName} onChange={(event) => setYourName(event.target.value)} />
              </label>
            </>
          )}
          <button className="primary-button" type="submit">
            <Plus size={18} />
            <span>{mode === "create" ? "Create household" : "Join household"}</span>
          </button>
          <button className="ghost-button" type="button" onClick={() => onReady(createSampleHousehold())}>
            Load demo
          </button>
        </form>
      </section>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metric-icon">{icon}</div>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function ExpenseForm({
  household,
  onAddExpense
}: {
  household: Household;
  onAddExpense: (expense: Expense) => void;
}) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidById, setPaidById] = useState(household.people[0]?.id ?? "");
  const [splitMode, setSplitMode] = useState<"equal" | "custom">("equal");
  const [participantIds, setParticipantIds] = useState(() => new Set(household.people.map((person) => person.id)));
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const parsedAmount = parseMoneyInput(amount);
  const activeParticipants = household.people.filter((person) => participantIds.has(person.id));
  const equalSplits = activeParticipants.length ? splitEvenly(parsedAmount, activeParticipants.map((person) => person.id)) : [];
  const customTotal = activeParticipants.reduce(
    (sum, person) => sum + parseMoneyInput(customAmounts[person.id] ?? "0"),
    0
  );

  useEffect(() => {
    setParticipantIds(new Set(household.people.map((person) => person.id)));
    setPaidById((current) => current || household.people[0]?.id || "");
  }, [household.people]);

  function toggleParticipant(personId: string) {
    setParticipantIds((current) => {
      const next = new Set(current);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return next;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const splits =
      splitMode === "equal"
        ? equalSplits
        : activeParticipants.map((person) => ({
            personId: person.id,
            amount: parseMoneyInput(customAmounts[person.id] ?? "0")
          }));
    const expense: Expense = {
      id: makeId("expense"),
      title: title.trim() || "Untitled expense",
      amount: parsedAmount,
      paidById,
      splits,
      createdAt: new Date().toISOString()
    };

    if (!parsedAmount || !paidById || !splits.length || !validateExpenseSplits(expense)) return;

    onAddExpense(expense);
    setTitle("");
    setAmount("");
    setCustomAmounts({});
  }

  const canSubmit =
    parsedAmount > 0 &&
    Boolean(paidById) &&
    activeParticipants.length > 0 &&
    (splitMode === "equal" || toCents(customTotal) === toCents(parsedAmount));

  return (
    <form className="panel form" onSubmit={submit}>
      <div className="panel-title">
        <ReceiptText size={19} />
        <h2>Add expense</h2>
      </div>

      <div className="field-grid">
        <label>
          Description
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Groceries" />
        </label>
        <label>
          Amount
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="90" />
        </label>
      </div>

      <label>
        Paid by
        <select value={paidById} onChange={(event) => setPaidById(event.target.value)}>
          {household.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>

      <div>
        <div className="label-row">
          <span>Participants</span>
          <div className="segmented compact">
            <button className={splitMode === "equal" ? "active" : ""} onClick={() => setSplitMode("equal")} type="button">
              Equal
            </button>
            <button className={splitMode === "custom" ? "active" : ""} onClick={() => setSplitMode("custom")} type="button">
              Custom
            </button>
          </div>
        </div>

        <div className="participant-list">
          {household.people.map((person) => {
            const included = participantIds.has(person.id);
            const equalAmount = equalSplits.find((split) => split.personId === person.id)?.amount ?? 0;

            return (
              <div className="participant-row" key={person.id}>
                <label className="checkbox-label">
                  <input checked={included} onChange={() => toggleParticipant(person.id)} type="checkbox" />
                  <span>{person.name}</span>
                </label>
                {splitMode === "equal" ? (
                  <strong>{included ? formatCurrency(equalAmount) : "$0.00"}</strong>
                ) : (
                  <input
                    className="money-input"
                    disabled={!included}
                    inputMode="decimal"
                    value={customAmounts[person.id] ?? ""}
                    onChange={(event) =>
                      setCustomAmounts((current) => ({ ...current, [person.id]: event.target.value }))
                    }
                    placeholder="0.00"
                  />
                )}
              </div>
            );
          })}
        </div>
        {splitMode === "custom" ? (
          <p className={toCents(customTotal) === toCents(parsedAmount) ? "form-hint ok" : "form-hint"}>
            Custom split total: {formatCurrency(customTotal)}
          </p>
        ) : null}
      </div>

      <button className="primary-button" disabled={!canSubmit} type="submit">
        <Plus size={18} />
        <span>Add expense</span>
      </button>
    </form>
  );
}

function SettlementForm({
  household,
  suggestions,
  onAddSettlement
}: {
  household: Household;
  suggestions: ReturnType<typeof suggestSettlements>;
  onAddSettlement: (settlement: Settlement) => void;
}) {
  const firstSuggestion = suggestions[0];
  const [fromId, setFromId] = useState(firstSuggestion?.fromId ?? household.people[0]?.id ?? "");
  const [toId, setToId] = useState(firstSuggestion?.toId ?? household.people[1]?.id ?? "");
  const [amount, setAmount] = useState(firstSuggestion ? String(firstSuggestion.amount) : "");
  const parsedAmount = parseMoneyInput(amount);

  useEffect(() => {
    if (firstSuggestion) {
      setFromId(firstSuggestion.fromId);
      setToId(firstSuggestion.toId);
      setAmount(String(firstSuggestion.amount));
    }
  }, [firstSuggestion]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fromId || !toId || fromId === toId || parsedAmount <= 0) return;

    onAddSettlement({
      id: makeId("settlement"),
      fromId,
      toId,
      amount: parsedAmount,
      createdAt: new Date().toISOString()
    });
    setAmount("");
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <div className="panel-title">
        <HandCoins size={19} />
        <h2>Record settlement</h2>
      </div>

      <div className="field-grid three">
        <label>
          From
          <select value={fromId} onChange={(event) => setFromId(event.target.value)}>
            {household.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <select value={toId} onChange={(event) => setToId(event.target.value)}>
            {household.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
      </div>

      <button className="secondary-button" disabled={!parsedAmount || fromId === toId} type="submit">
        <CircleDollarSign size={18} />
        <span>Record payment</span>
      </button>
    </form>
  );
}

function BalancesPanel({
  household,
  balances,
  suggestions
}: {
  household: Household;
  balances: Record<string, number>;
  suggestions: ReturnType<typeof suggestSettlements>;
}) {
  return (
    <div className="panel">
      <div className="panel-title">
        <Scale size={19} />
        <h2>Balances</h2>
      </div>
      <div className="balance-list">
        {household.people.map((person) => {
          const amount = balances[person.id] ?? 0;
          return (
            <div className="balance-row" key={person.id}>
              <span>{person.name}</span>
              <strong className={amount > 0 ? "positive" : amount < 0 ? "negative" : ""}>
                {amount > 0 ? `is owed ${formatCurrency(amount)}` : amount < 0 ? `owes ${formatCurrency(Math.abs(amount))}` : "settled"}
              </strong>
            </div>
          );
        })}
      </div>

      <div className="suggestions">
        <h3>Suggested payments</h3>
        {suggestions.length ? (
          suggestions.map((suggestion) => (
            <div className="suggestion-row" key={`${suggestion.fromId}-${suggestion.toId}-${suggestion.amount}`}>
              <span>
                {personLabel(household, suggestion.fromId)} pays {personLabel(household, suggestion.toId)}
              </span>
              <strong>{formatCurrency(suggestion.amount)}</strong>
            </div>
          ))
        ) : (
          <p className="empty-state">Everyone is settled.</p>
        )}
      </div>
    </div>
  );
}

function PeoplePanel({ people, onAddPerson }: { people: Person[]; onAddPerson: (name: string) => void }) {
  const [name, setName] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    onAddPerson(name.trim());
    setName("");
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <div className="panel-title">
        <Users size={19} />
        <h2>Roommates</h2>
      </div>
      <div className="chips">
        {people.map((person) => (
          <span className="chip" key={person.id}>
            {person.name}
          </span>
        ))}
      </div>
      <div className="inline-form">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New roommate" />
        <button className="icon-button" type="submit" title="Add roommate">
          <Plus size={18} />
        </button>
      </div>
    </form>
  );
}

function ExpenseDetails({ household, expense }: { household: Household; expense: Expense | null }) {
  if (!expense) {
    return (
      <div className="panel">
        <div className="panel-title">
          <ReceiptText size={19} />
          <h2>Expense details</h2>
        </div>
        <p className="empty-state">Add an expense to see participant-level details.</p>
      </div>
    );
  }

  const net = calculateExpenseNet(expense);
  const payerShare = expense.splits.find((split) => split.personId === expense.paidById)?.amount ?? 0;
  const payerNet = expense.amount - payerShare;

  return (
    <div className="panel">
      <div className="panel-title">
        <ReceiptText size={19} />
        <h2>Expense details</h2>
      </div>
      <div className="detail-header">
        <div>
          <strong>{expense.title}</strong>
          <small>
            Paid by {personLabel(household, expense.paidById)} on{" "}
            {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
              new Date(expense.createdAt)
            )}
          </small>
        </div>
        <strong>{formatCurrency(expense.amount)}</strong>
      </div>
      <div className="detail-callout">
        {personLabel(household, expense.paidById)} paid {formatCurrency(expense.amount)} and personally owes{" "}
        {formatCurrency(payerShare)}, so they are owed {formatCurrency(payerNet)} for this expense.
      </div>
      <div className="split-table">
        {expense.splits.map((split) => (
          <div className="split-row" key={split.personId}>
            <span>{personLabel(household, split.personId)}</span>
            <strong>{formatCurrency(split.amount)}</strong>
          </div>
        ))}
      </div>
      <div className="split-table net">
        {Object.entries(net).map(([personId, amount]) => (
          <div className="split-row" key={personId}>
            <span>{personLabel(household, personId)}</span>
            <strong className={amount > 0 ? "positive" : amount < 0 ? "negative" : ""}>
              {amount > 0 ? `is owed ${formatCurrency(amount)}` : amount < 0 ? `owes ${formatCurrency(Math.abs(amount))}` : "settled"}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
