// Several modules under test live in files that import "@/lib/supabase/client"
// at module scope. That module calls createClient(url, key) on import and
// throws when the env vars are absent, so importing e.g. priceTimesheetGroup
// would blow up before a single assertion ran.
//
// Stubbing the two public env vars is enough to let the client construct. It
// is never used: every function exercised in tests/ is synchronous and takes
// its data as arguments. Nothing here reaches the network.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
