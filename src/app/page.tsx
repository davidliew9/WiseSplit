"use client";

import {
  Activity,
  Check,
  CircleDollarSign,
  Copy,
  HandCoins,
  Home,
  LogOut,
  Mail,
  Plus,
  ReceiptText,
  RefreshCw,
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
import {
  addRoommates,
  createHousehold,
  getCurrentUser,
  insertExpense,
  insertSettlement,
  joinHousehold,
  loadFirstHousehold,
  loadHousehold,
  onAuthStateChange,
  signInWithPassword,
  signOut,
  signUpWithPassword
} from "@/lib/database";
import { formatCurrency, fromCents, parseMoneyInput, toCents } from "@/lib/money";
import type { User } from "@supabase/supabase-js";
import type { Expense, ExpenseSplit, Household, Person, Settlement } from "@/lib/types";

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
  const [user, setUser] = useState<User | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [booting, setBooting] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const currentUser = await getCurrentUser();
        if (!active) return;
        setUser(currentUser);
        setHousehold(currentUser ? await loadFirstHousehold() : null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not connect to Supabase.");
      } finally {
        if (active) setBooting(false);
      }
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    boot();
    const listener = onAuthStateChange(async (nextUser) => {
      if (!active) return;
      setUser(nextUser);
      setHousehold(nextUser ? await loadFirstHousehold() : null);
      setBooting(false);
    });

    return () => {
      active = false;
      listener.data.subscription.unsubscribe();
    };
  }, []);

  const selectedExpense = useMemo(
    () => household?.expenses.find((expense) => expense.id === selectedExpenseId) ?? null,
    [household, selectedExpenseId]
  );

  async function refreshHousehold(targetHouseholdId = household?.id) {
    if (!targetHouseholdId) {
      setHousehold(await loadFirstHousehold());
      return;
    }

    setHousehold(await loadHousehold(targetHouseholdId));
  }

  async function runAction(action: () => Promise<void>) {
    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSignIn(email: string, password: string) {
    await runAction(async () => {
      await signInWithPassword(email, password);
      setNotice("Signed in.");
    });
  }

  async function handleSignUp(email: string, password: string) {
    await runAction(async () => {
      const result = await signUpWithPassword(email, password);
      setNotice(result.session ? "Account created." : "Check your email to confirm your account, then sign in.");
    });
  }

  async function handleCreateHousehold(name: string, displayName: string, roommateNames: string[]) {
    await runAction(async () => {
      const nextHousehold = await createHousehold(name, displayName, roommateNames);
      setHousehold(nextHousehold);
    });
  }

  async function handleJoinHousehold(inviteCode: string, displayName: string) {
    await runAction(async () => {
      const nextHousehold = await joinHousehold(inviteCode, displayName);
      setHousehold(nextHousehold);
    });
  }

  async function handleSignOut() {
    await runAction(async () => {
      await signOut();
      setHousehold(null);
      setUser(null);
    });
  }

  if (booting) {
    return <StatusScreen title="Loading WiseSplit" message="Checking your session and household." />;
  }

  if (!user) {
    return <AuthScreen error={error} isSaving={isSaving} notice={notice} onSignIn={handleSignIn} onSignUp={handleSignUp} />;
  }

  if (!household) {
    return (
      <Onboarding
        error={error}
        isSaving={isSaving}
        notice={notice}
        onCreateHousehold={handleCreateHousehold}
        onJoinHousehold={handleJoinHousehold}
        onSignOut={handleSignOut}
        userEmail={user.email ?? "Signed in"}
      />
    );
  }

  const activeHousehold = household;
  const balances = calculateBalances(activeHousehold);
  const suggestions = suggestSettlements(activeHousehold);
  const activity = recentActivity(activeHousehold);
  const totalSpent = activeHousehold.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const outstanding = Object.values(balances)
    .filter((amount) => amount > 0)
    .reduce((sum, amount) => sum + amount, 0);

  async function addExpense(expense: Expense) {
    await runAction(async () => {
      const expenseId = await insertExpense(activeHousehold.id, expense);
      await refreshHousehold(activeHousehold.id);
      setSelectedExpenseId(expenseId);
    });
  }

  async function addSettlement(settlement: Settlement) {
    await runAction(async () => {
      await insertSettlement(activeHousehold.id, settlement);
      await refreshHousehold(activeHousehold.id);
    });
  }

  async function addPerson(name: string) {
    await runAction(async () => {
      await addRoommates(activeHousehold.id, [name]);
      await refreshHousehold(activeHousehold.id);
    });
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
          <button className="ghost-button slim" onClick={() => runAction(() => refreshHousehold(activeHousehold.id))} type="button">
            <RefreshCw size={18} />
            <span>Refresh</span>
          </button>
          <button className="invite-button" onClick={copyInvite} type="button" title="Copy invite code">
            {copied ? <Check size={18} /> : <Copy size={18} />}
            <span>{activeHousehold.inviteCode}</span>
          </button>
          <button className="ghost-button slim" onClick={handleSignOut} type="button">
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
        </div>
      </header>
      <Feedback error={error} notice={notice} />

      <section className="summary-grid" aria-label="Household summary">
        <Metric icon={<ReceiptText size={20} />} label="Total expenses" value={formatCurrency(totalSpent)} />
        <Metric icon={<Scale size={20} />} label="Still unsettled" value={formatCurrency(outstanding)} />
        <Metric icon={<Users size={20} />} label="Roommates" value={activeHousehold.people.length.toString()} />
      </section>

      <section className="workspace-grid">
        <div className="stack">
          <ExpenseForm household={activeHousehold} isSaving={isSaving} onAddExpense={addExpense} />
          <SettlementForm household={activeHousehold} isSaving={isSaving} suggestions={suggestions} onAddSettlement={addSettlement} />
        </div>

        <div className="stack">
          <BalancesPanel household={activeHousehold} balances={balances} suggestions={suggestions} />
          <PeoplePanel isSaving={isSaving} people={activeHousehold.people} onAddPerson={addPerson} />
        </div>
      </section>

      <section className="details-grid">
        <div className="panel">
          <div className="panel-title">
            <ReceiptText size={19} />
            <h2>Expenses</h2>
          </div>
          <div className="expense-list">
            {activeHousehold.expenses.length ? activeHousehold.expenses.map((expense) => (
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
            )) : <p className="empty-state">No expenses yet.</p>}
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

function StatusScreen({ title, message }: { title: string; message: string }) {
  return (
    <main className="onboarding">
      <section className="onboarding-panel">
        <div className="brand-mark">
          <Home size={30} />
        </div>
        <p className="eyebrow">WiseSplit</p>
        <h1>{title}</h1>
        <p className="empty-state">{message}</p>
      </section>
    </main>
  );
}

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (!error && !notice) return null;

  return (
    <div className={error ? "feedback error" : "feedback notice"} role="status">
      {error ?? notice}
    </div>
  );
}

function AuthScreen({
  error,
  isSaving,
  notice,
  onSignIn,
  onSignUp
}: {
  error: string | null;
  isSaving: boolean;
  notice: string | null;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "signin") {
      await onSignIn(email, password);
    } else {
      await onSignUp(email, password);
    }
  }

  return (
    <main className="onboarding">
      <section className="onboarding-panel">
        <div className="brand-mark">
          <Mail size={30} />
        </div>
        <p className="eyebrow">WiseSplit</p>
        <h1>Sign in to share expenses.</h1>
        <Feedback error={error} notice={notice} />

        <div className="segmented" role="tablist" aria-label="Authentication mode">
          <button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")} type="button">
            Sign in
          </button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")} type="button">
            Create
          </button>
        </div>

        <form className="form" onSubmit={submit}>
          <label>
            Email
            <input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
          </label>
          <label>
            Password
            <input
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={6}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <button className="primary-button" disabled={isSaving || !email || password.length < 6} type="submit">
            <Mail size={18} />
            <span>{mode === "signin" ? "Sign in" : "Create account"}</span>
          </button>
        </form>
      </section>
    </main>
  );
}

