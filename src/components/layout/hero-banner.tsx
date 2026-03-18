"use client";

import { useState, useEffect, useCallback } from "react";
import { TreePine, Mountain } from "lucide-react";

const heroImages = [
  { src: "/photos/hero-drone-house.jpg", alt: "Breadloaf Hill from above", position: "object-center" },
  { src: "/photos/hero-rainbow.jpg", alt: "Rainbow over Breadloaf Hill", position: "object-center" },
  { src: "/photos/hero-mountains.jpg", alt: "Mountain view from Breadloaf Hill", position: "object-center" },
  { src: "/photos/hero-drone-landscape.jpg", alt: "The view from Breadloaf Hill", position: "object-center" },
  { src: "/photos/family-group.jpg", alt: "The Craig family at Breadloaf Hill", position: "object-top" },
];

interface HeroBannerProps {
  greeting: string;
  seasonLabel: string;
  docCount: number;
  boardCount: number;
}

export function HeroBanner({ greeting, seasonLabel, docCount, boardCount }: HeroBannerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const nextImage = useCallback(() => {
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % heroImages.length);
      setIsTransitioning(false);
    }, 600);
  }, []);

  useEffect(() => {
    const interval = setInterval(nextImage, 8000);
    return () => clearInterval(interval);
  }, [nextImage]);

  return (
    <header className="relative overflow-hidden h-[70vh] min-h-[420px] max-h-[700px]">
      {/* Background images — preload all, show current */}
      {heroImages.map((img, i) => (
        <div
          key={img.src}
          className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${
            i === currentIndex && !isTransitioning ? "opacity-100" : "opacity-0"
          }`}
        >
          <img
            src={img.src}
            alt={img.alt}
            className={`w-full h-full object-cover ${img.position}`}
          />
        </div>
      ))}

      {/* Gradient overlay — lighter in middle to let photo breathe */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/10 to-black/60 z-[1]" />

      {/* Content pinned to bottom */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-4 pb-10 sm:pb-14">
        <div className="max-w-5xl mx-auto flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TreePine size={16} className="text-green-300" />
              <span className="text-green-300/90 text-sm font-medium tracking-wide uppercase drop-shadow">
                {seasonLabel}
              </span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-2 text-white drop-shadow-lg">
              Breadloaf Hill
            </h1>
            <p className="text-white/85 text-lg mb-3 drop-shadow">
              {greeting}! Welcome to your family hub.
            </p>
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 pulse-dot" />
                <span className="text-white/70 drop-shadow">{docCount} documents archived</span>
              </div>
              {boardCount > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-400 pulse-dot" />
                  <span className="text-white/70 drop-shadow">{boardCount} board updates</span>
                </div>
              )}
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 bg-white/15 rounded-full px-4 py-2 backdrop-blur-md mb-1">
            <Mountain size={20} className="text-green-300" />
            <span className="text-white/90 text-sm font-medium">Vermont</span>
          </div>
        </div>
      </div>

      {/* Image indicator dots */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
        {heroImages.map((_, i) => (
          <button
            key={i}
            onClick={() => {
              setIsTransitioning(true);
              setTimeout(() => {
                setCurrentIndex(i);
                setIsTransitioning(false);
              }, 300);
            }}
            className={`w-2 h-2 rounded-full transition-all ${
              i === currentIndex
                ? "bg-white w-5"
                : "bg-white/40 hover:bg-white/60"
            }`}
          />
        ))}
      </div>
    </header>
  );
}
