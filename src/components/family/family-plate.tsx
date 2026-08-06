"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FamilyTree, TreePerson } from "@/lib/family-tree";
import {
  layoutPlate,
  onSameLine,
  type PlateDirection,
  type PlateSlot,
} from "@/lib/family-plate";

/**
 * The family as a cross-section: each generation is a growth ring, with the next
 * generation nested inside its connecting person's arc. Layout and direction come
 * from `@/lib/family-plate`; this file only draws them.
 *
 * The coordinate system tracks the rendered width so one SVG unit is always one CSS
 * pixel — a fixed viewBox squeezed into the 440px shell halves every label.
 */

const BRANCH_TINTS = ["#e0e4e8", "#ebdcd4", "#dee6dd", "#efe4cf"];

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** Arcs below the horizon are drawn backwards so lettering stays upright. */
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const mid = (a0 + a1) / 2;
  const flip = mid > 90 && mid < 270;
  const [x0, y0] = polar(cx, cy, r, flip ? a1 : a0);
  const [x1, y1] = polar(cx, cy, r, flip ? a0 : a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} ${flip ? 0 : 1} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function wedgePath(
  cx: number, cy: number, r0: number, r1: number, a0: number, a1: number
): string {
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const [ix0, iy0] = polar(cx, cy, r0, a0);
  const [ox0, oy0] = polar(cx, cy, r1, a0);
  const [ox1, oy1] = polar(cx, cy, r1, a1);
  const [ix1, iy1] = polar(cx, cy, r0, a1);
  return `M ${ix0} ${iy0} L ${ox0} ${oy0} A ${r1} ${r1} 0 ${large} 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${r0} ${r0} 0 ${large} 0 ${ix0} ${iy0} Z`;
}

// Bloodline is position, not colour: the inner radius and the spoke to the
// centre already say who carries the line, so descent must not also be painted.
// Muting the non-blood half of a couple only looked deliberate while every
// centre was a Craig and the muted person was always the one who married in.
// Once any person can be centred, that rule greys the viewer on their own
// family's plate — centre Colleen's parents and Jeremy fades out beside her.
// Muted now means deceased, which is the one case where absence is the point.
function tintOf(person: TreePerson | undefined): string {
  if (!person) return "var(--muted)";
  if (person.isClaimed) return "var(--ember-deep)";
  return person.deceased ? "var(--muted)" : "var(--ink)";
}

