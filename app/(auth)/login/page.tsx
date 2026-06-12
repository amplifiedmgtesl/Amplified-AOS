"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError || !data.user) {
      setError(signInError?.message ?? "Sign in failed.");
      setLoading(false);
      return;
    }

    // Only allow users with role='admin' in their profile
    const { data: profileData } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    if (!profileData || !["admin", "crew_leader", "payroll"].includes(profileData.role)) {
      await supabase.auth.signOut();
      setError("Access denied. Staff members must use the Staff Portal.");
      setLoading(false);
      return;
    }

    window.location.href =
      profileData.role === "crew_leader" ? "/lead/timekeeping"
      : profileData.role === "payroll" ? "/payroll"
      : "/dashboard";
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form onSubmit={handleSubmit} className="card" style={{ width: "100%", maxWidth: 420 }}>
        <h1 className="page-title" style={{ fontSize: 36 }}>Sign In</h1>
        <p className="page-subtitle">Amplified Operations Suite</p>
        <div className="grid">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            autoComplete="email"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            autoComplete="current-password"
          />
          {error && (
            <div style={{ color: "#c0392b", fontSize: 14, padding: "8px 0" }}>{error}</div>
          )}
          <button disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
