"use client";

import { useEffect, useState } from "react";

type Photo = { src: string; caption: string; chapter: string };

const HERO_PHOTOS: Photo[] = [
  {
    src: "/photos/hero-drone-house.jpg",
    caption: "The house from the hill, looking northwest",
    chapter: "Chapter I · The House",
  },
  {
    src: "/photos/hero-rainbow.jpg",
    caption: "Double rainbow after evening storm, July",
    chapter: "Chapter II · Weather",
  },
  {
    src: "/photos/winter-mountains.jpg",
    caption: "Breadloaf Mountain, first snow",
    chapter: "Chapter III · Winter",
  },
  {
    src: "/photos/bonfire.jpg",
    caption: "Solstice bonfire, June",
    chapter: "Chapter IV · Gatherings",
  },
  {
    src: "/photos/hilltop-view.jpg",
    caption: "Summit view with a small observer",
    chapter: "Chapter V · Passages",
  },
];

export function Masthead() {
  const [idx, setIdx] = useState(0);
  const [dateStr, setDateStr] = useState("");

  useEffect(() => {
    const t = setInterval(
      () => setIdx((i) => (i + 1) % HERO_PHOTOS.length),
      6000
    );
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const d = new Date();
    setDateStr(
      d
        .toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
        .toUpperCase()
    );
  }, []);

  const cur = HERO_PHOTOS[idx];

  return (
    <div className="masthead">
      <div className="photo-stack">
        {HERO_PHOTOS.map((p, i) => (
          <img
            key={p.src}
            src={p.src}
            alt=""
            style={{ opacity: i === idx ? 1 : 0 }}
          />
        ))}
      </div>
      <div className="scrim" />

      <div className="top-meta">
        <span>44.0107° N · 72.9826° W</span>
        <span>{dateStr}</span>
      </div>

      <div className="bot-meta">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            alignItems: "flex-start",
          }}
        >
          <div className="tag">{cur.chapter}</div>
          <div className="bigtitle">
            Breadloaf
            <em>Hill.</em>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
              alignItems: "flex-end",
              gap: 12,
            }}
          >
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: "rgba(245,239,228,0.85)",
                maxWidth: 240,
                lineHeight: 1.5,
              }}
            >
              <div>A family record of the house</div>
              <div>at 3995 Vermont Route 125 —</div>
              <div style={{ color: "rgba(245,239,228,0.55)" }}>
                Ripton, Addison County.
              </div>
            </div>
            <div className="pager">
              {HERO_PHOTOS.map((_, i) => (
                <span
                  key={i}
                  className={i === idx ? "active" : ""}
                  onClick={() => setIdx(i)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
