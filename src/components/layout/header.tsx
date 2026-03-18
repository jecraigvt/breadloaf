import { Mountain, ChevronLeft } from "lucide-react";
import Link from "next/link";

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="bg-gradient-to-r from-green-800 to-green-900 text-white px-4 py-6">
      <div className="max-w-5xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-green-300 hover:text-green-200 text-sm font-medium mb-2 transition-colors"
        >
          <ChevronLeft size={16} />
          <Mountain size={16} />
          <span>Breadloaf Hill</span>
        </Link>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && (
          <p className="text-green-200 text-sm mt-1">{subtitle}</p>
        )}
      </div>
    </header>
  );
}
