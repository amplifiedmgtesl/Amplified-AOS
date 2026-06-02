"use client";

// Music-themed loading indicator. Five animated equalizer bars plus a label.
// Renders as an absolute-positioned overlay — the parent must be
// `position: relative` for it to cover correctly.
export function EqualizerLoader({ label = "Loading…" }: { label?: string }) {
  const bars = [0, 1, 2, 3, 4];
  const delays = ["0s", "-0.7s", "-0.2s", "-0.5s", "-0.9s"];
  return (
    <div
      className="hide-print"
      style={{
        position: "absolute", inset: 0, zIndex: 50,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 14, background: "rgba(255,251,240,0.85)", backdropFilter: "blur(2px)",
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 40 }}>
        {bars.map((i) => (
          <div key={i} style={{
            width: 6, height: "100%",
            background: "linear-gradient(180deg, #2563eb 0%, #7a4a00 100%)",
            borderRadius: 3,
            animation: `tk-eq 0.9s ease-in-out ${delays[i]} infinite`,
            transformOrigin: "bottom",
          }} />
        ))}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#4a4a4a", letterSpacing: 0.2 }}>
        🎵 {label}
      </div>
      <style>{`@keyframes tk-eq { 0%,100% { transform: scaleY(0.25); } 50% { transform: scaleY(1); } }`}</style>
    </div>
  );
}
