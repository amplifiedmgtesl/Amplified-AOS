"use client";
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) { return <html><body><div style={{ padding: 40 }}><h1>Global error</h1><pre>{error?.message}</pre><button onClick={() => reset()}>Try again</button></div></body></html>; }
