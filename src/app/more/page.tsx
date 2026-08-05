import Link from "next/link";

const ICLOUD_ALBUM = "https://www.icloud.com/sharedalbum/#B2X5nhQSTTixIx";

interface Destination {
  name: string;
  sub: string;
  href: string;
  external?: boolean;
}

const DESTINATIONS: Destination[] = [
  { name: "Supplies", sub: "Pantry and shopping list", href: "/grocery" },
  { name: "Dinners", sub: "Who's cooking tonight", href: "/dinners" },
  { name: "Local Guide", sub: "Swims, hikes, and restaurants", href: "/guide" },
  { name: "Weather", sub: "Forecast on the hill", href: "/weather" },
  { name: "Finances", sub: "S-Corp expenses and splits", href: "/expenses" },
  { name: "Family Album", sub: "847 photos on iCloud", href: ICLOUD_ALBUM, external: true },
  { name: "Checklists", sub: "Opening and closing", href: "/checklists" },
  { name: "Emergency", sub: "Contacts and tap-to-call", href: "/emergency" },
  { name: "Archive", sub: "Documents and auto-filing", href: "/documents" },
  { name: "Corporation Accounts", sub: "Utilities and access", href: "/accounts" },
  { name: "Bulletin Board", sub: "Family notes", href: "/bulletin" },
  { name: "Maintenance", sub: "Property work and history", href: "/maintenance" },
  { name: "Add Documents", sub: "Scan, upload, or link a file", href: "/upload" },
];

export default function MorePage() {
  return (
    <div className="fade-in">
      <div className="chrome-top">
        <Link href="/" className="ctr">← Hub</Link>
        <span className="wordmark"><em>Breadloaf</em> Hill</span>
        <span className="ctr">Directory</span>
      </div>

      <div className="chapter-intro">
        <div className="number">The full directory</div>
        <div className="lede">
          Every corner of the hill, <em>still within reach.</em>
        </div>
      </div>

      <div className="section-head">
        <div className="lt">All <em>Tools</em></div>
        <div className="rt">{DESTINATIONS.length} destinations</div>
      </div>

      <div className="index-list">
        {DESTINATIONS.map((destination, index) => {
          const content = (
            <>
              <div className="no">{String(index + 1).padStart(2, "0")}</div>
              <div>
                <div className="name">{destination.name}</div>
                <div className="sub">{destination.sub}</div>
              </div>
              <div aria-hidden>→</div>
            </>
          );
          return destination.external ? (
            <a key={destination.name} className="index-row" href={destination.href} target="_blank" rel="noopener noreferrer">
              {content}
            </a>
          ) : (
            <Link key={destination.name} className="index-row" href={destination.href}>
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
