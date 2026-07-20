"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/layout/header";
import {
  Archive, Building2, Copy, ExternalLink, Eye, EyeOff, KeyRound, Loader2,
  LockKeyhole, LogOut, Pencil, Plus, Search, ShieldCheck, X,
} from "lucide-react";
import {
  decryptVaultSecret,
  deriveVaultEncryptionKey,
  encryptVaultSecret,
} from "@/lib/client-vault-crypto";

interface CorporateAccount {
  id: string;
  serviceName: string;
  category: string;
  loginUrl: string | null;
  username: string | null;
  accountNumberLast4: string | null;
  responsiblePerson: string | null;
  recoveryContact: string | null;
  notes: string | null;
  encryptedSecret: string | null;
  secretIv: string | null;
  encryptionVersion: number;
}

interface AccountForm {
  serviceName: string;
  category: string;
  loginUrl: string;
  username: string;
  accountNumberLast4: string;
  responsiblePerson: string;
  recoveryContact: string;
  notes: string;
  password: string;
  recoveryNotes: string;
}

interface RevealedSecret {
  password: string;
  recoveryNotes?: string;
}

const EMPTY_FORM: AccountForm = {
  serviceName: "", category: "utility", loginUrl: "", username: "",
  accountNumberLast4: "", responsiblePerson: "", recoveryContact: "",
  notes: "", password: "", recoveryNotes: "",
};

const CATEGORIES = [
  ["utility", "Utility"], ["banking", "Banking"], ["insurance", "Insurance"],
  ["government", "Government"], ["vendor", "Vendor"],
  ["technology", "Technology"], ["other", "Other"],
] as const;

function accountToForm(account: CorporateAccount): AccountForm {
  return {
    serviceName: account.serviceName,
    category: account.category,
    loginUrl: account.loginUrl || "",
    username: account.username || "",
    accountNumberLast4: account.accountNumberLast4 || "",
    responsiblePerson: account.responsiblePerson || "",
    recoveryContact: account.recoveryContact || "",
    notes: account.notes || "",
    password: "",
    recoveryNotes: "",
  };
}

function categoryLabel(value: string): string {
  return CATEGORIES.find(([id]) => id === value)?.[1] || value;
}

