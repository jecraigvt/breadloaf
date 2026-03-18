"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import {
  Waves,
  Mountain,
  UtensilsCrossed,
  Ticket,
  MapPin,
  Clock,
  Car,
  Sparkles,
} from "lucide-react";

type FilterCategory = "all" | "swimming" | "hikes" | "restaurants" | "activities" | "towns";
type EntryCategory = Exclude<FilterCategory, "all">;

interface GuideEntry {
  name: string;
  category: EntryCategory;
  description: string;
  distance?: string;
  driveTime?: string;
  familyFavorite?: boolean;
  placeholder?: boolean;
}

const categoryConfig: Record<EntryCategory, { label: string; icon: React.ReactNode; color: string; bg: string; pill: string; pillActive: string }> = {
  swimming: {
    label: "Swimming Holes",
    icon: <Waves size={16} />,
    color: "text-cyan-700",
    bg: "bg-cyan-50",
    pill: "border-cyan-200 text-cyan-700 hover:bg-cyan-50",
    pillActive: "bg-cyan-600 text-white border-cyan-600",
  },
  hikes: {
    label: "Hikes",
    icon: <Mountain size={16} />,
    color: "text-green-700",
    bg: "bg-green-50",
    pill: "border-green-200 text-green-700 hover:bg-green-50",
    pillActive: "bg-green-700 text-white border-green-700",
  },
  restaurants: {
    label: "Restaurants",
    icon: <UtensilsCrossed size={16} />,
    color: "text-orange-700",
    bg: "bg-orange-50",
    pill: "border-orange-200 text-orange-700 hover:bg-orange-50",
    pillActive: "bg-orange-600 text-white border-orange-600",
  },
  activities: {
    label: "Activities",
    icon: <Ticket size={16} />,
    color: "text-purple-700",
    bg: "bg-purple-50",
    pill: "border-purple-200 text-purple-700 hover:bg-purple-50",
    pillActive: "bg-purple-600 text-white border-purple-600",
  },
  towns: {
    label: "Towns",
    icon: <MapPin size={16} />,
    color: "text-rose-700",
    bg: "bg-rose-50",
    pill: "border-rose-200 text-rose-700 hover:bg-rose-50",
    pillActive: "bg-rose-600 text-white border-rose-600",
  },
};