export function FamilyPlate({
  tree,
  rootId,
  direction,
  onSelect,
  onDoorway,
}: {
  tree: FamilyTree;
  rootId: string;
  direction: PlateDirection;
  onSelect: (id: string) => void;
  onDoorway: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(420);
  const [lit, setLit] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const width = host.getBoundingClientRect().width;
      if (width > 0) setSize(Math.max(300, Math.min(680, Math.round(width))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Descent gets two rings inside the shell (three when wide). Ascent gets one
  // parent ring because it doubles outward; re-centring continues either line.
  // Ascent doubles per ring where descent narrows, so it caps lower — but two
  // rings fit comfortably and one was too strict. Measured against the live
  // tree: centring Jeremy at depth 2 puts Bill and Lois on the outer ring at
  // 126° each, and the narrowest slice on the plate is 108°, against a 52°
  // minimum. Depth 3 is the real wall: eight great-grandparents split evenly is
  // 45°, under the minimum. The cap is angular, so a wider shell does not help.
  const maxDepth = direction === "ascent" ? 2 : size < 520 ? 2 : 3;
  const layout = useMemo(
    () => layoutPlate(tree, rootId, { direction, maxDepth }),
    [tree, rootId, direction, maxDepth]
  );
  const doorwayIds = useMemo(() => new Set(layout.doorwayIds), [layout.doorwayIds]);
  const isAscent = direction === "ascent";

  const cx = size / 2;
  const cy = size / 2;
  const coreR = size * (layout.ringCount > 2 ? 0.15 : 0.175);
  const outerR = size * 0.455;
  const gap = size * 0.026;
  const band = (outerR - coreR - gap * layout.ringCount) / Math.max(1, layout.ringCount);

  const root = layout.root;
  const rootPerson = tree.people[rootId];
  const coParents = root.partners.filter((p) => p.coParent);
  const otherSpouses = root.partners.filter((p) => !p.coParent);
  const core = [rootPerson, ...coParents.map((p) => tree.people[p.id])].filter(Boolean);
  const isFounders = !isAscent && core.some((p) => p?.isFounder);

  if (!rootPerson || !layout.slots.length) {
    return (
      <div ref={hostRef} className="plate-empty">
        {rootPerson
          ? `${rootPerson.displayName} has no ${isAscent ? "parents" : "descendants"} recorded.`
          : "Nothing to draw yet."}
      </div>
    );
  }

  const radiiFor = (depth: number) => {
    const r0 = coreR + gap + depth * (band + gap);
    return { r0, r1: r0 + band };
  };

  const arcs: JSX.Element[] = [];
  const pushArc = (id: string, r: number, a0: number, a1: number) => {
    arcs.push(<path key={id} id={id} d={arcPath(cx, cy, r, a0, a1)} fill="none" />);
  };

  const doorwayMarker = (id: string, x: number, y: number) => {
    if (!doorwayIds.has(id)) return null;
    const name = tree.people[id]?.displayName ?? "this person";
    return (
      <g
        className="plate-doorway-hit"
        role="button"
        tabIndex={0}
        aria-label={`Follow ${name}'s ${isAscent ? "descendants" : "ancestors"}`}
        onClick={(event) => {
          event.stopPropagation();
          onDoorway(id);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          onDoorway(id);
        }}
      >
        <circle cx={x} cy={y} r={9} fill="transparent" />
        <circle cx={x} cy={y} r={3.25} className="plate-doorway" />
        <title>{`Follow ${name}'s ${isAscent ? "descendants" : "ancestors"}`}</title>
      </g>
    );
  };

  const slotGroups = layout.slots.map((slot: PlateSlot) => {
    const { r0, r1 } = radiiFor(slot.depth);
    const pad = (slot.endAngle - slot.startAngle) * 0.05;
    const a0 = slot.startAngle + pad;
    const a1 = slot.endAngle - pad;
    const people = [slot.node.id, ...slot.node.partners.map((p) => p.id)];
    const dim = lit !== null && !onSameLine(slot.path, lit);

    // Children of this node, for the bracket that makes parentage explicit.
    const kidSlots = layout.slots.filter(
      (s) => s.depth === slot.depth + 1 && s.path.startsWith(`${slot.path}.`)
    );

    return (
      <g
        key={slot.path}
        className="plate-slot"
        opacity={dim ? 0.16 : 1}
        onMouseEnter={() => setLit(slot.path)}
      >
        {/* Tapping does both jobs: lights the line of descent and opens the person
            sheet. Hover alone would leave the plate inert on a phone. */}
        <path
          d={wedgePath(cx, cy, r0 - gap, r1, slot.startAngle, slot.endAngle)}
          fill="transparent"
          style={{ cursor: "pointer" }}
          onClick={() => {
            setLit(slot.path);
            onSelect(slot.node.id);
          }}
        >
          <title>{tree.people[slot.node.id]?.displayName}</title>
        </path>

        {people.map((id, index) => {
          const person = tree.people[id];
          if (!person) return null;
          const frac =
            people.length === 1 ? 0.44 : 0.24 + index * (0.56 / (people.length - 1));
          const r = r0 + band * frac;
          const arcId = `plate-${slot.path}-${index}`;
          pushArc(arcId, r, a0, a1);
          const [markerX, markerY] = polar(cx, cy, r, a1 - 2);
          return (
            <g key={id}>
              <text
                className="plate-name"
                fontSize={slot.depth >= 2 ? 11.5 : 13.5}
                fontStyle={person.deceased ? "italic" : "normal"}
                fontWeight={person.isClaimed ? 700 : 400}
                style={{ fill: tintOf(person), cursor: "pointer" }}
                onClick={() => {
                  setLit(slot.path);
                  onSelect(id);
                }}
              >
                <textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">
                  {person.displayName}
                </textPath>
              </text>
              {doorwayMarker(id, markerX, markerY)}
            </g>
          );
        })}

        {/* Every directional node gets its own spoke to the person one ring inward. */}
        <line
          x1={polar(cx, cy, r0 - gap + 2, slot.midAngle)[0]}
          y1={polar(cx, cy, r0 - gap + 2, slot.midAngle)[1]}
          x2={polar(cx, cy, r0 - 2, slot.midAngle)[0]}
          y2={polar(cx, cy, r0 - 2, slot.midAngle)[1]}
          className="plate-spoke"
        />

        {/* Marriage rung between a stacked pair. */}
        {people.length > 1 && (
          <line
            x1={polar(cx, cy, r0 + band * 0.42, slot.midAngle)[0]}
            y1={polar(cx, cy, r0 + band * 0.42, slot.midAngle)[1]}
            x2={polar(cx, cy, r0 + band * 0.56, slot.midAngle)[0]}
            y2={polar(cx, cy, r0 + band * 0.56, slot.midAngle)[1]}
            className="plate-rung"
          />
        )}

        {kidSlots.length > 1 && (
          <path
            className="plate-bracket"
            d={arcPath(
              cx, cy, r1 + gap / 2,
              Math.min(...kidSlots.map((s) => s.midAngle)),
              Math.max(...kidSlots.map((s) => s.midAngle))
            )}
            fill="none"
          />
        )}

        {/* Depth limiting hid descendants — a tick says so rather than pretending. */}
        {slot.node.truncatedChildren ? (
          <circle
            cx={polar(cx, cy, r1 + gap * 0.5, slot.midAngle)[0]}
            cy={polar(cx, cy, r1 + gap * 0.5, slot.midAngle)[1]}
            r={2}
            className="plate-more"
          />
        ) : null}
      </g>
    );
  });

  const sealId = "plate-seal";
  const rimId = "plate-rim";

  return (
    <div ref={hostRef} className="plate-host">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        role="img"
        aria-label={`${isAscent ? "Ancestors" : "Descendants"} of ${rootPerson.displayName}`}
        onMouseLeave={() => setLit(null)}
      >
        <defs>
          {arcs}
          <path id={sealId} d={arcPath(cx, cy, outerR + 10, 182, 538)} fill="none" />
          <path id={rimId} d={arcPath(cx, cy, outerR + 10, 108, 252)} fill="none" />
        </defs>

        <circle cx={cx} cy={cy} r={outerR + 14} className="plate-ground" />
        <circle cx={cx} cy={cy} r={outerR + 14} className="plate-edge" />

        {/* Grain */}
        {Array.from({ length: Math.floor((outerR - coreR) / 7) }, (_, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={coreR + 6 + i * 7}
            className={i % 3 === 0 ? "plate-grain plate-grain--strong" : "plate-grain"}
          />
        ))}

        {/* Branch territory — deliberately not shaded down the generations. */}
        {layout.branchSpans.map((span, index) => {
          const start = layout.branchSpans.slice(0, index).reduce((a, b) => a + b, 0);
          return (
            <path
              key={`tint-${index}`}
              d={wedgePath(cx, cy, coreR, outerR + 8, start, start + span)}
              fill={BRANCH_TINTS[index % BRANCH_TINTS.length]}
              fillOpacity={0.4}
            />
          );
        })}

        {slotGroups}

        {/* Founders' emblem: struck differently from the rest of the plate. */}
        <circle
          cx={cx}
          cy={cy}
          r={coreR}
          className={isFounders ? "plate-core plate-core--founders" : "plate-core"}
        />
        {isFounders && <circle cx={cx} cy={cy} r={coreR - 5} className="plate-core-inner" />}

        {isFounders ? (
          <text x={cx} y={cy - coreR * 0.58} textAnchor="middle" className="plate-founders">
            FOUNDERS
          </text>
        ) : (
          <text x={cx} y={cy - coreR * 0.55} textAnchor="middle" className="plate-eyebrow">
            {isAscent ? "ANCESTORS OF" : "DESCENDANTS OF"}
          </text>
        )}

        {core.map((person, index) => {
          if (!person) return null;
          const lead = core.length > 1 ? 24 : 0;
          const top = cy - (core.length - 1) * (lead / 2) + (isFounders ? 2 : 4);
          return (
            <g key={person.id}>
              <text
                x={cx}
                y={top + index * lead}
                textAnchor="middle"
                className="plate-core-name"
                fontSize={core.length > 1 ? 15 : 18}
                fontStyle={person.deceased ? "italic" : "normal"}
                style={{ cursor: "pointer" }}
                onClick={() => onSelect(person.id)}
              >
                {person.displayName}
              </text>
              {doorwayMarker(person.id, cx + coreR * 0.72, top + index * lead - 5)}
            </g>
          );
        })}

        {isFounders && (
          <text x={cx} y={cy + coreR * 0.62} textAnchor="middle" className="plate-eyebrow">
            PARENTS OF THE FOUR BROTHERS
          </text>
        )}

        <text className="plate-seal">
          <textPath href={`#${sealId}`} startOffset="50%" textAnchor="middle">
            {isFounders
              ? "THE CRAIG FAMILY · BREADLOAF HILL"
              : `${rootPerson.displayName.toUpperCase()}'S ${isAscent ? "ANCESTORS" : "DESCENDANTS"}`}
          </textPath>
        </text>

        {/* Spouses outside the line of descent are stated at the rim, far from centre. */}
        {!isAscent && otherSpouses.length > 0 && (
          <text className="plate-rimnote">
            <textPath href={`#${rimId}`} startOffset="50%" textAnchor="middle">
              {`${rootPerson.displayName.toUpperCase()} ALSO MARRIED ${otherSpouses
                .map((p) => tree.people[p.id]?.displayName.toUpperCase())
                .filter(Boolean)
                .join(" AND ")}`}
            </textPath>
          </text>
        )}
      </svg>
    </div>
  );
}
