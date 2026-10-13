"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import "../sign-in.css";
import { safeSignInDestination } from "@/lib/sign-in-destination";

export default function ConfirmSignIn() {
  const [token, setToken] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const readLink = useRef(false);
  useEffect(() => { if (readLink.current) return; readLink.current = true; const secret = new URLSearchParams(window.location.hash.slice(1)).get("token") || new URLSearchParams(window.location.search).get("token") || ""; setToken(secret); window.history.replaceState(null, "", "/login/confirm"); if (!secret) setError("Open the link from your email, or request a fresh one below."); }, []);
  async function signIn() {
    if (busy || !token) return;
    setBusy(true); setError("");
    try { const response = await fetch("/api/auth/link/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Sign-in failed."); localStorage.setItem("breadloaf-username", data.displayName); window.location.assign(safeSignInDestination(data.destination));
    } catch (e) { setError(e instanceof Error ? e.message : "Please request a new link."); setBusy(false); }
  }
  return <section className="family-sign-in"><Link className="family-sign-in-brand" href="/">Breadloaf <em>Hill.</em></Link><p className="eyebrow">Your family sign-in link</p><h1>Welcome <em>back.</em></h1><p>Open the family site on this device. We’ll remember it for your next visit.</p><button className="btn-ember" onClick={() => void signIn()} disabled={!token || busy}>{busy && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}Sign in on this device</button>{error && <p role="alert" className="family-sign-in-error">{error}</p>}<Link href="/login" className="family-sign-in-help">Send me a new sign-in link</Link></section>;
}
