function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x07140e);
const STARS = Array.from({ length: 46 }, () => ({
  x: `${(rand() * 100).toFixed(2)}%`,
  y: `${(rand() * 100).toFixed(2)}%`,
  size: rand() > 0.88 ? "md" : "sm",
  delay: `${(-rand() * 12).toFixed(2)}s`,
  dur: `${(5 + rand() * 7).toFixed(2)}s`,
}));

const WAVES = [
  "M-80 120 C 160 40, 420 210, 700 90 S 1080 10, 1320 130",
  "M-60 250 C 180 330, 460 140, 760 260 S 1120 360, 1360 190",
  "M-40 470 C 220 390, 520 610, 840 460 S 1160 340, 1380 520",
  "M-90 680 C 240 760, 560 560, 900 700 S 1200 820, 1420 640",
];

export function AmbientField() {
  return (
    <div className="ambient" aria-hidden="true">
      <svg className="waves" viewBox="0 0 1200 800" preserveAspectRatio="none">
        <g className="wave-glow">
          {WAVES.map((d) => (
            <path key={`g-${d}`} d={d} />
          ))}
        </g>
        <g className="wave-core">
          {WAVES.map((d) => (
            <path key={`c-${d}`} d={d} />
          ))}
        </g>
      </svg>
      <div className="starfield">
        {STARS.map((star, i) => (
          <span
            key={i}
            className={`star star-${star.size}`}
            style={{
              left: star.x,
              top: star.y,
              animationDelay: star.delay,
              animationDuration: star.dur,
            }}
          />
        ))}
      </div>
      <div className="vignette" />
    </div>
  );
}
