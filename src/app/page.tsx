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

const HUB_PHOTO: PhotoTile[] = [
  { no: "I",    fig: "FIG. 01", name: <>The <em>Calendar</em></>, sub: "Visits, arrivals, departures",  photo: "/photos/sunset-deck.jpg",         href: "/calendar" },
  { no: "II",   fig: "FIG. 02", name: <>The <em>Rooms</em></>,    sub: "Who sleeps where",              photo: "/photos/house-interior.jpg",      href: "/stays" },
  { no: "III",  fig: "FIG. 03", name: <>Supplies</>,              sub: "Pantry & shopping list",        photo: "/photos/barn-exterior.jpg",       href: "/grocery" },
  { no: "IV",   fig: "FIG. 04", name: <>The <em>Dinners</em></>,  sub: "Who's cooking tonight",         photo: "/photos/family-dinner.jpg",       href: "/dinners" },
  { no: "V",    fig: "FIG. 05", name: <>Local Guide</>,           sub: "Swims, hikes, restaurants",     photo: "/photos/swimming-hole.jpg",       href: "/guide" },
  { no: "VI",   fig: "FIG. 06", name: <>The <em>Weather</em></>,  sub: "Forecast on the hill",          photo: "/photos/winter-mountains.jpg",    href: "/weather" },
  { no: "VII",  fig: "FIG. 07", name: <>Finances</>,              sub: "S-Corp, expenses, splits",      photo: "/photos/hero-drone-landscape.jpg", href: "/expenses" },
  { no: "VIII", fig: "FIG. 08", name: <>The <em>Album</em></>,    sub: "847 photos · iCloud",           photo: "/photos/lawn-games.jpg",          href: ICLOUD_ALBUM, external: true },
  { no: "IX",   fig: "FIG. 09", name: <>Checklists</>,            sub: "Opening & closing",             photo: "/photos/summer-meadow.jpg",       href: "/checklists" },
];

const HUB_TEXT: TextTile[] = [
  { lbl: "AI · X", big: <><em>Bucky</em><br/>Dragon</>,           sub: "Ask · act · file documents", href: "/assistant" },
  { lbl: "XI",     big: <>The <em>Family</em></>,                 sub: "Directory, by branch",   href: "/family" },
  { lbl: "XII",    big: <>Emergency</>,                           sub: "Contacts · tap to call", href: "/emergency" },
  { lbl: "XIII",   big: <>The <em>Archive</em></>,                sub: "Documents · auto-filed", href: "/documents" },
  { lbl: "XIV", big: <>Corporation<br/><em>Accounts</em></>, sub: "Utilities and access", href: "/accounts" },
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

  const [docCount, bulletinMessages, upcomingStays] = await Promise.all([
    prisma.document.count(),
    prisma.bulletinMessage.findMany({
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 2,
    }),
    prisma.stay.count({
      where: { checkOut: { gte: new Date() } },
    }).catch(() => 0),
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
        <div className="rt">Index · Sections I – XIII</div>
      </div>

      <div className="tiles">
        {HUB_PHOTO.map((t) => (
          <TileLink key={t.no} tile={t} />
        ))}
        {HUB_TEXT.map((t) => (
          <Link key={t.lbl} href={t.href} className="tile-text">
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
