"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  CalendarDays,
  Camera,
  BedDouble,
  FolderOpen,
} from "lucide-react";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/calendar", icon: CalendarDays, label: "Calendar" },
  { href: "/upload", icon: Camera, label: "Scan" },
  { href: "/stays", icon: BedDouble, label: "Rooms" },
  { href: "/documents", icon: FolderOpen, label: "Archive" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 glass border-t border-stone-200/80 z-50">
      <div className="flex items-center justify-around max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          const isScan = item.href === "/upload";

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center py-2 px-3 text-xs transition-all ${
                isScan ? "relative -top-3" : ""
              } ${
                isActive
                  ? "text-green-700"
                  : "text-stone-400 hover:text-stone-600"
              }`}
            >
              {isScan ? (
                <span className={`flex items-center justify-center w-14 h-14 rounded-full shadow-lg mb-1 transition-all ${
                  isActive
                    ? "bg-green-700 text-white scale-105"
                    : "bg-green-700 text-white hover:bg-green-600"
                }`}>
                  <Icon size={24} />
                </span>
              ) : (
                <span className={`mb-1 transition-transform ${isActive ? "scale-110" : ""}`}>
                  <Icon size={22} />
                </span>
              )}
              <span className={`transition-all ${
                isActive ? "font-semibold" : ""
              } ${isScan ? "text-green-700 font-medium" : ""}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
