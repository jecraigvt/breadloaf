"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { FamilyTree, TreePerson } from "@/lib/family-tree";
import {
  ancestorPath,
  defaultPlateRoot,
  type PlateDirection,
} from "@/lib/family-plate";
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
  const [plateDirection, setPlateDirection] = useState<PlateDirection>("descent");

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

  // "Find me" re-centres the plate on the signed-in member and opens their sheet.
  const jumpToMe = () => {
    if (!actor || !tree) return;
    const me = tree.people[actor.memberId];
    if (me?.childIds.length) {
      setPlateDirection("descent");
      setPlateRoot(actor.memberId);
    } else if (me?.parentIds.length) {
      setPlateDirection("ascent");
      setPlateRoot(actor.memberId);
    }
    setSelectedId(actor.memberId);
  };

  const centrePlate = (id: string, direction: PlateDirection) => {
    setPlateRoot(id);
    setPlateDirection(direction);
    setSelectedId(null);
  };

  const selectedPerson = selectedId && tree ? tree.people[selectedId] : undefined;
  const selectedCentreDirection: PlateDirection | null = selectedPerson
    ? plateDirection === "descent" && selectedPerson.childIds.length
      ? "descent"
      : plateDirection === "ascent" && selectedPerson.parentIds.length
        ? "ascent"
        : selectedPerson.childIds.length
          ? "descent"
          : selectedPerson.parentIds.length
            ? "ascent"
            : null
    : null;

  return (
    <div>
      <div className="chrome-top">
        <div className="wordmark">
          Breadloaf <em>Hill</em>
        </div>
        <div className="ctr">The Family</div>
      </div>

      {/* Identity is claimed at the door now, so this strip only reports who
          the device belongs to and helps you find yourself on the plate. It no
          longer invites claiming — asking twice, in two different shapes, was
          how claiming ended up reaching one person out of twenty-five. */}
      <div className="tree-status">
        {actor ? (
          <>
            <div className="who">
              Signed in as <em>{actor.displayName}</em>
            </div>
            <button className="act" onClick={jumpToMe}>
              Find me
            </button>
          </>
        ) : (
          <>
            <div className="who">
              The Craig family, <em>four generations</em>
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

      {tree && plateRoot && (
        <div className="view-toggle" aria-label="Family plate direction">
          <button
            type="button"
            aria-pressed={plateDirection === "descent"}
            onClick={() => setPlateDirection("descent")}
          >
            Descendants
          </button>
          <button
            type="button"
            aria-pressed={plateDirection === "ascent"}
            onClick={() => setPlateDirection("ascent")}
          >
            Ancestors
          </button>
        </div>
      )}

      {/* Navigation, not a form control. The trail is the blood line down to
          whoever is centred — tap back up it to widen out, tap a name on the plate
          to go down. */}
      {tree && plateRoot && plateDirection === "descent" && (
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
        <FamilyPlate
          tree={tree}
          rootId={plateRoot}
          direction={plateDirection}
          onSelect={setSelectedId}
          onDoorway={(id) =>
            centrePlate(id, plateDirection === "descent" ? "ascent" : "descent")
          }
        />
      )}

      {loading && <div className="tree-empty">Drawing the family plate…</div>}

      {!loading && tree && tree.branches.length === 0 && (
        <div className="tree-empty">
          No family recorded yet. Run the roster script to plant the tree.
        </div>
      )}

      {selectedId && tree && (
        <PersonSheet
          person={selectedPerson}
          people={tree.people}
          signedIn={Boolean(data?.signedIn)}
          isYou={actor?.memberId === selectedId}
          onClose={() => setSelectedId(null)}
          onSelect={setSelectedId}
          onCentre={
            selectedCentreDirection
              ? () => centrePlate(selectedId, selectedCentreDirection)
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
  onCentre,
}: {
  person: TreePerson | undefined;
  people: Record<string, TreePerson>;
  signedIn: boolean;
  isYou: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  /** Supplied when this person can anchor the active or opposite plate direction. */
  onCentre?: () => void;
}) {
  if (!person) return null;

  const nameOf = (id: string) => people[id]?.displayName ?? "—";
  const relation = (ids: string[]) => ids.map(nameOf).join(", ");

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

        {/* No claiming here. A device says who it belongs to once, at the door,
            where the branch is already known and the list is a handful of names.
            The sheet is for reading a person and navigating to them. */}
        {isYou && (
          <div className="sheet-claim">
            <div className="pitch">
              This is <em>you</em>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
