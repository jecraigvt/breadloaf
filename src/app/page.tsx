import { prisma } from "@/lib/prisma";
import { syncFromGoogleCalendar } from "@/lib/google-calendar";
import { pollInboxInBackground } from "@/lib/email-processor";
import Link from "next/link";
import { ArrowRight, BookOpen, Clock3, Upload, Users } from "lucide-react";
import { Masthead } from "@/components/layout/masthead";
import { HubLeadTile } from "@/components/home/hub-lead-tile";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
const ICLOUD_ALBUM = "https://www.icloud.com/sharedalbum/#B2X5nhQSTTixIx";
const PHOTO_STRIP = [
  { src: "/photos/family-group.jpg", caption: "Time together" },
  { src: "/photos/lawn-games.jpg", caption: "Out on the lawn" },
  { src: "/photos/bonfire.jpg", caption: "Around the fire" },
  { src: "/photos/swimming-hole.jpg", caption: "Down by the water" },
  { src: "/photos/summer-meadow.jpg", caption: "Summer on the hill" },
  { src: "/photos/winter-mountains.jpg", caption: "A change of season" },
];

export default async function HomePage() {
  await syncFromGoogleCalendar().catch(() => {});
  pollInboxInBackground();
  const now = new Date();
  const [docCount, bulletinMessages, stayCount, nextStay, openQuestions] = await Promise.all([
    prisma.document.count({ where: { deletedAt: null, accessScope: "family" } }),
    prisma.bulletinMessage.findMany({ orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 2 }),
    prisma.stay.count({ where: { checkOut: { gte: now } } }).catch(() => 0),
    prisma.stay.findFirst({ where: { checkOut: { gte: now } }, orderBy: { checkIn: "asc" }, include: { room: true } }).catch(() => null),
    prisma.buckyQuestion.count({ where: { status: "open" } }).catch(() => 0),
  ]);
  const month = now.toLocaleDateString("en-US", { month: "long", timeZone: "America/New_York" });
  const today = now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const stayDate = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div className="fg-home fade-in">
      <header className="chrome-top fg-brand-bar">
        <Link href="/" className="wordmark" aria-label="Breadloaf Hill home">Breadloaf Hill<span className="fg-wordmark-dot">.</span></Link>
        <span className="ctr">Est. 1974<span className="fg-brand-caption"> / The family field guide</span></span>
      </header>
      <Masthead />
      <div className="colophon fg-colophon">
        <div><p className="k">On the hill</p><p className="v">{today}<span className="u">Ripton, Vermont</span></p></div>
        <div><p className="k">On the calendar</p><p className="v">{stayCount} {stayCount === 1 ? "stay" : "stays"}<span className="u">Current & upcoming</span></p></div>
        <div><p className="k">In the archive</p><p className="v">{docCount}<span className="u">Family documents</span></p></div>
      </div>
      {openQuestions > 0 && <Link href="/assistant?tab=questions" className="fg-question-banner">
        <span>Bucky has {openQuestions} question{openQuestions === 1 ? "" : "s"} for the family</span><span>Answer <ArrowRight size={16} aria-hidden="true" /></span>
      </Link>}
      <div className="fg-home-body">
        <div className="fg-home-grid">
          <section aria-label="The family hub">
            <div className="chapter-intro fg-chapter-intro"><p className="number">The family field guide / {month}</p><h2 className="lede">A familiar place.<br /><em>A few new possibilities.</em></h2></div>
            <div className="tiles tiles-hub fg-hub-tiles">
              <HubLeadTile lbl="I" sub="Ask · act · file documents" href="/assistant" />
              <Link className="tile fg-photo-tile" href="/calendar"><div className="img"><img src="/photos/hero-mountains.jpg" alt="The Green Mountains beyond the house" /><span className="fig">FIG. 01</span></div><div className="meta"><p className="lbl">II / Plan a visit</p><h3 className="nm">Calendar</h3><p className="fg-tile-description">See who’s coming</p><ArrowRight size={20} aria-hidden="true" /></div></Link>
              <Link className="tile fg-photo-tile" href="/stays"><div className="img"><img src="/photos/house-interior.jpg" alt="The warm wood interior of the house" /><span className="fig">FIG. 02</span></div><div className="meta"><p className="lbl">III / Settle in</p><h3 className="nm">Rooms</h3><p className="fg-tile-description">Find your place to stay</p><ArrowRight size={20} aria-hidden="true" /></div></Link>
            </div>
            <div className="fg-quick-links"><Link href="/upload"><Upload size={18} aria-hidden="true" />Add to Archive</Link><Link href="/bucky/jobs"><Clock3 size={18} aria-hidden="true" />Bucky’s tasks</Link></div>
          </section>
          <aside className="fg-home-sidebar">
            <section className="fg-next-visit">
              <p className="eyebrow">Next on the calendar</p><h2>A little time<br /><em>on the hill.</em></h2>
              {nextStay ? <div className="fg-visit-summary"><div className="fg-visit-date"><strong>{nextStay.checkIn.getUTCDate()}</strong><span>{nextStay.checkIn.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span></div><div><h3>{nextStay.guestName}</h3><p>{stayDate(nextStay.checkIn)}–{stayDate(nextStay.checkOut)}</p><p>{nextStay.room?.name || "Room to be decided"}</p><span className="fg-status">{nextStay.status === "confirmed" ? "Confirmed" : nextStay.status === "tentative" ? "Tentative" : "Requested"}</span></div></div> : <p className="fg-empty-copy">No upcoming visits on the calendar. Make a little room for your next one.</p>}
              <div className="fg-button-row"><Link href="/calendar" className="fg-button">See all dates</Link><Link href="/stays" className="fg-light-link">Plan a stay <ArrowRight size={17} aria-hidden="true" /></Link></div>
            </section>
            <section className="fg-home-panel">
              <div className="section-head fg-section-head"><h2 className="lt">The good things</h2><span className="rt">Keep close</span></div>
              <div className="tiles fg-small-tiles">
                <Link href="/family" className="tile-text"><p className="lbl">IV <Users size={19} aria-hidden="true" /></p><h3 className="big">Family</h3><p className="fg-tile-description">The people who make this home</p><ArrowRight size={19} aria-hidden="true" /></Link>
                <Link href="/more" className="tile-text"><p className="lbl">V <BookOpen size={19} aria-hidden="true" /></p><h3 className="big">All Tools</h3><p className="fg-tile-description">Archive, supplies & everything else</p><ArrowRight size={19} aria-hidden="true" /></Link>
              </div>
            </section>
          </aside>
        </div>
        <section className="fg-board-section" aria-labelledby="home-board-title">
          <div className="section-head fg-section-head"><h2 id="home-board-title" className="lt">From the <em>Board</em></h2><Link href="/bulletin" className="rt">All notes <ArrowRight size={15} aria-hidden="true" /></Link></div>
          <div className="fg-board-notes">{bulletinMessages.length === 0 ? <p className="fg-empty-board">No notes on the board yet. <Link href="/bulletin">Leave one for the family →</Link></p> : bulletinMessages.map((message) => <article key={message.id} className={`note ${message.pinned ? "pinned" : ""}`}><div className="avatar" aria-hidden="true">{message.author.charAt(0).toUpperCase()}</div><div><p className="body">{message.content}</p><p className="note-meta">{message.author} · {formatDate(message.createdAt)}{message.pinned ? " · Pinned" : ""}</p></div></article>)}</div>
        </section>
        <section aria-labelledby="home-photos-title">
          <div className="section-head fg-section-head"><h2 id="home-photos-title" className="lt">Life on the <em>hill</em></h2><a href={ICLOUD_ALBUM} target="_blank" rel="noopener noreferrer" className="rt">Family album ↗</a></div>
          <div className="strip fg-photo-strip" role="region" aria-label="Family photographs" tabIndex={0}>{PHOTO_STRIP.map((photo) => <a key={photo.src} className="card" href={ICLOUD_ALBUM} target="_blank" rel="noopener noreferrer"><div className="img"><img src={photo.src} alt={photo.caption} loading="lazy" /></div><p className="cap">{photo.caption}</p></a>)}</div>
        </section>
        <footer className="footer-colophon"><div className="fc-mark"><em>Breadloaf Hill</em></div><p className="fc-sub">A private family record<br />Craig Family · Est. 1974<br />Ripton, Vermont</p></footer>
      </div>
    </div>
  );
}
