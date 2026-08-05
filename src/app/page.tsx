import { prisma } from "@/lib/prisma";
import { syncFromGoogleCalendar } from "@/lib/google-calendar";
import { pollInboxInBackground } from "@/lib/email-processor";
import Link from "next/link";
import { Masthead } from "@/components/layout/masthead";
import { formatDate } from "@/lib/utils";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

const ICLOUD_ALBUM = "https://www.icloud.com/sharedalbum/#B2X5nhQSTTixIx";

function toRoman(num: number): string {
  const table: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  let n = num;
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

function getSeason(month: number): string {
  if (month >= 2 && month <= 4) return "Late Spring";
  if (month >= 5 && month <= 7) return "High Summer";
  if (month >= 8 && month <= 10) return "Autumn";
  return "Deep Winter";
}

type PhotoTile = {
  no: string;
  fig: string;
  name: ReactNode;
  sub: string;
  photo: string;
  href: string;
  external?: boolean;
};

type TextTile = {
  lbl: string;
  big: ReactNode;
  sub: string;
  href: string;
};

// Bucky leads the index — he is the way most things get done now (asking, filing,
// logging), so he takes section I and the top-left tile.
const HUB_LEAD: TextTile = {
  lbl: "AI · I",
  big: <><em>Bucky</em><br/>Dragon</>,
  sub: "Ask · act · file documents",
  href: "/assistant",
};

const HUB_PHOTO: PhotoTile[] = [
  { no: "II",   fig: "FIG. 01", name: <>The <em>Calendar</em></>, sub: "Visits, arrivals, departures",  photo: "/photos/sunset-deck.jpg",         href: "/calendar" },
  { no: "III",  fig: "FIG. 02", name: <>The <em>Rooms</em></>,    sub: "Who sleeps where",              photo: "/photos/house-interior.jpg",      href: "/stays" },
];

const HUB_TEXT: TextTile[] = [
  { lbl: "IV", big: <>The <em>Family</em></>, sub: "The plate · tap to claim", href: "/family" },
  { lbl: "V", big: <>All <em>Tools</em></>, sub: "Everything else on the hill", href: "/more" },
];

const PHOTO_STRIP = [
  { src: "/photos/family-group.jpg",     cap: "Reunion · Jul 2024" },
  { src: "/photos/lawn-games.jpg",       cap: "Lawn games · Aug" },
  { src: "/photos/bonfire.jpg",          cap: "Solstice bonfire" },
  { src: "/photos/swimming-hole.jpg",    cap: "Bartlett Falls" },
  { src: "/photos/summer-meadow.jpg",    cap: "The meadow · Jun" },
  { src: "/photos/winter-mountains.jpg", cap: "First snow · Nov" },
];

function TileLink({ tile }: { tile: PhotoTile }) {
  const inner = (
    <>
      <div className="img">
        <img src={tile.photo} alt="" />
        <div className="fig">{tile.fig}</div>
        <div className="fig2">§ {tile.no}</div>
      </div>
      <div className="meta">
        <div className="lbl">Sec. {tile.no} · {tile.sub}</div>
        <div className="nm">{tile.name}</div>
      </div>
    </>
  );
  if (tile.external) {
    return (
      <a className="tile" href={tile.href} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return <Link className="tile" href={tile.href}>{inner}</Link>;
}

export default async function HomePage() {
  await syncFromGoogleCalendar().catch(() => {});
  // Check the family inbox (rate-limited, non-blocking — same pattern as calendar sync)
  pollInboxInBackground();

  const [docCount, bulletinMessages, upcomingStays, openQuestions] = await Promise.all([
    prisma.document.count(),
    prisma.bulletinMessage.findMany({
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 2,
    }),
    prisma.stay.count({
      where: { checkOut: { gte: new Date() } },
    }).catch(() => 0),
    prisma.buckyQuestion.count({ where: { status: "open" } }).catch(() => 0),
  ]);

  const now = new Date();
  const year = now.getFullYear();
  const vol = toRoman(year - 1974);
  const yearRoman = toRoman(year);
  const season = getSeason(now.getMonth());
  const dateStr = now
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toUpperCase();

  return (
    <div className="fade-in">
      {/* Top chrome */}
      <div className="chrome-top">
        <div style={{ minWidth: 60 }}>
          <span className="ctr">Est. 1974</span>
        </div>
        <div style={{ textAlign: "center", flex: 1 }}>
          <span className="wordmark"><em>Breadloaf</em> Hill</span>
        </div>
        <div style={{ minWidth: 60, textAlign: "right" }}>
          <span className="ctr">Vol. {vol}</span>
        </div>
      </div>

      {/* Masthead */}
      <Masthead />

      {/* Colophon stats */}
      <div className="colophon">
        <div>
          <div className="k">Today</div>
          <div className="v">{dateStr.split(" ")[1]} <span className="u">{dateStr.split(" ")[2]}</span></div>
        </div>
        <div>
          <div className="k">On Hill</div>
          <div className="v">{upcomingStays}<span className="u">Stays</span></div>
        </div>
        <div>
          <div className="k">Archive</div>
          <div className="v">{docCount}<span className="u">Docs</span></div>
        </div>
      </div>

      {/* Bucky's open questions — surfaced here so they don't sit unseen in the
          assistant's Questions tab */}
      {openQuestions > 0 && (
        <Link
          href="/assistant?tab=questions"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 20px",
            background: "var(--paper-2)",
            borderBottom: "1px solid var(--rule)",
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ember-deep)",
          }}
        >
          <span>
            Bucky has {openQuestions} question{openQuestions === 1 ? "" : "s"} for the family
          </span>
          <span aria-hidden>Answer →</span>
        </Link>
      )}

      {/* Chapter intro */}
      <div className="chapter-intro">
        <div className="number">No. {vol} — {season}, {yearRoman}</div>
        <div className="lede">
          Welcome home. The hill is quiet this morning — a <em>doe and two fawns</em> at the edge of the meadow before seven. Rain expected after lunch.
        </div>
      </div>

      {/* Index / hub */}
      <div className="section-head">
        <div className="lt">The <em>Hub</em></div>
        <div className="rt">Index · Sections I – V</div>
      </div>

      <div className="tiles tiles-hub">
        <Link href={HUB_LEAD.href} className="tile-text tile-lead">
          <div className="lbl">Sec. {HUB_LEAD.lbl}</div>
          <div>
            <div className="big">{HUB_LEAD.big}</div>
            <div
              style={{
                marginTop: 6,
                fontFamily: "var(--mono)",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--muted)",
              }}
            >
              {HUB_LEAD.sub}
            </div>
          </div>
        </Link>
        {HUB_PHOTO.map((t) => (
          <TileLink key={t.no} tile={t} />
        ))}
        {HUB_TEXT.map((t) => (
          <Link key={t.lbl} href={t.href} className={`tile-text ${t.href === "/more" ? "tile-wide" : ""}`}>
            <div className="lbl">Sec. {t.lbl}</div>
            <div>
              <div className="big">{t.big}</div>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                }}
              >
                {t.sub}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Pull quote */}
      <div className="pull-quote">
        <div className="q">
          &ldquo;The best view of anything is from the back porch at six in the evening, when the hill turns gold.&rdquo;
        </div>
        <div className="att">— Dad, circa 1998 · Notebook marginalia</div>
      </div>

      {/* Photo strip */}
      <div className="section-head">
        <div className="lt"><em>Recent</em> Photography</div>
        <div className="rt">847 in iCloud</div>
      </div>
      <div className="strip scrollbar-hide">
        {PHOTO_STRIP.map((p, i) => (
          <a
            key={p.src}
            className="card"
            href={ICLOUD_ALBUM}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="img">
              <div className="fig">PL. {String(i + 1).padStart(2, "0")}</div>
              <img src={p.src} alt="" />
            </div>
            <div className="cap">{p.cap}</div>
          </a>
        ))}
      </div>

      {/* Board preview */}
      <div className="section-head">
        <div className="lt">The <em>Board</em></div>
        <div className="rt">
          <Link href="/bulletin">All →</Link>
        </div>
      </div>

      {bulletinMessages.length === 0 ? (
        <div style={{ padding: "24px 20px", background: "var(--paper)", borderBottom: "1px solid var(--rule)" }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            No notes on the board yet. <Link href="/bulletin" style={{ color: "var(--pine-deep)" }}>Post one →</Link>
          </div>
        </div>
      ) : (
        bulletinMessages.map((msg) => (
          <div key={msg.id} className={`note ${msg.pinned ? "pinned" : ""}`}>
            <div className="avatar">{msg.author.charAt(0).toUpperCase()}</div>
            <div>
              <div className="body">{msg.content}</div>
              <div className="note-meta">
                {msg.author} · {formatDate(msg.createdAt)}
                {msg.pinned ? " · PINNED" : ""}
              </div>
            </div>
            <div />
          </div>
        ))
      )}

      {/* Footer colophon */}
      <div className="footer-colophon">
        <div className="fc-mark"><em>Breadloaf Hill</em></div>
        <div className="fc-sub">
          A private family record<br />
          Craig Family · Est. MCMLXXIV<br />
          Ripton, Vermont · USA
        </div>
      </div>
    </div>
  );
}
