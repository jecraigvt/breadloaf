import Link from "next/link";
import { Header } from "@/components/layout/header";

const ICLOUD_ALBUM = "https://www.icloud.com/sharedalbum/#B2X5nhQSTTixIx";

interface Destination {
  name: string;
  sub: string;
  href: string;
  external?: boolean;
}

const DESTINATIONS: Destination[] = [
  { name: "Emergency", sub: "Call 911 and find the property address", href: "/emergency" },
  { name: "Shopping List", sub: "What to bring for the next visit", href: "/grocery" },
  { name: "Checklists", sub: "Opening, closing, and previous seasons", href: "/checklists" },
  { name: "Maintenance", sub: "Property work and history", href: "/maintenance" },
  { name: "Archive", sub: "Find the family’s documents", href: "/documents" },
  { name: "Dinners", sub: "Who's cooking tonight", href: "/dinners" },
  { name: "Local Guide", sub: "Swims, hikes, and restaurants", href: "/guide" },
  { name: "Weather", sub: "Forecast on the hill", href: "/weather" },
  { name: "Expense Ledger", sub: "Recorded spending and who paid", href: "/expenses" },
  { name: "Family Album", sub: "Family photographs on iCloud", href: ICLOUD_ALBUM, external: true },
  { name: "Corporation Accounts", sub: "Utilities and access", href: "/accounts" },
  { name: "Bulletin Board", sub: "Family notes", href: "/bulletin" },
  { name: "Add Documents", sub: "Scan, upload, or link a file", href: "/upload" },
  { name: "Bucky’s tasks", sub: "Follow background work and results", href: "/bucky/jobs" },
  { name: "Family Access", sub: "Remembered devices and approved emails", href: "/access" },
];

export default function MorePage() {
  return (
    <div className="fade-in">
      <Header title="All Tools" subtitle="Every corner of the hill, still within reach." />
      <div className="fg-directory">
      <p className="eyebrow">The full directory / {DESTINATIONS.length} destinations</p>
      <div className="index-list fg-directory-list">
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
    </div>
  );
}