function Onboarding({
  error,
  isSaving,
  notice,
  onCreateHousehold,
  onJoinHousehold,
  onSignOut,
  userEmail
}: {
  error: string | null;
  isSaving: boolean;
  notice: string | null;
  onCreateHousehold: (name: string, displayName: string, roommateNames: string[]) => Promise<void>;
  onJoinHousehold: (inviteCode: string, displayName: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  userEmail: string;
}) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [householdName, setHouseholdName] = useState("Apartment");
  const [roommates, setRoommates] = useState("David\nAlex\nSam");
  const [inviteCode, setInviteCode] = useState("");
  const [yourName, setYourName] = useState("David");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = yourName.trim() || "You";

    if (mode === "create") {
      await onCreateHousehold(
        householdName.trim() || "Household",
        displayName,
        roommates
          .split("\n")
          .map((name) => name.trim())
          .filter(Boolean)
      );
    } else {
      await onJoinHousehold(inviteCode.trim().toUpperCase(), displayName);
    }
  }

  return (
    <main className="onboarding">
      <section className="onboarding-panel">
        <div className="brand-mark">
          <Home size={30} />
        </div>
        <p className="eyebrow">WiseSplit</p>
        <h1>Shared expenses without spreadsheet archaeology.</h1>
        <div className="signed-in-row">
          <span>{userEmail}</span>
          <button className="ghost-button slim" onClick={onSignOut} type="button">
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
        </div>
        <Feedback error={error} notice={notice} />

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
                Your display name
                <input value={yourName} onChange={(event) => setYourName(event.target.value)} />
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
          <button className="primary-button" disabled={isSaving} type="submit">
            <Plus size={18} />
            <span>{mode === "create" ? "Create household" : "Join household"}</span>
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
  isSaving,
  onAddExpense
}: {
  household: Household;
  isSaving: boolean;
  onAddExpense: (expense: Expense) => Promise<void>;
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const splits =
      splitMode === "equal"
        ? equalSplits
        : activeParticipants.map((person) => ({
            personId: person.id,
            amount: parseMoneyInput(customAmounts[person.id] ?? "0")
          }));
    const expense: Expense = {
      id: "pending",
      title: title.trim() || "Untitled expense",
      amount: parsedAmount,
      paidById,
      splits,
      createdAt: new Date().toISOString()
    };

    if (!parsedAmount || !paidById || !splits.length || !validateExpenseSplits(expense)) return;

    await onAddExpense(expense);
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

      <button className="primary-button" disabled={isSaving || !canSubmit} type="submit">
        <Plus size={18} />
        <span>Add expense</span>
      </button>
    </form>
  );
}

function SettlementForm({
  household,
  isSaving,
  suggestions,
  onAddSettlement
}: {
  household: Household;
  isSaving: boolean;
  suggestions: ReturnType<typeof suggestSettlements>;
  onAddSettlement: (settlement: Settlement) => Promise<void>;
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fromId || !toId || fromId === toId || parsedAmount <= 0) return;

    await onAddSettlement({
      id: "pending",
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

      <button className="secondary-button" disabled={isSaving || !parsedAmount || fromId === toId} type="submit">
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

function PeoplePanel({
  isSaving,
  people,
  onAddPerson
}: {
  isSaving: boolean;
  people: Person[];
  onAddPerson: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    await onAddPerson(name.trim());
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
        <button className="icon-button" disabled={isSaving} type="submit" title="Add roommate">
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
