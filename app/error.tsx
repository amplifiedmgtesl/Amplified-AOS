"use client";
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) { return <div style={{ padding: 40 }}><h1>Something went wrong</h1><pre>{error?.message}</pre><button onClick={() => reset()}>Try again</button></div>; }
