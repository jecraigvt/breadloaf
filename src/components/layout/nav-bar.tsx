"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  FolderOpen,
  Camera,
  MessageCircle,
  Megaphone,
} from "lucide-react";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/documents", icon: FolderOpen, label: "Archive" },
  { href: "/upload", icon: Camera, label: "Scan" },
  { href: "/assistant", icon: MessageCircle, label: "Assistant" },
  { href: "/bulletin", icon: Megaphone, label: "Board" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 z-50">
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
              className={`flex flex-col items-center py-2 px-3 text-xs transition-colors ${
                isScan
                  ? "relative -top-3"
                  : ""
              } ${
                isActive
                  ? "text-green-700"
                  : "text-stone-400 hover:text-stone-600"
              }`}
            >
              {isScan ? (
                <span className="flex items-center justify-center w-14 h-14 rounded-full bg-green-700 text-white shadow-lg mb-1">
                  <Icon size={24} />
                </span>
              ) : (
                <Icon size={22} className="mb-1" />
              )}
              <span className={isScan ? "text-green-700 font-medium" : ""}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
