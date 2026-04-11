"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("owner@amplifiedesl.com");
  const [password, setPassword] = useState("");

  return (
    <div style={{ minHeight:"100vh", display:"grid", placeItems:"center", padding:24 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          window.location.href = "/dashboard";
        }}
        className="card"
        style={{ width:"100%", maxWidth:420 }}
      >
        <h1 className="page-title" style={{ fontSize:36 }}>Sign In</h1>
        <p className="page-subtitle">Local sign-in screen for this stable rebuild.</p>
        <div className="grid">
          <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="Email" />
          <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Password" />
          <button>Sign in</button>
        </div>
      </form>
    </div>
  );
}
