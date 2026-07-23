"use client";

import {
  Activity,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  HandCoins,
  Home,
  Image as ImageIcon,
  ListFilter,
  LogOut,
  Mail,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Scale,
  Share2,
  Settings,
  User as UserIcon,
  UserPlus,
  Users,
  X
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
  loadHousehold,
  loadHouseholds,
  onAuthStateChange,
  renameHousehold,
  signInWithPassword,
  signOut,
  signUpWithPassword
} from "@/lib/database";
import { formatCurrency, fromCents, parseMoneyInput, toCents } from "@/lib/money";
import type { User } from "@supabase/supabase-js";
import type { Expense, ExpenseSplit, Household, Person, Settlement } from "@/lib/types";

type AppTab = "friends" | "groups" | "activity" | "account";
type ActiveModal = "expense" | "settlement" | "expense-details" | "manage-group" | "rename-group" | "share-group" | null;

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

const AVATAR_VARIANTS = ["", "chip-peach", "chip-neutral"] as const;

function avatarVariant(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return AVATAR_VARIANTS[hash % AVATAR_VARIANTS.length];
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [booting, setBooting] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("groups");
  const [groupView, setGroupView] = useState<"list" | "detail">("list");
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [pendingInvite, setPendingInvite] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("invite")?.trim().toUpperCase() ?? ""
  );
  const [invitePromptShown, setInvitePromptShown] = useState(false);

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const currentUser = await getCurrentUser();
        if (!active) return;
        setUser(currentUser);
        const nextHouseholds = currentUser ? await loadHouseholds() : [];
        setHouseholds(nextHouseholds);
        setHousehold(nextHouseholds[0] ?? null);
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
      const nextHouseholds = nextUser ? await loadHouseholds() : [];
      setHouseholds(nextHouseholds);
      setHousehold(nextHouseholds[0] ?? null);
      setBooting(false);
    });

    return () => {
      active = false;
      listener.data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user && household && pendingInvite && !invitePromptShown) {
      setActiveModal("manage-group");
      setInvitePromptShown(true);
    }
  }, [household, invitePromptShown, pendingInvite, user]);

  const selectedExpense = useMemo(
    () => household?.expenses.find((expense) => expense.id === selectedExpenseId) ?? null,
    [household, selectedExpenseId]
  );

  async function refreshHousehold(targetHouseholdId = household?.id) {
    if (!targetHouseholdId) return;
    const refreshed = await loadHousehold(targetHouseholdId);
    setHousehold(refreshed);
    setHouseholds((current) => current.map((item) => (item.id === refreshed.id ? refreshed : item)));
  }

  async function refreshHouseholds(preferredHouseholdId = household?.id) {
    const nextHouseholds = await loadHouseholds();
    setHouseholds(nextHouseholds);
    setHousehold(
      nextHouseholds.find((item) => item.id === preferredHouseholdId) ?? nextHouseholds[0] ?? null
    );
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
      await refreshHouseholds(nextHousehold.id);
      setGroupView("detail");
      setActiveModal(null);
      setPendingInvite("");
      setNotice(`${nextHousehold.name} created.`);
    });
  }

  async function handleJoinHousehold(inviteCode: string, displayName: string) {
    await runAction(async () => {
      const nextHousehold = await joinHousehold(inviteCode, displayName);
      await refreshHouseholds(nextHousehold.id);
      setGroupView("detail");
      setActiveModal(null);
      setPendingInvite("");
      setNotice(`Joined ${nextHousehold.name}.`);
      if (typeof window !== "undefined") window.history.replaceState({}, "", window.location.pathname);
    });
  }

  async function handleSignOut() {
    await runAction(async () => {
      await signOut();
      setHousehold(null);
      setHouseholds([]);
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
        initialInviteCode={pendingInvite}
        userEmail={user.email ?? "Signed in"}
      />
    );
  }

  const activeHousehold = household;
  const balances = calculateBalances(activeHousehold);
  const suggestions = suggestSettlements(activeHousehold);
  const activity = recentActivity(activeHousehold);
  const totalSpent = activeHousehold.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const currentPerson = activeHousehold.people.find((person) => person.userId === user.id) ?? activeHousehold.people[0];
  const currentBalance = currentPerson ? balances[currentPerson.id] ?? 0 : 0;
  const youOwe = Math.abs(Math.min(currentBalance, 0));
  const youAreOwed = Math.max(currentBalance, 0);

  async function addExpense(expense: Expense) {
    await runAction(async () => {
      const expenseId = await insertExpense(activeHousehold.id, expense);
      await refreshHousehold(activeHousehold.id);
      setSelectedExpenseId(expenseId);
      setActiveModal("expense-details");
      setGroupView("detail");
    });
  }

  async function addSettlement(settlement: Settlement) {
    await runAction(async () => {
      await insertSettlement(activeHousehold.id, settlement);
      await refreshHousehold(activeHousehold.id);
      setActiveModal(null);
      setNotice("Settlement recorded.");
    });
  }

  async function addPerson(name: string) {
    await runAction(async () => {
      await addRoommates(activeHousehold.id, [name]);
      await refreshHousehold(activeHousehold.id);
    });
  }

  function getInviteUrl() {
    return `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(activeHousehold.inviteCode)}`;
  }

  async function copyInvite() {
    await navigator.clipboard?.writeText(getInviteUrl());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function shareInvite() {
    const url = getInviteUrl();
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${activeHousehold.name} on WiseSplit`,
          text: `Join my ${activeHousehold.name} group on WiseSplit.`,
          url
        });
        return;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
      }
    }
    await copyInvite();
  }

  async function updateGroupName(name: string) {
    await runAction(async () => {
      await renameHousehold(activeHousehold.id, name);
      await refreshHousehold(activeHousehold.id);
      setActiveModal(null);
      setNotice("Group name updated.");
    });
  }

  function openGroup(groupId: string) {
    const nextHousehold = households.find((item) => item.id === groupId);
    if (!nextHousehold) return;
    setHousehold(nextHousehold);
    setSelectedExpenseId(null);
    setGroupView("detail");
  }

  return (
    <main className="mobile-shell">
      <Feedback error={error} notice={notice} />

      {activeTab === "groups" && groupView === "list" ? (
        <GroupsHome
          households={households}
          onCreateGroup={() => setActiveModal("manage-group")}
          onOpenGroup={openGroup}
          onRefresh={() => runAction(() => refreshHouseholds(activeHousehold.id))}
          userId={user.id}
        />
      ) : null}

      {activeTab === "groups" && groupView === "detail" ? (
        <GroupDetail
          balances={balances}
          household={activeHousehold}
          onBack={() => {
            setGroupView("list");
          }}
          onEditGroup={() => setActiveModal("rename-group")}
          onOpenSettlement={() => setActiveModal("settlement")}
          onShareGroup={() => setActiveModal("share-group")}
          onSelectExpense={(expenseId) => {
            setSelectedExpenseId(expenseId);
            setActiveModal("expense-details");
          }}
          suggestions={suggestions}
          totalSpent={totalSpent}
          youAreOwed={youAreOwed}
          youOwe={youOwe}
        />
      ) : null}

      {activeTab === "friends" ? (
        <FriendsScreen
          balances={balances}
          currentPersonId={currentPerson?.id}
          household={activeHousehold}
          isSaving={isSaving}
          onAddPerson={addPerson}
        />
      ) : null}

      {activeTab === "activity" ? <ActivityScreen activity={activity} /> : null}

      {activeTab === "account" ? (
        <AccountScreen
          household={activeHousehold}
          onRefresh={() => runAction(() => refreshHousehold(activeHousehold.id))}
          onShareGroup={() => setActiveModal("share-group")}
          onSignOut={handleSignOut}
          userEmail={user.email ?? "Signed in"}
        />
      ) : null}

      {activeTab === "groups" && groupView === "detail" ? (
        <div className="floating-actions">
          <button className="floating-action settlement" onClick={() => setActiveModal("settlement")} type="button">
            <HandCoins size={22} />
            <span>Settle up</span>
          </button>
          <button className="floating-action expense" onClick={() => setActiveModal("expense")} type="button">
            <ReceiptText size={22} />
            <span>Add expense</span>
          </button>
        </div>
      ) : null}

      {activeModal === "expense" ? (
        <ModalShell title="Add expense" onClose={() => setActiveModal(null)}>
          <ExpenseForm household={activeHousehold} isSaving={isSaving} onAddExpense={addExpense} />
        </ModalShell>
      ) : null}

      {activeModal === "settlement" ? (
        <ModalShell title="Settle up" onClose={() => setActiveModal(null)}>
          <SettlementForm household={activeHousehold} isSaving={isSaving} suggestions={suggestions} onAddSettlement={addSettlement} />
        </ModalShell>
      ) : null}

      {activeModal === "expense-details" ? (
        <ModalShell title="Expense details" onClose={() => setActiveModal(null)}>
          <ExpenseDetails household={activeHousehold} expense={selectedExpense} />
        </ModalShell>
      ) : null}

      {activeModal === "manage-group" ? (
        <ModalShell title={pendingInvite ? "Join a group" : "New group"} onClose={() => setActiveModal(null)}>
          <GroupManagerForm
            defaultName={currentPerson?.name ?? user.email?.split("@")[0] ?? ""}
            initialInviteCode={pendingInvite}
            isSaving={isSaving}
            onCreate={handleCreateHousehold}
            onJoin={handleJoinHousehold}
          />
        </ModalShell>
      ) : null}

      {activeModal === "rename-group" ? (
        <ModalShell title="Edit group" onClose={() => setActiveModal(null)}>
          <RenameGroupForm household={activeHousehold} isSaving={isSaving} onSave={updateGroupName} />
        </ModalShell>
      ) : null}

      {activeModal === "share-group" ? (
        <ModalShell title="Invite people" onClose={() => setActiveModal(null)}>
          <ShareGroupPanel
            copied={copied}
            household={activeHousehold}
            inviteUrl={getInviteUrl()}
            onCopy={copyInvite}
            onShare={shareInvite}
          />
        </ModalShell>
      ) : null}

      <BottomNav activeTab={activeTab} onChange={(tab) => {
        setActiveTab(tab);
        setActiveModal(null);
        if (tab === "groups") setGroupView("list");
      }} />
    </main>
  );
}

function GroupsHome({
  households,
  onCreateGroup,
  onOpenGroup,
  onRefresh,
  userId
}: {
  households: Household[];
  onCreateGroup: () => void;
  onOpenGroup: (groupId: string) => void;
  onRefresh: () => void;
  userId: string;
}) {
  const summaries = households.map((household) => {
    const balances = calculateBalances(household);
    const currentPerson = household.people.find((person) => person.userId === userId);
    const currentBalance = currentPerson ? balances[currentPerson.id] ?? 0 : 0;
    return { balances, currentBalance, household };
  });
  const youOwe = summaries.reduce((sum, item) => sum + Math.abs(Math.min(item.currentBalance, 0)), 0);
  const youAreOwed = summaries.reduce((sum, item) => sum + Math.max(item.currentBalance, 0), 0);
  const totalSpent = households.reduce(
    (sum, item) => sum + item.expenses.reduce((groupSum, expense) => groupSum + expense.amount, 0),
    0
  );

  return (
    <section className="screen-view">
      <header className="section-header">
        <div>
          <p className="eyebrow">WiseSplit</p>
          <h1>Groups</h1>
        </div>
        <div className="topbar-buttons">
          <button className="round-icon-button" type="button" title="Search">
            <SearchIcon />
          </button>
          <button className="round-icon-button accent" type="button" onClick={onCreateGroup} title="Create group">
            <Plus size={20} />
          </button>
        </div>
      </header>

      <div className="overall-copy">
        <p>
          Overall, you owe <strong className="negative">{formatCurrency(youOwe)}</strong>
          <br />
          and you are owed <strong className="positive">{formatCurrency(youAreOwed)}</strong>
        </p>
        <button className="round-icon-button flat" type="button" onClick={onRefresh} title="Refresh balances">
          <ListFilter size={26} />
        </button>
      </div>

      <div className="group-list">
        {summaries.map(({ balances, currentBalance, household }) => {
          const friendLines = household.people
            .filter((person) => Math.abs(balances[person.id] ?? 0) > 0.005)
            .slice(0, 2);

          return (
            <button className="group-card-row" key={household.id} onClick={() => onOpenGroup(household.id)} type="button">
              <GroupAvatar name={household.name} />
              <span className="group-card-main">
                <strong>{household.name}</strong>
                {friendLines.length ? (
                  friendLines.map((person) => {
                    const amount = balances[person.id] ?? 0;
                    return (
                      <small key={person.id}>
                        {amount > 0 ? `${person.name} is owed ` : `${person.name} owes `}
                        <span className={amount > 0 ? "positive" : "negative"}>
                          {formatCurrency(Math.abs(amount))}
                        </span>
                      </small>
                    );
                  })
                ) : (
                  <small>Settled up with {household.people.length} people</small>
                )}
              </span>
              <span className={currentBalance > 0 ? "group-card-balance positive" : currentBalance < 0 ? "group-card-balance negative" : "group-card-balance"}>
                <small>{currentBalance > 0 ? "you are owed" : currentBalance < 0 ? "you owe" : "settled"}</small>
                <strong>{Math.abs(currentBalance) > 0.005 ? formatCurrency(Math.abs(currentBalance)) : ""}</strong>
              </span>
              <ChevronRight className="group-chevron" size={22} />
            </button>
          );
        })}
      </div>

      <div className="promo-panel">
        <p className="eyebrow">Shared tab</p>
        <h2>Start a tab with friends</h2>
        <p>Split rent, groceries, dinners, and weekend plans from one clean household view.</p>
        <strong>{formatCurrency(totalSpent)} tracked</strong>
      </div>
    </section>
  );
}

function GroupDetail({
  balances,
  household,
  onBack,
  onEditGroup,
  onOpenSettlement,
  onShareGroup,
  onSelectExpense,
  suggestions,
  totalSpent,
  youAreOwed,
  youOwe
}: {
  balances: Record<string, number>;
  household: Household;
  onBack: () => void;
  onEditGroup: () => void;
  onOpenSettlement: () => void;
  onShareGroup: () => void;
  onSelectExpense: (expenseId: string) => void;
  suggestions: ReturnType<typeof suggestSettlements>;
  totalSpent: number;
  youAreOwed: number;
  youOwe: number;
}) {
  return (
    <section className="screen-view group-detail-view">
      <header className="group-hero">
        <div className="hero-actions">
          <button className="hero-icon-button" onClick={onBack} type="button" title="Back to groups">
            <ArrowLeft size={26} />
          </button>
          <button className="hero-icon-button" onClick={onEditGroup} type="button" title="Edit group name">
            <Pencil size={24} />
          </button>
        </div>
        <div className="hero-pattern">
          <ImageIcon size={58} />
        </div>
        <h1>{household.name}</h1>
        <div className="hero-pills">
          <button className="hero-pill" type="button" onClick={onOpenSettlement}>
            <CalendarDays size={19} />
            <span>Settle up</span>
          </button>
          <button className="hero-pill" type="button" onClick={onShareGroup}>
            <Users size={19} />
            <span>{household.people.length} people</span>
          </button>
          <button className="hero-pill wide" type="button" onClick={onShareGroup}>
            <Share2 size={19} />
            <span>Invite people</span>
          </button>
        </div>
      </header>

      <div className="group-content">
        <section className="balance-summary">
          <p>
            {youOwe > youAreOwed ? (
              <>
                You owe <strong className="negative">{formatCurrency(youOwe)}</strong> overall
              </>
            ) : youAreOwed > 0 ? (
              <>
                You are owed <strong className="positive">{formatCurrency(youAreOwed)}</strong> overall
              </>
            ) : (
              <>Everyone is settled up</>
            )}
          </p>
          <div className="mini-balance-lines">
            {suggestions.slice(0, 2).map((suggestion) => (
              <span key={`${suggestion.fromId}-${suggestion.toId}-${suggestion.amount}`}>
                {personLabel(household, suggestion.fromId)} pays {personLabel(household, suggestion.toId)}{" "}
                <strong>{formatCurrency(suggestion.amount)}</strong>
              </span>
            ))}
          </div>
          <div className="quick-actions">
            <span className="outline-pill">Tracked {formatCurrency(totalSpent)}</span>
          </div>
        </section>

        <div className="group-columns">
          <div className="feed-list">
            {household.expenses.length ? (
              household.expenses.map((expense) => (
                <ExpenseFeedRow
                  expense={expense}
                  household={household}
                  key={expense.id}
                  onSelectExpense={onSelectExpense}
                />
              ))
            ) : (
              <p className="empty-state">No expenses yet.</p>
            )}
          </div>

          <div className="desktop-side-panel">
            <BalancesPanel household={household} balances={balances} suggestions={suggestions} />
          </div>
        </div>
      </div>
    </section>
  );
}

function ExpenseFeedRow({
  expense,
  household,
  onSelectExpense
}: {
  expense: Expense;
  household: Household;
  onSelectExpense: (expenseId: string) => void;
}) {
  return (
    <button className="feed-row" onClick={() => onSelectExpense(expense.id)} type="button">
      <span className="feed-date">
        {new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(expense.createdAt))}
        <strong>{new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(new Date(expense.createdAt))}</strong>
      </span>
      <span className="receipt-tile">
        <ReceiptText size={28} />
      </span>
      <span className="feed-main">
        <strong>{expense.title}</strong>
        <small>{personLabel(household, expense.paidById)} paid {formatCurrency(expense.amount)}</small>
      </span>
      <span className="feed-amount">
        <small>expense</small>
        <strong>{formatCurrency(expense.amount)}</strong>
      </span>
    </button>
  );
}

function FriendsScreen({
  balances,
  currentPersonId,
  household,
  isSaving,
  onAddPerson
}: {
  balances: Record<string, number>;
  currentPersonId?: string;
  household: Household;
  isSaving: boolean;
  onAddPerson: (name: string) => Promise<void>;
}) {
  return (
    <section className="screen-view">
      <header className="section-header">
        <div>
          <p className="eyebrow">Friends</p>
          <h1>Roommates</h1>
        </div>
        <UserPlus size={32} />
      </header>
      <PeoplePanel isSaving={isSaving} people={household.people} onAddPerson={onAddPerson} />
      <div className="friend-list">
        {household.people
          .filter((person) => person.id !== currentPersonId)
          .map((person) => {
            const amount = balances[person.id] ?? 0;
            return (
              <div className="friend-row" key={person.id}>
                <span className={`friend-avatar ${avatarVariant(person.name)}`.trim()}>
                  {person.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{person.name}</strong>
                  <small>{amount > 0 ? "is owed" : amount < 0 ? "owes" : "settled up"}</small>
                </span>
                <strong className={amount > 0 ? "positive" : amount < 0 ? "negative" : ""}>
                  {Math.abs(amount) > 0.005 ? formatCurrency(Math.abs(amount)) : ""}
                </strong>
              </div>
            );
          })}
      </div>
    </section>
  );
}

function ActivityScreen({ activity }: { activity: ReturnType<typeof recentActivity> }) {
  return (
    <section className="screen-view">
      <header className="section-header">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>Recent updates</h1>
        </div>
        <Activity size={32} />
      </header>
      <div className="activity-list mobile-activity">
        {activity.length ? (
          activity.map((item) => (
            <div className="activity-row" key={`${item.kind}-${item.id}`}>
              <div>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </div>
              <span>{formatCurrency(item.amount)}</span>
            </div>
          ))
        ) : (
          <p className="empty-state">No activity yet.</p>
        )}
      </div>
    </section>
  );
}

function AccountScreen({
  household,
  onRefresh,
  onShareGroup,
  onSignOut,
  userEmail
}: {
  household: Household;
  onRefresh: () => void;
  onShareGroup: () => void;
  onSignOut: () => void;
  userEmail: string;
}) {
  return (
    <section className="screen-view">
      <header className="section-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1>{userEmail}</h1>
        </div>
        <UserIcon size={32} />
      </header>
      <div className="account-actions">
        <button className="invite-button" onClick={onShareGroup} type="button">
          <Copy size={18} />
          <span>{household.inviteCode}</span>
        </button>
        <button className="ghost-button" onClick={onRefresh} type="button">
          <RefreshCw size={18} />
          <span>Refresh household</span>
        </button>
        <button className="secondary-button" onClick={onSignOut} type="button">
          <LogOut size={18} />
          <span>Sign out</span>
        </button>
      </div>
    </section>
  );
}

function BottomNav({ activeTab, onChange }: { activeTab: AppTab; onChange: (tab: AppTab) => void }) {
  const items = [
    { id: "friends" as const, label: "Friends", icon: UserIcon },
    { id: "groups" as const, label: "Groups", icon: Users },
    { id: "activity" as const, label: "Activity", icon: Activity },
    { id: "account" as const, label: "Account", icon: Settings }
  ];

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            className={activeTab === item.id ? "active" : ""}
            key={item.id}
            onClick={() => onChange(item.id)}
            type="button"
          >
            <Icon size={25} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function GroupAvatar({ name }: { name: string }) {
  return (
    <span className={`group-avatar ${avatarVariant(name)}`.trim()} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("modal-open");
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.classList.remove("modal-open");
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label={title}
        aria-modal="true"
        className="modal-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="modal-header">
          <div>
            <p className="eyebrow">{title === "Expense details" ? "Transaction" : "WiseSplit"}</p>
            <h2>{title}</h2>
          </div>
          <button aria-label="Close" className="modal-close" onClick={onClose} type="button">
            <X size={24} />
          </button>
        </header>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}

function GroupManagerForm({
  defaultName,
  initialInviteCode,
  isSaving,
  onCreate,
  onJoin
}: {
  defaultName: string;
  initialInviteCode: string;
  isSaving: boolean;
  onCreate: (name: string, displayName: string, roommateNames: string[]) => Promise<void>;
  onJoin: (inviteCode: string, displayName: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"create" | "join">(initialInviteCode ? "join" : "create");
  const [groupName, setGroupName] = useState("");
  const [displayName, setDisplayName] = useState(defaultName);
  const [roommates, setRoommates] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCode);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanDisplayName = displayName.trim() || "You";
    if (mode === "create") {
      await onCreate(
        groupName.trim(),
        cleanDisplayName,
        roommates.split("\n").map((name) => name.trim()).filter(Boolean)
      );
      return;
    }
    await onJoin(inviteCode.trim().toUpperCase(), cleanDisplayName);
  }

  return (
    <form className="form modal-form" onSubmit={submit}>
      <div className="segmented" role="tablist" aria-label="Group action">
        <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")} type="button">
          Create group
        </button>
        <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")} type="button">
          Join group
        </button>
      </div>

      {mode === "create" ? (
        <>
          <label>
            Group name
            <input autoFocus onChange={(event) => setGroupName(event.target.value)} placeholder="Summer trip" value={groupName} />
          </label>
          <label>
            Your name in this group
            <input onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
          </label>
          <label>
            Add people now (optional)
            <textarea
              onChange={(event) => setRoommates(event.target.value)}
              placeholder={"Alex\nSam"}
              rows={3}
              value={roommates}
            />
          </label>
        </>
      ) : (
        <>
          <div className="info-callout">Use the invite code from a WiseSplit link. You can join with an existing account or after creating one.</div>
          <label>
            Invite code
            <input
              autoFocus
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="WISE-4B2A1C"
              value={inviteCode}
            />
          </label>
          <label>
            Your name in this group
            <input onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
          </label>
        </>
      )}

      <button
        className="primary-button modal-submit"
        disabled={isSaving || (mode === "create" ? !groupName.trim() : !inviteCode.trim())}
        type="submit"
      >
        {mode === "create" ? <Plus size={19} /> : <UserPlus size={19} />}
        <span>{isSaving ? "Saving…" : mode === "create" ? "Create group" : "Join group"}</span>
      </button>
    </form>
  );
}

function RenameGroupForm({
  household,
  isSaving,
  onSave
}: {
  household: Household;
  isSaving: boolean;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(household.name);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || name.trim() === household.name) return;
    await onSave(name);
  }

  return (
    <form className="form modal-form" onSubmit={submit}>
      <label>
        Group name
        <input autoFocus maxLength={80} onChange={(event) => setName(event.target.value)} value={name} />
      </label>
      <button className="primary-button modal-submit" disabled={isSaving || !name.trim() || name.trim() === household.name} type="submit">
        <Check size={19} />
        <span>{isSaving ? "Saving…" : "Save group name"}</span>
      </button>
    </form>
  );
}

function ShareGroupPanel({
  copied,
  household,
  inviteUrl,
  onCopy,
  onShare
}: {
  copied: boolean;
  household: Household;
  inviteUrl: string;
  onCopy: () => Promise<void>;
  onShare: () => Promise<void>;
}) {
  return (
    <div className="share-panel">
      <div className="invite-code-card">
        <span>Invite code</span>
        <strong>{household.inviteCode}</strong>
        <small>Anyone with this invite can join {household.name}.</small>
      </div>
      <label>
        Invite link
        <input onFocus={(event) => event.currentTarget.select()} readOnly value={inviteUrl} />
      </label>
      <div className="share-actions">
        <button className="ghost-button" onClick={onCopy} type="button">
          {copied ? <Check size={19} /> : <Copy size={19} />}
          <span>{copied ? "Link copied" : "Copy link"}</span>
        </button>
        <button className="primary-button" onClick={onShare} type="button">
          <Share2 size={19} />
          <span>Share invite</span>
        </button>
      </div>
      <p className="share-help">
        Send this link by text, email, or another app. New users will be asked to create an account before joining; existing users can join immediately.
      </p>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="28" viewBox="0 0 24 24" width="28">
      <path d="m21 21-4.35-4.35M10.8 18.1a7.3 7.3 0 1 1 0-14.6 7.3 7.3 0 0 1 0 14.6Z" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
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
  initialInviteCode,
  isSaving,
  notice,
  onCreateHousehold,
  onJoinHousehold,
  onSignOut,
  userEmail
}: {
  error: string | null;
  initialInviteCode: string;
  isSaving: boolean;
  notice: string | null;
  onCreateHousehold: (name: string, displayName: string, roommateNames: string[]) => Promise<void>;
  onJoinHousehold: (inviteCode: string, displayName: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  userEmail: string;
}) {
  const [mode, setMode] = useState<"create" | "join">(initialInviteCode ? "join" : "create");
  const [householdName, setHouseholdName] = useState("");
  const [roommates, setRoommates] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [yourName, setYourName] = useState(userEmail.split("@")[0] ?? "");

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
                Group name
                <input placeholder="Summer trip" value={householdName} onChange={(event) => setHouseholdName(event.target.value)} />
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
                  placeholder={"Alex\nSam"}
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
