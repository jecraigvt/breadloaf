import { ChevronLeft } from "lucide-react";
import Link from "next/link";

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="fg-page-header">
      <div className="chrome-top fg-brand-bar">
        <Link
          href="/"
          className="fg-home-link"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          <span className="wordmark">Breadloaf Hill<span className="fg-wordmark-dot">.</span></span>
        </Link>
        <span className="ctr fg-brand-caption">The family field guide</span>
      </div>
      <div className="fg-page-heading">
        <p className="eyebrow">Breadloaf Hill / Vermont</p>
        <h1>{title}</h1>
        {subtitle && (
          <p className="fg-page-subtitle">{subtitle}</p>
        )}
      </div>
    </header>
  );
}
