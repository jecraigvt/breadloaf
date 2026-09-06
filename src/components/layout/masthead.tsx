"use client";

import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";

const HERO_PHOTOS = [
  { src: "/photos/hero-rainbow.jpg", caption: "A rainbow over the meadow at Breadloaf Hill" },
  { src: "/photos/hero-drone-house.jpg", caption: "The house among the trees" },
  { src: "/photos/winter-mountains.jpg", caption: "Winter in the Green Mountains" },
  { src: "/photos/bonfire.jpg", caption: "Gathering around the fire" },
  { src: "/photos/hilltop-view.jpg", caption: "Taking in the view together" },
];

export function Masthead() {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (paused || reducedMotion) return;
    const timer = setInterval(() => setIdx((current) => (current + 1) % HERO_PHOTOS.length), 6000);
    return () => clearInterval(timer);
  }, [paused, reducedMotion]);
  return (
    <section className="masthead fg-masthead" aria-label="Our place at Breadloaf Hill">
      <div className="photo-stack">
        {HERO_PHOTOS.map((photo, index) => (
          <img key={photo.src} src={photo.src} alt={index === idx ? photo.caption : ""}
            aria-hidden={index !== idx} style={{ opacity: index === idx ? 1 : 0 }}
            className={index === 1 ? "fg-house-photo" : undefined}
            fetchPriority={index === 0 ? "high" : "auto"} />
        ))}
      </div>
      <div className="scrim" />
      <div className="fg-hero-copy">
        <p className="eyebrow">Ripton, Vermont · Est. 1974</p>
        <h1>A place to<br /><em>come together.</em></h1>
        <p className="fg-hero-caption">The days slow down. The door stays open.</p>
      </div>
      <div className="fg-hero-controls" aria-label="Property photographs">
        <div className="fg-photo-pager">
          {HERO_PHOTOS.map((photo, index) => (
            <button key={photo.src} type="button" aria-label={`Show photo ${index + 1}: ${photo.caption}`}
              aria-pressed={index === idx} onClick={() => { setIdx(index); setPaused(true); }}><span /></button>
          ))}
        </div>
        {!reducedMotion && <button type="button" className="fg-photo-pause" onClick={() => setPaused(!paused)}
          aria-label={paused ? "Play slideshow" : "Pause slideshow"}>
          {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
        </button>}
      </div>
    </section>
  );
}