export default function CorporateAccountsPage() {
  const [state, setState] = useState<"loading" | "locked" | "unlocked" | "unconfigured">("loading");
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<CorporateAccount | null>(null);
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, RevealedSecret>>({});
  const [rotateOpen, setRotateOpen] = useState(false);
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmNewPassphrase, setConfirmNewPassphrase] = useState("");
  const encryptionKey = useRef<CryptoKey | null>(null);
  const encryptionConfig = useRef<{ salt: string; iterations: number } | null>(null);

  const loadAccounts = async () => {
    const response = await fetch("/api/corporate-accounts", { cache: "no-store" });
    if (response.status === 401) { encryptionKey.current = null; setState("locked"); return; }
    if (!response.ok) throw new Error("Unable to load corporation accounts");
    const data = (await response.json()) as { accounts: CorporateAccount[] };
    setAccounts(data.accounts);
    setState("unlocked");
  };

  useEffect(() => {
    fetch("/api/corporate-accounts?status=true", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { configured?: boolean }) => setState(data.configured ? "locked" : "unconfigured"))
      .catch(() => { setError("Corporation vault is temporarily unavailable."); setState("locked"); });
  }, []);

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return accounts;
    return accounts.filter((account) =>
      [account.serviceName, account.category, account.username, account.responsiblePerson, account.recoveryContact]
        .some((value) => value?.toLowerCase().includes(query))
    );
  }, [accounts, search]);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!passphrase || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/corporate-accounts/unlock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passphrase }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to unlock vault");
      encryptionKey.current = await deriveVaultEncryptionKey(
        passphrase,
        data.encryption.salt,
        data.encryption.iterations
      );
      encryptionConfig.current = data.encryption;
      setPassphrase("");
      await loadAccounts();
    } catch (caught) {
      encryptionKey.current = null;
      setError(caught instanceof Error ? caught.message : "Unable to unlock vault");
    } finally { setBusy(false); }
  };

  const setupVault = async (event: FormEvent) => {
    event.preventDefault();
    if (passphrase.length < 14 || passphrase !== confirmPassphrase || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/corporate-accounts/setup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passphrase }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to create vault");
      encryptionKey.current = await deriveVaultEncryptionKey(
        passphrase,
        data.encryption.salt,
        data.encryption.iterations
      );
      encryptionConfig.current = data.encryption;
      setPassphrase(""); setConfirmPassphrase("");
      await loadAccounts();
    } catch (caught) {
      encryptionKey.current = null;
      setError(caught instanceof Error ? caught.message : "Unable to create vault");
    } finally { setBusy(false); }
  };

  const lock = async () => {
    encryptionKey.current = null;
    encryptionConfig.current = null;
    setRevealed({}); setAccounts([]); setState("locked");
    await fetch("/api/corporate-accounts/unlock", { method: "DELETE" });
  };

  const rotatePassphrase = async (event: FormEvent) => {
    event.preventDefault();
    if (
      newPassphrase.length < 14 ||
      newPassphrase !== confirmNewPassphrase ||
      !encryptionKey.current ||
      !encryptionConfig.current ||
      busy
    ) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/corporate-accounts?rotation=true", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load credentials for passphrase change");
      const data = (await response.json()) as { accounts: CorporateAccount[] };
      const newKey = await deriveVaultEncryptionKey(
        newPassphrase,
        encryptionConfig.current.salt,
        encryptionConfig.current.iterations
      );
      const rotated = await Promise.all(
        data.accounts.map(async (account) => {
          if (!account.encryptedSecret || !account.secretIv) throw new Error("Credential is incomplete");
          const secret = await decryptVaultSecret(
            encryptionKey.current!,
            account.encryptedSecret,
            account.secretIv
          );
          return { id: account.id, ...(await encryptVaultSecret(newKey, secret)) };
        })
      );
      const rotateResponse = await fetch("/api/corporate-accounts/rotate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: newPassphrase, accounts: rotated }),
      });
      const rotateData = await rotateResponse.json().catch(() => ({}));
      if (!rotateResponse.ok) throw new Error(rotateData.error || "Unable to change passphrase");
      encryptionKey.current = newKey;
      setRevealed({}); setNewPassphrase(""); setConfirmNewPassphrase(""); setRotateOpen(false);
      await loadAccounts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to change passphrase");
    } finally { setBusy(false); }
  };

  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setShowFormPassword(false); setError(null); setFormOpen(true);
  };

  const openEdit = (account: CorporateAccount) => {
    setEditing(account); setForm(accountToForm(account)); setShowFormPassword(false); setError(null); setFormOpen(true);
  };

  const saveAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.serviceName.trim() || busy || !encryptionKey.current) return;
    if (!editing && !form.password) { setError("A password or credential is required."); return; }
    if (editing && form.recoveryNotes && !form.password) {
      setError("Enter the password too when replacing recovery notes.");
      return;
    }
    setBusy(true); setError(null);
    try {
      const { password, recoveryNotes, ...metadata } = form;
      const encrypted = password
        ? await encryptVaultSecret(encryptionKey.current, { password, recoveryNotes: recoveryNotes || undefined })
        : {};
      const response = await fetch(editing ? `/api/corporate-accounts/${editing.id}` : "/api/corporate-accounts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...metadata, ...encrypted }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to save account");
      setForm(EMPTY_FORM); setFormOpen(false); setEditing(null);
      await loadAccounts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save account");
    } finally { setBusy(false); }
  };

  const revealSecret = async (account: CorporateAccount) => {
    if (revealed[account.id]) {
      setRevealed((current) => { const next = { ...current }; delete next[account.id]; return next; });
      return;
    }
    if (!encryptionKey.current || !account.encryptedSecret || !account.secretIv) return;
    try {
      const value = await decryptVaultSecret(encryptionKey.current, account.encryptedSecret, account.secretIv);
      setRevealed((current) => ({ ...current, [account.id]: value }));
      window.setTimeout(() => {
        setRevealed((current) => { const next = { ...current }; delete next[account.id]; return next; });
      }, 30_000);
    } catch {
      setError("This credential could not be decrypted with the current vault passphrase.");
    }
  };

  const copyPassword = async (accountId: string) => {
    const password = revealed[accountId]?.password;
    if (password) await navigator.clipboard.writeText(password);
  };

  const archiveAccount = async (account: CorporateAccount) => {
    if (!confirm(`Archive ${account.serviceName}?`) || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/corporate-accounts/${account.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to archive account");
      setAccounts((current) => current.filter((item) => item.id !== account.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to archive account");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <Header title="Corporation Vault" subtitle="Utility, vendor, and corporate account access" />
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {state === "loading" && <div className="flex justify-center py-20 text-stone-400"><Loader2 className="animate-spin" /></div>}

        {state === "unconfigured" && (
          <form onSubmit={setupVault} className="mx-auto max-w-sm space-y-4 py-8">
            <div className="text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-800 text-white"><ShieldCheck size={22} /></div>
              <h2 className="mt-4 text-lg font-semibold text-stone-900">Create the Corporation Vault</h2>
              <p className="mt-1 text-sm text-stone-500">Choose one strong shared passphrase and record a paper recovery copy.</p></div>
            <label className="block text-sm font-medium text-stone-700">New passphrase
              <input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-3" autoFocus />
            </label>
            <label className="block text-sm font-medium text-stone-700">Confirm passphrase
              <input type="password" autoComplete="new-password" value={confirmPassphrase} onChange={(event) => setConfirmPassphrase(event.target.value)} className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-3" />
            </label>
            <p className="text-xs text-stone-500">Use at least 14 characters. Losing this passphrase means losing access to encrypted credentials.</p>
            {confirmPassphrase && passphrase !== confirmPassphrase && <p className="text-sm text-red-700">Passphrases do not match.</p>}
            {error && <p className="text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={passphrase.length < 14 || passphrase !== confirmPassphrase || busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-800 px-4 py-3 font-medium text-white disabled:opacity-50">
              {busy && <Loader2 size={17} className="animate-spin" />} Create vault
            </button>
          </form>
        )}

        {state === "locked" && (
          <form onSubmit={unlock} className="mx-auto max-w-sm space-y-4 py-10">
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-stone-900 text-white"><LockKeyhole size={22} /></div>
              <h2 className="mt-4 text-lg font-semibold text-stone-900">Corporation vault locked</h2>
              <p className="mt-1 text-sm text-stone-500">Use the shared corporation vault passphrase.</p>
            </div>
            <label className="block text-sm font-medium text-stone-700">Passphrase
              <input type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-3 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100" autoFocus />
            </label>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={!passphrase || busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-800 px-4 py-3 font-medium text-white disabled:opacity-50">
              {busy ? <Loader2 size={17} className="animate-spin" /> : <KeyRound size={17} />} Unlock
            </button>
          </form>
        )}

        {state === "unlocked" && (
          <>
            <section className="flex flex-col gap-3 border-b border-stone-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3"><ShieldCheck size={20} className="mt-0.5 flex-shrink-0 text-green-700" />
                <div><h2 className="font-semibold text-stone-900">Encrypted corporation credentials</h2>
                  <p className="text-sm text-stone-500">Secrets decrypt only on this unlocked screen and hide again after 30 seconds.</p></div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setError(null); setRotateOpen(true); }} className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-medium" title="Change vault passphrase"><KeyRound size={17} /> Change</button>
                <button onClick={lock} className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-medium" title="Lock vault"><LogOut size={17} /> Lock</button>
              </div>
            </section>

            <section className="flex items-center gap-2">
              <div className="relative flex-1"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search accounts" className="w-full rounded-lg border border-stone-300 py-2.5 pl-9 pr-3 outline-none focus:border-green-600" />
              </div>
              <button onClick={openCreate} className="flex min-h-10 items-center gap-2 rounded-lg bg-green-800 px-3 text-sm font-medium text-white"><Plus size={17} /> Add</button>
            </section>

            {error && <p className="border-l-4 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

            {filteredAccounts.length === 0 ? (
              <section className="py-16 text-center text-stone-400"><Building2 size={36} className="mx-auto mb-3" />
                <p className="text-sm">{search ? "No matching accounts" : "No corporation accounts recorded yet"}</p></section>
            ) : (
              <section className="space-y-3">
                {filteredAccounts.map((account) => {
                  const secret = revealed[account.id];
                  return (
                    <article key={account.id} className="rounded-lg border border-stone-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-stone-900">{account.serviceName}</h3>
                            <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{categoryLabel(account.category)}</span></div>
                          {account.username && <p className="mt-2 break-all text-sm text-stone-700">Login: {account.username}</p>}
                          {account.accountNumberLast4 && <p className="mt-1 text-sm text-stone-600">Account ending {account.accountNumberLast4}</p>}
                          {account.responsiblePerson && <p className="mt-1 text-sm text-stone-600">Responsible: {account.responsiblePerson}</p>}
                          {account.recoveryContact && <p className="mt-1 break-all text-sm text-stone-600">Recovery: {account.recoveryContact}</p>}
                          {account.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-stone-500">{account.notes}</p>}
                        </div>
                        <div className="flex flex-shrink-0 gap-1">
                          {account.loginUrl && <a href={account.loginUrl} target="_blank" rel="noreferrer" className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-stone-100" title="Open login"><ExternalLink size={16} /></a>}
                          <button onClick={() => openEdit(account)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-stone-100" title="Edit account"><Pencil size={16} /></button>
                          <button onClick={() => archiveAccount(account)} className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-700" title="Archive account"><Archive size={16} /></button>
                        </div>
                      </div>
                      <div className="mt-3 border-t border-stone-100 pt-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => void revealSecret(account)} className="flex min-h-9 items-center gap-2 rounded-lg bg-stone-100 px-3 text-sm font-medium text-stone-700">
                            {secret ? <EyeOff size={16} /> : <Eye size={16} />} {secret ? "Hide password" : "Reveal password"}
                          </button>
                          {secret && <button onClick={() => void copyPassword(account.id)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200" title="Copy password"><Copy size={16} /></button>}
                        </div>
                        {secret && <div className="mt-3 rounded-lg bg-stone-900 px-3 py-3 font-mono text-sm text-white">
                          <p className="break-all">{secret.password}</p>
                          {secret.recoveryNotes && <p className="mt-3 whitespace-pre-wrap border-t border-stone-700 pt-3 text-xs text-stone-300">{secret.recoveryNotes}</p>}
                        </div>}
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
          </>
        )}
      </main>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <form onSubmit={saveAccount} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-lg bg-white p-5 sm:rounded-lg">
            <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold text-stone-900">{editing ? "Edit account" : "Add account"}</h2>
              <button type="button" onClick={() => setFormOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-stone-100" title="Close"><X size={18} /></button></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-stone-700 sm:col-span-2">Service name<input required value={form.serviceName} onChange={(event) => setForm({ ...form, serviceName: event.target.value })} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" /></label>
              <label className="text-sm font-medium text-stone-700">Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5">{CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
              <label className="text-sm font-medium text-stone-700">Account ending<input maxLength={4} value={form.accountNumberLast4} onChange={(event) => setForm({ ...form, accountNumberLast4: event.target.value.replace(/\s/g, "") })} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" placeholder="Last 4 only" /></label>
              <label className="text-sm font-medium text-stone-700 sm:col-span-2">Login URL<input type="url" value={form.loginUrl} onChange={(event) => setForm({ ...form, loginUrl: event.target.value })} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" placeholder="https://" /></label>
              <label className="text-sm font-medium text-stone-700 sm:col-span-2">Username or email<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" /></label>
              <label className="relative text-sm font-medium text-stone-700 sm:col-span-2">{editing ? "New password (leave blank to keep current)" : "Password or credential"}
                <input type={showFormPassword ? "text" : "password"} required={!editing} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 pr-11" />
                <button type="button" onClick={() => setShowFormPassword((current) => !current)} className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center" title={showFormPassword ? "Hide password" : "Show password"}>{showFormPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </label>
              <label className="text-sm font-medium text-stone-700">Responsible person<input value={form.responsiblePerson} onChange={(event) => setForm({ ...form, responsiblePerson: event.target.value })} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" /></label>
              <label className="text-sm font-medium text-stone-700">Recovery contact<input value={form.recoveryContact} onChange={(event) => setForm({ ...form, recoveryContact: event.target.value })} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" /></label>
              <label className="text-sm font-medium text-stone-700 sm:col-span-2">Recovery codes or secret notes<textarea rows={3} value={form.recoveryNotes} onChange={(event) => setForm({ ...form, recoveryNotes: event.target.value })} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" placeholder={editing ? "Leave blank unless replacing the password" : "Encrypted with the password"} /></label>
              <label className="text-sm font-medium text-stone-700 sm:col-span-2">Operational notes<textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" /></label>
            </div>
            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={!form.serviceName.trim() || (!editing && !form.password) || busy} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-green-800 px-4 py-3 font-medium text-white disabled:opacity-50">{busy && <Loader2 size={17} className="animate-spin" />}{editing ? "Save changes" : "Add account"}</button>
          </form>
        </div>
      )}

      {rotateOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <form onSubmit={rotatePassphrase} className="w-full max-w-md rounded-t-lg bg-white p-5 sm:rounded-lg">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold text-stone-900">Change vault passphrase</h2>
              <button type="button" onClick={() => setRotateOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-stone-100" title="Close"><X size={18} /></button></div>
            <p className="mb-4 text-sm text-stone-600">Every saved credential will be re-encrypted before the new passphrase takes effect.</p>
            <div className="space-y-4">
              <label className="block text-sm font-medium text-stone-700">New passphrase<input type="password" autoComplete="new-password" value={newPassphrase} onChange={(event) => setNewPassphrase(event.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" /></label>
              <label className="block text-sm font-medium text-stone-700">Confirm passphrase<input type="password" autoComplete="new-password" value={confirmNewPassphrase} onChange={(event) => setConfirmNewPassphrase(event.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" /></label>
            </div>
            {confirmNewPassphrase && newPassphrase !== confirmNewPassphrase && <p className="mt-3 text-sm text-red-700">Passphrases do not match.</p>}
            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={newPassphrase.length < 14 || newPassphrase !== confirmNewPassphrase || busy} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-green-800 px-4 py-3 font-medium text-white disabled:opacity-50">{busy && <Loader2 size={17} className="animate-spin" />} Re-encrypt and change</button>
          </form>
        </div>
      )}
    </div>
  );
}