const entries: GuideEntry[] = [
  // Swimming Holes
  {
    name: "Bartlett Falls",
    category: "swimming",
    description: "Beautiful natural swimming hole with rock ledges for jumping. A classic Vermont spot on the New Haven River.",
    distance: "~5 miles",
    driveTime: "10 min",
    familyFavorite: true,
  },
  {
    name: "Texas Falls",
    category: "swimming",
    description: "Scenic gorge with cascading waterfalls in the Green Mountain National Forest. Great for wading — swimming is limited.",
    distance: "~8 miles",
    driveTime: "15 min",
  },
  {
    name: "Middlebury Gorge",
    category: "swimming",
    description: "Deep pools and rope swings along the Middlebury River. Popular on hot summer days.",
    distance: "~6 miles",
    driveTime: "12 min",
  },
  {
    name: "Your family favorite spot",
    category: "swimming",
    description: "Know a secret swimming hole? Add it here!",
    placeholder: true,
  },

  // Hikes
  {
    name: "Robert Frost Interpretive Trail",
    category: "hikes",
    description: "Easy 1-mile loop through woods and meadows with poems posted along the way. Great for all ages.",
    distance: "~2 miles",
    driveTime: "5 min",
    familyFavorite: true,
  },
  {
    name: "Long Trail (access from Rt 125)",
    category: "hikes",
    description: "Vermont's famous end-to-end trail crosses Rt 125 near Breadloaf. Hike north toward Mt. Abraham or south toward Middlebury Gap.",
    distance: "~3 miles",
    driveTime: "8 min",
  },
  {
    name: "Skylight Pond Trail",
    category: "hikes",
    description: "Moderate 4-mile hike to a beautiful alpine pond with views. Connects to the Long Trail.",
    distance: "~4 miles",
    driveTime: "10 min",
  },
  {
    name: "Mt. Abraham via Long Trail",
    category: "hikes",
    description: "Strenuous hike to one of Vermont's 4,000-footers with panoramic views above treeline.",
    distance: "~3 miles to trailhead",
    driveTime: "8 min",
  },
  {
    name: "Spirit in Nature Trails",
    category: "hikes",
    description: "Peaceful network of short trails in Ripton, each themed around a world religion. Family-friendly.",
    distance: "~1 mile",
    driveTime: "3 min",
  },
  {
    name: "Moosalamoo National Recreation Area",
    category: "hikes",
    description: "Extensive trail network with options from easy walks to challenging climbs. Falls of Lana and Silver Lake are highlights.",
    distance: "~10 miles",
    driveTime: "20 min",
  },

  // Restaurants
  {
    name: "American Flatbread (Middlebury)",
    category: "restaurants",
    description: "Wood-fired flatbreads with local ingredients. Lively atmosphere — a Middlebury staple.",
    distance: "~12 miles",
    driveTime: "20 min",
    familyFavorite: true,
  },
  {
    name: "Tourterelle (New Haven)",
    category: "restaurants",
    description: "French-inspired bistro in a beautifully restored building. Perfect for a special dinner.",
    distance: "~10 miles",
    driveTime: "18 min",
  },
  {
    name: "The Bobcat Cafe (Bristol)",
    category: "restaurants",
    description: "Cozy cafe with great burgers, local beers, and a relaxed vibe.",
    distance: "~14 miles",
    driveTime: "25 min",
  },
  {
    name: "Middlebury Natural Foods Co-op",
    category: "restaurants",
    description: "Excellent deli counter, prepared foods, and local products. Great for stocking up.",
    distance: "~12 miles",
    driveTime: "20 min",
  },
  {
    name: "Family favorite — add yours!",
    category: "restaurants",
    description: "Discovered a great spot? Share it with the family!",
    placeholder: true,
  },

  // Activities
  {
    name: "Middlebury Farmers Market",
    category: "activities",
    description: "Saturdays in season on the town green. Local produce, baked goods, crafts, and live music.",
    distance: "~12 miles",
    driveTime: "20 min",
    familyFavorite: true,
  },
  {
    name: "Middlebury College Museum of Art",
    category: "activities",
    description: "Free admission. Impressive collection in a beautiful building on the Middlebury campus.",
    distance: "~12 miles",
    driveTime: "20 min",
  },
  {
    name: "Otter Creek Brewing",
    category: "activities",
    description: "Local brewery with a taproom. Tours available — a fun afternoon stop.",
    distance: "~12 miles",
    driveTime: "20 min",
  },
  {
    name: "Vermont Icelandic Horse Farm",
    category: "activities",
    description: "Trail rides through the Green Mountains on gentle Icelandic horses. Unique Vermont experience.",
    distance: "~5 miles",
    driveTime: "10 min",
  },
  {
    name: "Blueberry Hill (Cross-Country Skiing)",
    category: "activities",
    description: "Excellent cross-country ski center in Goshen. Beautiful trails in winter, hiking in summer.",
    distance: "~8 miles",
    driveTime: "15 min",
  },

  // Towns
  {
    name: "Middlebury",
    category: "towns",
    description: "The nearest real town — charming college town with shops, restaurants, a movie theater, and all services. The hub for errands and dining.",
    distance: "~12 miles",
    driveTime: "20 min",
    familyFavorite: true,
  },
  {
    name: "Ripton",
    category: "towns",
    description: "The tiny town we're in! Home to the Bread Loaf campus, Robert Frost's cabin, and not much else. That's the charm.",
    distance: "~1 mile",
    driveTime: "2 min",
  },
  {
    name: "Brandon",
    category: "towns",
    description: "Artsy small town with galleries, antique shops, and the Brandon Artists Guild. Nice for a half-day visit.",
    distance: "~18 miles",
    driveTime: "30 min",
  },
  {
    name: "Bristol",
    category: "towns",
    description: "Friendly village with a town green, local shops, and the Bristol Bakery. Worth the drive.",
    distance: "~14 miles",
    driveTime: "25 min",
  },
  {
    name: "Vergennes",
    category: "towns",
    description: "One of the smallest cities in America. Cute downtown near Otter Creek with shops and restaurants.",
    distance: "~22 miles",
    driveTime: "35 min",
  },
  {
    name: "Warren / Waitsfield",
    category: "towns",
    description: "Mad River Valley towns with Sugarbush and Mad River Glen ski areas. Warren Store is a classic stop.",
    distance: "~30 miles",
    driveTime: "45 min",
  },
];

