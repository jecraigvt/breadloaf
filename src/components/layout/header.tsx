import { Mountain } from "lucide-react";

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="bg-green-800 text-white px-4 py-6">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <Mountain size={20} />
          <span className="text-green-200 text-sm font-medium">Breadloaf Hill</span>
        </div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && (
          <p className="text-green-200 text-sm mt-1">{subtitle}</p>
        )}
      </div>
    </header>
  );
}
