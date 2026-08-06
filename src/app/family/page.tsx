"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { FamilyTree, TreePerson } from "@/lib/family-tree";
import { ancestorPath, defaultPlateRoot } from "@/lib/family-plate";
import { FamilyPlate } from "@/components/family/family-plate";

interface ActorSummary {
  memberId: string;
  displayName: string;
  branch: string | null;
  isCurator: boolean;
}

interface TreeResponse {
  tree: FamilyTree;
  actor: ActorSummary | null;
  signedIn: boolean;
  doorBranch: string | null;
}

export default function FamilyPage() {
  const [data, setData] = useState<TreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Null until the tree loads; the default centre is a founder when one exists.
  const [plateRoot, setPlateRoot] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/family/tree");
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tree = data?.tree;
  const actor = data?.actor ?? null;

  const peopleCount = tree ? Object.keys(tree.people).length : 0;

  useEffect(() => {
    if (tree && !plateRoot) setPlateRoot(defaultPlateRoot(tree));
  }, [tree, plateRoot]);

  const signOutIdentity = async () => {
    await fetch("/api/family/claim", { method: "DELETE" });
    load();
  };

  // "Find me" re-centres the plate on the signed-in member and opens their sheet.
  const jumpToMe = () => {
    if (!actor || !tree) return;
    const me = tree.people[actor.memberId];
    if (me?.childIds.length) setPlateRoot(actor.memberId);
    setSelectedId(actor.memberId);
  };

  return (
    <div>
      <div className="chrome-top">
        <div className="wordmark">
          Breadloaf <em>Hill</em>
        </div>
        <div className="ctr">The Family</div>
      </div>

      {/* Identity strip. The tree is readable signed out, so this is also the
          prompt that tells a first-time relative what to do. */}
      <div className="tree-status">
        {actor ? (
          <>
            <div className="who">
              Signed in as <em>{actor.displayName}</em>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              <button className="act" onClick={jumpToMe}>
                Find me
              </button>
              <button className="act" onClick={signOutIdentity}>
                Not you?
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="who">
              {data?.signedIn ? (
                <>
                  Tap your name to <em>claim it</em>
                </>
              ) : (
                <>
                  Find yourself in <em>the tree</em>
                </>
              )}
            </div>
            {!data?.signedIn && (
              <Link href="/login" className="act">
                Sign in
              </Link>
            )}
          </>
        )}
      </div>

      <div className="chapter-intro">
        <div className="number">Chapter XIV — The Family</div>
        <div className="lede">
          Four brothers, their families, and everyone who has come along{" "}
          <em>since</em>.
        </div>
      </div>

      <div className="colophon">
        <div>
          <div className="k">People</div>
          <div className="v">{peopleCount}</div>
        </div>
        <div>
          <div className="k">Generations</div>
          <div className="v">{tree?.generationCount ?? 0}</div>
        </div>
        <div>
          <div className="k">Branches</div>
          <div className="v">{tree?.branches.length ?? 0}</div>
        </div>
      </div>

      {/* Navigation, not a form control. The trail is the blood line down to
          whoever is centred — tap back up it to widen out, tap a name on the plate
          to go down. */}
      {tree && plateRoot && (
        <div className="plate-trail">
          {ancestorPath(tree, plateRoot).map((id, index, all) => {
            const person = tree.people[id];
            if (!person) return null;
            const isHere = index === all.length - 1;
            return (
              <span key={id} className="plate-trail-step">
                {index > 0 && <span className="sep">›</span>}
                <button
                  className={isHere ? "here" : ""}
                  aria-current={isHere ? "true" : undefined}
                  onClick={() => setPlateRoot(id)}
                >
                  {person.displayName}
                  {person.isFounder ? " ✦" : ""}
                </button>
              </span>
            );
          })}
        </div>
      )}

      {tree && plateRoot && (
        <FamilyPlate tree={tree} rootId={plateRoot} onSelect={setSelectedId} />
      )}

      {loading && <div className="tree-empty">Drawing the family plate…</div>}

      {!loading && tree && tree.branches.length === 0 && (
        <div className="tree-empty">
          No family recorded yet. Run the roster script to plant the tree.
        </div>
      )}

      {selectedId && tree && (
        <PersonSheet
          person={tree.people[selectedId]}
          people={tree.people}
          signedIn={Boolean(data?.signedIn)}
          isYou={actor?.memberId === selectedId}
          onClose={() => setSelectedId(null)}
          onSelect={setSelectedId}
          onClaimed={() => {
            setSelectedId(null);
            load();
          }}
          onCentre={
            tree.people[selectedId]?.childIds.length
              ? () => {
                  setPlateRoot(selectedId);
                  setSelectedId(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function PersonSheet({
  person,
  people,
  signedIn,
  isYou,
  onClose,
  onSelect,
  onClaimed,
  onCentre,
}: {
  person: TreePerson | undefined;
  people: Record<string, TreePerson>;
  signedIn: boolean;
  isYou: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onClaimed: () => void;
  /** Only supplied on the plate, and only for someone who has descendants. */
  onCentre?: () => void;
}) {
  const [claiming, setClaiming] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPinRequired(false);
    setPin("");
    setError(null);
  }, [person?.id]);

  if (!person) return null;

  const nameOf = (id: string) => people[id]?.displayName ?? "—";
  const relation = (ids: string[]) => ids.map(nameOf).join(", ");

  const claim = async () => {
    setClaiming(true);
    setError(null);
    const res = await fetch("/api/family/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: person.id, pin: pin || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setClaiming(false);

    if (res.ok) {
      onClaimed();
      return;
    }
    if (body?.pinRequired) setPinRequired(true);
    setError(body?.error ?? "That didn't work. Try again.");
  };

  return (
    <div
      className="sheet-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <div className="sheet-head">
          <div>
            <div className="nm">
              <em>{person.displayName}</em>
              {person.surname ? ` ${person.surname}` : ""}
            </div>
            <div className="sub">
              {[
                person.isFounder ? "founder" : null,
                person.lineage === "ancestor"
                  ? "Forebear"
                  : person.lineage === "affine"
                    ? "Married in"
                    : person.branch?.replace(/'s family$/, "'s side") ?? "Descendant",
                person.deceased ? "in memory" : null,
                person.isMinor ? "next generation" : null,
                person.isCurator ? "curator" : null,
                person.boardRole,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {person.fullName !== person.displayName && (
          <div className="sheet-row">
            <div className="k">Full name</div>
            <div className="v">{person.fullName}</div>
          </div>
        )}
        {person.maidenName && person.maidenName !== person.surname && (
          <div className="sheet-row">
            <div className="k">Née</div>
            <div className="v">{person.maidenName}</div>
          </div>
        )}
        {person.parentIds.length > 0 && (
          <div className="sheet-row">
            <div className="k">Parents</div>
            <div className="v">
              {person.parentIds.map((id, index) => (
                <span key={id}>
                  {index > 0 && ", "}
                  <button className="lnk" onClick={() => onSelect(id)}>
                    {nameOf(id)}
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        {person.currentSpouseIds.length > 0 && (
          <div className="sheet-row">
            <div className="k">Married to</div>
            <div className="v">{relation(person.currentSpouseIds)}</div>
          </div>
        )}
        {person.formerSpouseIds.length > 0 && (
          <div className="sheet-row">
            <div className="k">Previously</div>
            <div className="v">{relation(person.formerSpouseIds)}</div>
          </div>
        )}
        {person.childIds.length > 0 && (
          <div className="sheet-row">
            <div className="k">Children</div>
            <div className="v">
              {person.childIds.map((id, index) => (
                <span key={id}>
                  {index > 0 && ", "}
                  <button className="lnk" onClick={() => onSelect(id)}>
                    {nameOf(id)}
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Contact detail exists only for viewers who came through the door. */}
        {signedIn && person.phone && (
          <div className="sheet-row">
            <div className="k">Phone</div>
            <div className="v">
              <a href={`tel:${person.phone.replace(/[^+\d]/g, "")}`}>{person.phone}</a>
            </div>
          </div>
        )}
        {signedIn && person.email && (
          <div className="sheet-row">
            <div className="k">Email</div>
            <div className="v">
              <a href={`mailto:${person.email}`}>{person.email}</a>
            </div>
          </div>
        )}
        {signedIn && person.birthday && (
          <div className="sheet-row">
            <div className="k">Birthday</div>
            <div className="v">{person.birthday}</div>
          </div>
        )}
        {signedIn && person.notes && (
          <div className="sheet-row">
            <div className="k">Notes</div>
            <div className="v">{person.notes}</div>
          </div>
        )}
        {signedIn && person.needsReview && (
          <div className="sheet-note">Needs confirming — {person.needsReview}</div>
        )}

        {onCentre && (
          <button className="btn-quiet sheet-centre" onClick={onCentre}>
            Centre the plate on {person.displayName}
          </button>
        )}

        {error && <div className="sheet-error">{error}</div>}

        {isYou ? (
          <div className="sheet-claim">
            <div className="pitch">
              This is <em>you</em>. This device will stay signed in as {person.displayName}.
            </div>
          </div>
        ) : person.canClaim && signedIn ? (
          <div className="sheet-claim">
            <div className="pitch">
              {person.isClaimed ? (
                <>
                  Someone has used this profile before. Is it <em>you</em>?
                </>
              ) : (
                <>
                  Is this <em>you</em>?
                </>
              )}
            </div>
            {pinRequired && (
              <input
                className="w-full px-3 py-3 mb-2 border border-[var(--rule)] bg-[var(--paper)] font-mono text-sm tracking-widest"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder="PIN"
                inputMode="numeric"
                autoFocus
              />
            )}
            <button className="btn-ember" onClick={claim} disabled={claiming}>
              {claiming ? "One moment…" : `Yes — I'm ${person.displayName}`}
            </button>
            <button className="btn-quiet" onClick={onClose}>
              Not me
            </button>
          </div>
        ) : person.canClaim && !signedIn ? (
          <div className="sheet-claim">
            <div className="pitch">
              Sign in with your family PIN to <em>claim this profile</em>.
            </div>
            <Link href="/login" className="btn-ember block text-center">
              Sign in
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
