"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { FamilyTree, TreePerson, TreeUnit } from "@/lib/family-tree";

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
  const [activeBranch, setActiveBranch] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const unitById = useMemo(() => {
    const map = new Map<string, TreeUnit>();
    for (const unit of tree?.units ?? []) map.set(unit.id, unit);
    return map;
  }, [tree]);

  const unitOfMember = useMemo(() => {
    const map = new Map<string, string>();
    for (const unit of tree?.units ?? []) {
      for (const memberId of unit.memberIds) map.set(memberId, unit.id);
    }
    return map;
  }, [tree]);

  const visibleBranches = useMemo(() => {
    if (!tree) return [];
    return activeBranch
      ? tree.branches.filter((branch) => branch.key === activeBranch)
      : tree.branches;
  }, [tree, activeBranch]);

  const peopleCount = tree ? Object.keys(tree.people).length : 0;

  const signOutIdentity = async () => {
    await fetch("/api/family/claim", { method: "DELETE" });
    load();
  };

  const jumpToMe = () => {
    if (!actor) return;
    setActiveBranch(null);
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

      {tree && tree.branches.length > 1 && (
        <div className="tree-filters">
          <button
            className="tree-chip"
            aria-pressed={activeBranch === null}
            onClick={() => setActiveBranch(null)}
          >
            All
          </button>
          {tree.branches.map((branch) => (
            <button
              key={branch.key}
              className="tree-chip"
              aria-pressed={activeBranch === branch.key}
              onClick={() => setActiveBranch(branch.key)}
            >
              {branch.label.replace(/'s family$/, "")}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="tree-empty">Drawing the family plate…</div>
      ) : !tree || tree.branches.length === 0 ? (
        <div className="tree-empty">
          No family recorded yet. Run the roster script to plant the tree.
        </div>
      ) : (
        <>
          {/* Generations above the branch split. Shown without descending, since
              their children each head a branch section below. */}
          {activeBranch === null && tree.ancestorUnitIds.length > 0 && (
            <section>
              <div className="section-head">
                <div className="lt">
                  <em>Forebears</em>
                </div>
                <div className="rt">Where it starts</div>
              </div>
              <div className="branch-body">
                {tree.ancestorUnitIds.map((unitId) => (
                  <UnitNode
                    key={unitId}
                    unitId={unitId}
                    unitById={unitById}
                    unitOfMember={unitOfMember}
                    people={tree.people}
                    actorId={actor?.memberId ?? null}
                    onSelect={setSelectedId}
                    seen={new Set()}
                    descend={false}
                  />
                ))}
              </div>
            </section>
          )}

          {visibleBranches.map((branch, index) => (
          <section key={branch.key}>
            <div className="section-head">
              <div className="lt">
                <em>{branch.label.replace(/'s family$/, "'s")}</em>
              </div>
              <div className="rt">
                {
                  Object.values(tree.people).filter(
                    (person) => person.branch === branch.key
                  ).length
                }{" "}
                people
              </div>
            </div>
            <div className="branch-body">
              <UnitNode
                unitId={branch.rootUnitId}
                unitById={unitById}
                unitOfMember={unitOfMember}
                people={tree.people}
                actorId={actor?.memberId ?? null}
                onSelect={setSelectedId}
                seen={new Set()}
              />
            </div>
          </section>
          ))}
        </>
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
        />
      )}
    </div>
  );
}

/** One couple (or single person) plus everyone descended from them. */
function UnitNode({
  unitId,
  unitById,
  unitOfMember,
  people,
  actorId,
  onSelect,
  seen,
  descend = true,
}: {
  unitId: string;
  unitById: Map<string, TreeUnit>;
  unitOfMember: Map<string, string>;
  people: Record<string, TreePerson>;
  actorId: string | null;
  onSelect: (id: string) => void;
  seen: Set<string>;
  /** Forebears render without descending — their children head their own branches. */
  descend?: boolean;
}) {
  const unit = unitById.get(unitId);
  // Cycles would be malformed data, but a family tree must never hang the page.
  if (!unit || seen.has(unitId)) return null;
  const nextSeen = new Set(seen).add(unitId);

  const [anchorId, ...partnerIds] = unit.memberIds;
  const anchor = people[anchorId];
  if (!anchor) return null;

  const childUnitIds: string[] = [];
  for (const childId of unit.childIds) {
    const childUnitId = unitOfMember.get(childId);
    if (childUnitId && !childUnitIds.includes(childUnitId)) childUnitIds.push(childUnitId);
  }

  return (
    <div className="kin-unit">
      <KinRow person={anchor} actorId={actorId} onSelect={onSelect} />

      {partnerIds.map((partnerId) => {
        const partner = people[partnerId];
        if (!partner) return null;
        return (
          <div className="kin-partner" key={partnerId}>
            <KinRow person={partner} actorId={actorId} onSelect={onSelect} prefix="married" />
          </div>
        );
      })}

      {/* Former partners are shown but never absorbed into the couple, so the
          children of an earlier marriage stay attached to the right parent. */}
      {unit.formerPartnerIds.map((formerId) => {
        const former = people[formerId];
        if (!former) return null;
        return (
          <div className="kin-partner kin-former" key={formerId}>
            <KinRow
              person={former}
              actorId={actorId}
              onSelect={onSelect}
              prefix="previously"
            />
          </div>
        );
      })}

      {descend && childUnitIds.length > 0 && (
        <div className="kin-descend">
          {childUnitIds.map((childUnitId) => (
            <UnitNode
              key={childUnitId}
              unitId={childUnitId}
              unitById={unitById}
              unitOfMember={unitOfMember}
              people={people}
              actorId={actorId}
              onSelect={onSelect}
              seen={nextSeen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KinRow({
  person,
  actorId,
  onSelect,
  prefix,
}: {
  person: TreePerson;
  actorId: string | null;
  onSelect: (id: string) => void;
  prefix?: string;
}) {
  const isYou = actorId === person.id;
  const classes = [
    "kin",
    person.isClaimed ? "is-claimed" : "",
    isYou ? "is-you" : "",
    person.isMinor ? "is-minor" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sub = [
    prefix,
    person.maidenName && person.maidenName !== person.surname
      ? `née ${person.maidenName}`
      : null,
    person.deceased ? "in memory" : null,
    isYou ? "you" : null,
    person.boardRole,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button className={classes} onClick={() => onSelect(person.id)}>
      <span className="face">
        {person.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={person.photoUrl} alt="" />
        ) : (
          person.initials
        )}
      </span>
      <span>
        <span className="nm">
          {person.displayName}
          {person.surname ? ` ${person.surname}` : ""}
        </span>
        {sub && <span className="sub">{sub}</span>}
      </span>
    </button>
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
}: {
  person: TreePerson | undefined;
  people: Record<string, TreePerson>;
  signedIn: boolean;
  isYou: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onClaimed: () => void;
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
                person.branch?.replace(/'s family$/, "'s side") ?? "Forebear",
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