export default function GuidePage() {
  const [activeCategory, setActiveCategory] = useState<FilterCategory>("all");

  const filteredEntries =
    activeCategory === "all"
      ? entries
      : entries.filter((e) => e.category === activeCategory);

  const categories: FilterCategory[] = ["all", "swimming", "hikes", "restaurants", "activities", "towns"];

  return (
    <div>
      <Header
        title="Local Guide"
        subtitle="Our favorite places around Breadloaf Hill"
      />

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Category Filter Pills */}
        <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4">
          {categories.map((cat) => {
            const isAll = cat === "all";
            const isActive = activeCategory === cat;
            const config = isAll ? null : categoryConfig[cat];

            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-colors whitespace-nowrap flex-shrink-0 ${
                  isActive
                    ? isAll
                      ? "bg-stone-800 text-white border-stone-800"
                      : config!.pillActive
                    : isAll
                    ? "border-stone-200 text-stone-600 hover:bg-stone-50"
                    : config!.pill
                }`}
              >
                {isAll ? (
                  <Sparkles size={16} />
                ) : (
                  config!.icon
                )}
                {isAll ? "All" : config!.label}
              </button>
            );
          })}
        </div>

        {/* Entries Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredEntries.map((entry) => {
            const config = categoryConfig[entry.category];

            return (
              <div
                key={entry.name}
                className={`bg-white rounded-xl border border-stone-200 p-4 ${
                  entry.placeholder ? "border-dashed" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}
                  >
                    <span className={config.color}>{config.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3
                        className={`font-medium ${
                          entry.placeholder
                            ? "text-stone-400 italic"
                            : "text-stone-800"
                        }`}
                      >
                        {entry.name}
                      </h3>
                      {entry.familyFavorite && (
                        <span className="text-xs font-medium bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 flex-shrink-0">
                          Favorite
                        </span>
                      )}
                    </div>
                    <p
                      className={`text-sm mt-1 ${
                        entry.placeholder ? "text-stone-400" : "text-stone-500"
                      }`}
                    >
                      {entry.description}
                    </p>
                    {(entry.distance || entry.driveTime) && (
                      <div className="flex items-center gap-3 mt-2">
                        {entry.distance && (
                          <span className="inline-flex items-center gap-1 text-xs text-stone-400">
                            <MapPin size={12} />
                            {entry.distance}
                          </span>
                        )}
                        {entry.driveTime && (
                          <span className="inline-flex items-center gap-1 text-xs text-stone-400">
                            <Car size={12} />
                            {entry.driveTime}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Note */}
        <div className="text-center py-8">
          <p className="text-sm text-stone-400">
            Know a great spot we&apos;re missing? Share it on the{" "}
            <a href="/bulletin" className="text-green-700 hover:underline">
              Family Board
            </a>{" "}
            and we&apos;ll add it here.
          </p>
        </div>
      </div>
    </div>
  );
}
