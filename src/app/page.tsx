import { prisma } from "@/lib/prisma";
import { syncFromGoogleCalendar } from "@/lib/google-calendar";
import Link from "next/link";
import {
  Camera,
  MessageCircle,
  FolderOpen,
  Megaphone,
  ArrowRight,
  FileText,
  Tag,
  Calendar,
  CalendarDays,
  BedDouble,
  Image,
  Smartphone,
  ChevronRight,
  Clock,
  ExternalLink,
  Users,
  ShoppingCart,
  ClipboardCheck,
  Wrench,
  CloudSun,
  AlertTriangle,
  MapPin,
  Contact,
  ChefHat,
  DollarSign,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { HeroBanner } from "@/components/layout/hero-banner";

export const dynamic = "force-dynamic";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getSeasonLabel(): string {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return "Spring on the hill";
  if (month >= 5 && month <= 7) return "Summer at Breadloaf";
  if (month >= 8 && month <= 10) return "Autumn in Vermont";
  return "Winter at Breadloaf";
}

export default async function HomePage() {
  // Sync calendar on homepage load
  await syncFromGoogleCalendar().catch(() => {});

  const [docCount, recentDocs, categories, bulletinMessages] =
    await Promise.all([
      prisma.document.count(),
      prisma.document.findMany({
        include: { category: true },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
      prisma.category.findMany({
        include: { _count: { select: { documents: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.bulletinMessage.findMany({
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        take: 3,
      }),
    ]);

  const categoriesWithDocs = categories.filter(
    (c) => c._count.documents > 0
  );

  return (
    <div className="min-h-screen">
      {/* Hero with rotating photos */}
      <HeroBanner
        greeting={getGreeting()}
        seasonLabel={getSeasonLabel()}
        docCount={docCount}
        boardCount={bulletinMessages.length}
      />

      <div className="max-w-5xl mx-auto px-4 -mt-8 relative z-20 pb-24">
        {/* Hub Grid */}
        <section className="mb-10">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            {/* 1. Calendar — with photo background */}
            <Link
              href="/calendar"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-1 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img
                src="/photos/sunset-deck.jpg"
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <CalendarDays size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Calendar</h3>
                <p className="text-white/80 text-sm">Plan visits</p>
              </div>
            </Link>

            {/* 2. Weather */}
            <Link
              href="/weather"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-2 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/winter-mountains.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <CloudSun size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Weather</h3>
                <p className="text-white/80 text-sm">Forecast</p>
              </div>
            </Link>

            {/* 3. Supplies */}
            <Link
              href="/grocery"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-3 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/barn-exterior.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <ShoppingCart size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Supplies</h3>
                <p className="text-white/80 text-sm">Shop & pantry</p>
              </div>
            </Link>

            {/* Dinners */}
            <Link
              href="/dinners"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-3 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/family-dinner.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <ChefHat size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Dinners</h3>
                <p className="text-white/80 text-sm">Who's cooking?</p>
              </div>
            </Link>

            {/* Finances */}
            <Link
              href="/expenses"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-3 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/hero-drone-landscape.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <DollarSign size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Finances</h3>
                <p className="text-white/80 text-sm">Expenses & splits</p>
              </div>
            </Link>

            {/* 4. Rooms — with photo background */}
            <Link
              href="/stays"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-4 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img
                src="/photos/house-interior.jpg"
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <BedDouble size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Rooms</h3>
                <p className="text-white/80 text-sm">Pick your room</p>
              </div>
            </Link>

            {/* 5. Board */}
            <Link
              href="/bulletin"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-5 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/family-group.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <Megaphone size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Board</h3>
                <p className="text-white/80 text-sm">Family messages</p>
              </div>
            </Link>

            {/* 6. Photos */}
            <a
              href="https://www.icloud.com/sharedalbum/#B2X5nhQSTTixIx"
              target="_blank"
              rel="noopener noreferrer"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-6 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/lawn-games.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <Image size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Photos</h3>
                <p className="text-white/80 text-sm">Family album</p>
                <span className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-white/70">
                  <ExternalLink size={11} />
                  iCloud
                </span>
              </div>
            </a>

            {/* 7. Assistant — with photo background */}
            <Link
              href="/assistant"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-6 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img
                src="/photos/hilltop-view.jpg"
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <MessageCircle size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Assistant</h3>
                <p className="text-white/80 text-sm">Ask about the property</p>
              </div>
            </Link>

            {/* 8. Checklists */}
            <Link
              href="/checklists"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-6 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/barn-exterior.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <ClipboardCheck size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Checklists</h3>
                <p className="text-white/80 text-sm">Open & close</p>
              </div>
            </Link>

            {/* 9. Local Guide */}
            <Link
              href="/guide"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-6 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/swimming-hole.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <MapPin size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Local Guide</h3>
                <p className="text-white/80 text-sm">Things to do</p>
              </div>
            </Link>

            {/* 10. Family Directory */}
            <Link
              href="/family"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-6 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/bonfire.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <Contact size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Family</h3>
                <p className="text-white/80 text-sm">Directory</p>
              </div>
            </Link>

            {/* 11. Documents */}
            <Link
              href="/documents"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-6 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/summer-meadow.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <FolderOpen size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Documents</h3>
                <p className="text-white/80 text-sm">
                  {docCount > 0 ? `${docCount} files archived` : "Property archive"}
                </p>
              </div>
            </Link>

            {/* 12. Scan */}
            <Link
              href="/upload"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-6 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/hero-drone-house.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <Camera size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Scan</h3>
                <p className="text-white/80 text-sm">Upload documents</p>
              </div>
            </Link>

            {/* 13. Maintenance */}
            <Link
              href="/maintenance"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-6 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/hero-rainbow.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <Wrench size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Maintenance</h3>
                <p className="text-white/80 text-sm">Service log</p>
              </div>
            </Link>

            {/* 14. Emergency */}
            <Link
              href="/emergency"
              className="relative rounded-2xl overflow-hidden card-hover animate-fade-in-up delay-6 min-h-[150px] sm:min-h-[170px] shadow-md"
            >
              <img src="/photos/hero-mountains.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-end h-full">
                <AlertTriangle size={22} className="text-white mb-2 drop-shadow" />
                <h3 className="font-bold text-white text-lg mb-0.5 drop-shadow">Emergency</h3>
                <p className="text-white/80 text-sm">Contacts & info</p>
              </div>
            </Link>

            {/* 15. Smart Home - Coming Soon */}
            <div className="hub-card-smart rounded-2xl p-5 sm:p-6 border border-blue-200/50 relative overflow-hidden animate-fade-in-up delay-6">
              <div className="coming-soon-shimmer absolute inset-0 rounded-2xl" />
              <div className="relative z-10">
                <div className="w-11 h-11 rounded-xl bg-blue-400 flex items-center justify-center mb-4 shadow-sm">
                  <Smartphone size={22} className="text-white" />
                </div>
                <h3 className="font-semibold text-stone-800 text-lg mb-1">Smart Home</h3>
                <p className="text-stone-500 text-sm">Device monitoring</p>
                <span className="inline-block mt-2 text-xs font-medium text-blue-600 bg-blue-100 rounded-full px-2.5 py-0.5">
                  Coming soon
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Photo Strip */}
        <section className="mb-10 -mx-4 px-4 overflow-hidden">
          <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-hide">
            {[
              { src: "/photos/family-group.jpg", alt: "Family gathering on the hill" },
              { src: "/photos/swimming-hole.jpg", alt: "The swimming hole" },
              { src: "/photos/lawn-games.jpg", alt: "Games on the lawn" },
              { src: "/photos/summer-meadow.jpg", alt: "Summer meadow" },
              { src: "/photos/bonfire.jpg", alt: "Bonfire night" },
              { src: "/photos/barn-exterior.jpg", alt: "The barn" },
              { src: "/photos/winter-mountains.jpg", alt: "Winter at Breadloaf" },
              { src: "/photos/family-dinner.jpg", alt: "Family dinner" },
            ].map((photo) => (
              <a
                key={photo.src}
                href="https://www.icloud.com/sharedalbum/#B2X5nhQSTTixIx"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 group"
              >
                <div className="w-40 h-28 sm:w-52 sm:h-36 rounded-xl overflow-hidden">
                  <img
                    src={photo.src}
                    alt={photo.alt}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
              </a>
            ))}
          </div>
          <div className="flex items-center justify-center mt-2">
            <a
              href="https://www.icloud.com/sharedalbum/#B2X5nhQSTTixIx"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-stone-400 hover:text-green-700 flex items-center gap-1 transition-colors"
            >
              View all 847 photos <ExternalLink size={12} />
            </a>
          </div>
        </section>

        {/* Two-column layout on desktop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
          {/* Recent Documents */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-stone-800 text-lg flex items-center gap-2">
                <Clock size={18} className="text-stone-400" />
                Recent Documents
              </h2>
              <Link
                href="/documents"
                className="text-green-700 text-sm flex items-center gap-1 hover:gap-2 transition-all"
              >
                View all <ChevronRight size={14} />
              </Link>
            </div>

            {recentDocs.length === 0 ? (
              <div className="bg-white rounded-2xl border border-stone-200 p-8 text-center">
                <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-3">
                  <FolderOpen size={24} className="text-stone-300" />
                </div>
                <p className="text-stone-500 text-sm mb-2">No documents yet</p>
                <Link
                  href="/upload"
                  className="text-green-700 text-sm font-medium inline-flex items-center gap-1 hover:gap-2 transition-all"
                >
                  Scan your first document <ArrowRight size={14} />
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {recentDocs.map((doc) => (
                  <Link
                    key={doc.id}
                    href={`/documents/${doc.id}`}
                    className="flex items-center gap-3 bg-white rounded-xl border border-stone-200/80 p-3.5 card-hover"
                  >
                    {doc.fileType.startsWith("image/") ? (
                      <div className="w-12 h-12 rounded-lg bg-stone-100 flex-shrink-0 overflow-hidden">
                        <img
                          src={doc.filePath}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-stone-50 flex-shrink-0 flex items-center justify-center">
                        <FileText size={20} className="text-stone-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-stone-800 truncate">
                        {doc.title}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-stone-400 mt-1">
                        {doc.category && (
                          <span className="flex items-center gap-1">
                            <Tag size={10} />
                            {doc.category.name}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar size={10} />
                          {formatDate(doc.createdAt)}
                        </span>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-stone-300 flex-shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Family Board */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-stone-800 text-lg flex items-center gap-2">
                <Users size={18} className="text-stone-400" />
                Family Board
              </h2>
              <Link
                href="/bulletin"
                className="text-green-700 text-sm flex items-center gap-1 hover:gap-2 transition-all"
              >
                View all <ChevronRight size={14} />
              </Link>
            </div>

            {bulletinMessages.length === 0 ? (
              <div className="bg-white rounded-2xl border border-stone-200 p-8 text-center">
                <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-3">
                  <Megaphone size={24} className="text-stone-300" />
                </div>
                <p className="text-stone-500 text-sm mb-2">No messages yet</p>
                <Link
                  href="/bulletin"
                  className="text-green-700 text-sm font-medium inline-flex items-center gap-1 hover:gap-2 transition-all"
                >
                  Post the first update <ArrowRight size={14} />
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {bulletinMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`bg-white rounded-xl border p-3.5 ${
                      msg.pinned
                        ? "border-amber-200 bg-amber-50/30"
                        : "border-stone-200/80"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-green-700 text-xs font-semibold">
                          {msg.author.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-stone-700">
                        {msg.author}
                      </span>
                      <span className="text-xs text-stone-400 ml-auto">
                        {formatDate(msg.createdAt)}
                      </span>
                    </div>
                    <p className="text-stone-600 text-sm line-clamp-2 pl-8">
                      {msg.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Categories */}
        {categoriesWithDocs.length > 0 && (
          <section className="mt-8">
            <h2 className="font-semibold text-stone-800 text-lg mb-4 flex items-center gap-2">
              <Tag size={18} className="text-stone-400" />
              Categories
            </h2>
            <div className="flex flex-wrap gap-2">
              {categoriesWithDocs.map((cat) => (
                <Link
                  key={cat.id}
                  href={`/documents?category=${cat.slug}`}
                  className="bg-white border border-stone-200 rounded-full px-4 py-2 text-sm text-stone-600 hover:border-green-300 hover:bg-green-50/50 transition-all"
                >
                  {cat.name}{" "}
                  <span className="text-stone-400">
                    ({cat._count.documents})
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
