export function EnvBanner() {
  const env = process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (env === "production" || !env) return null;
  const label = env === "preview" ? "PREVIEW" : env.toUpperCase();
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 9999,
        width: "100%",
        background: "#ea580c",
        color: "white",
        textAlign: "center",
        fontWeight: 600,
        fontSize: 13,
        letterSpacing: 0.3,
        padding: "4px 12px",
        borderBottom: "1px solid #c2410c",
      }}
    >
      ⚠ {label} — connected to dev database, not production
    </div>
  );
}
