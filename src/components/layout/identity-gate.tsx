"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { IdentityChoice } from "@/lib/identity-prompt";

interface ActorSummary {
  memberId: string;
  displayName: string;
}

interface IdentityStatus {
  doorFamily: string;
  actor: ActorSummary | null;
  shouldPrompt: boolean;
  branchMembers: IdentityChoice[];
  allMembers: IdentityChoice[];
}

const SOMEONE_ELSE = "__someone_else__";

export function IdentityGate() {
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [memberId, setMemberId] = useState("");
  const [pinRequired, setPinRequired] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/family/identity", { cache: "no-store" });
    if (!response.ok) return;
    setStatus(await response.json());
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const choices = useMemo(
    () => (showAll ? status?.allMembers || [] : status?.branchMembers || []),
    [showAll, status]
  );

  const skip = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/family/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "skip" }),
    });
    setBusy(false);
    if (!response.ok) {
      setError("That didn’t stick. Please try once more.");
      return;
    }
    setStatus((current) => current ? { ...current, shouldPrompt: false } : current);
  };

  const claim = async () => {
    if (!memberId) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/family/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId,
        pin: pin || undefined,
        claimContext: "door",
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      if (body?.pinRequired) setPinRequired(true);
      setError(body?.error || "That didn’t work. Try again.");
      return;
    }

    setPinRequired(false);
    setPin("");
    await loadStatus();
  };

  const changeIdentity = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/family/claim", { method: "DELETE" });
    setBusy(false);
    if (!response.ok) return;
    setShowAll(false);
    setMemberId("");
    await loadStatus();
  };

  return (
    <>
      {status?.actor && (
        <div className="identity-chrome" aria-label={`Using Breadloaf Hill as ${status.actor.displayName}`}>
          <span>Here as <em>{status.actor.displayName}</em></span>
          <button type="button" onClick={changeIdentity} disabled={busy}>
            Not you?
          </button>
        </div>
      )}

      {status?.shouldPrompt && (
        <div className="identity-scrim" role="presentation">
          <section className="identity-dialog" role="dialog" aria-modal="true" aria-labelledby="identity-title">
            <div className="identity-eyebrow">One quick thing</div>
            <h2 id="identity-title">Who’s using this device?</h2>
            <p>
              This helps Bucky and new records remember who did what. It never controls access.
            </p>

            <label htmlFor="identity-member">Your name</label>
            <select
              id="identity-member"
              value={memberId}
              onChange={(event) => {
                if (event.target.value === SOMEONE_ELSE) {
                  setShowAll(true);
                  setMemberId("");
                } else {
                  setMemberId(event.target.value);
                }
                setPinRequired(false);
                setPin("");
                setError(null);
              }}
              autoFocus
            >
              <option value="">Choose your name</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.displayName === choice.fullName
                    ? choice.fullName
                    : `${choice.displayName} — ${choice.fullName}`}
                </option>
              ))}
              {!showAll && <option value={SOMEONE_ELSE}>Someone else…</option>}
            </select>

            {showAll && (
              <div className="identity-list-note">Showing all claimable adults</div>
            )}

            {pinRequired && (
              <>
                <label htmlFor="identity-pin">Your personal PIN</label>
                <input
                  id="identity-pin"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                />
              </>
            )}

            {error && <div className="identity-error">{error}</div>}

            <button
              type="button"
              className="btn-ember"
              onClick={claim}
              disabled={!memberId || busy || (pinRequired && !pin)}
            >
              {busy ? "One moment…" : "That’s me"}
            </button>
            <button type="button" className="btn-quiet" onClick={skip} disabled={busy}>
              Skip on this device
            </button>
          </section>
        </div>
      )}
    </>
  );
}
