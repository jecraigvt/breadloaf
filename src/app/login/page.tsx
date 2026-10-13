"use client";

import { useEffect, useState, Suspense, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, Mail, ArrowRight } from "lucide-react";
import "./sign-in.css";
import { safeSignInDestination } from "@/lib/sign-in-destination";

type AccessStatus = { authenticated: boolean; emailEnabled: boolean; emailConfigured: boolean; pinAvailable: boolean };
export default function LoginPage() { return <Suspense fallback={<p className="family-sign-in">One moment…</p>}><SignIn /></Suspense>; }
function SignIn() {
  const search = useSearchParams();
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [email, setEmail] = useState(""); const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false); const [error, setError] = useState("");
  useEffect(() => { let active = true; fetch("/api/auth", { cache: "no-store" }).then(r => r.json()).then(data => {
    if (!active) return;
    if (data.authenticated) window.location.assign(safeSignInDestination(search.get("from")));
    else setStatus(data);
  }).catch(() => { if (active) setError("We couldn't reach the site. Please try again shortly."); }); return () => { active = false; }; }, [search]);
  async function sendLink(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { const response = await fetch("/api/auth/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, from: search.get("from") }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "The link couldn't be requested. Please try again."); setSent(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again shortly."); } finally { setBusy(false); }
  }
  async function usePin(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Sign-in failed."); localStorage.setItem("breadloaf-username", data.family);
      window.location.assign(safeSignInDestination(search.get("from")));
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again shortly."); setBusy(false); }
  }
  return <section className="family-sign-in" aria-labelledby="sign-in-title">
    <Link href="/" className="family-sign-in-brand">Breadloaf <em>Hill.</em></Link><p className="eyebrow">The family field guide</p>
    <h1 id="sign-in-title">Come on <em>in.</em></h1>
    {sent ? <div role="status"><Mail aria-hidden="true" size={28} /><h2>Check your email</h2><p>If {email} is on the family list, your link is on its way. It works once and expires in 20 minutes.</p><p>Check your spam folder too. Open the link on the device you want to use.</p><button type="button" className="btn-quiet" onClick={() => setSent(false)}>Use another email</button></div> : <>
      <p>Use your family email to receive a sign-in link. We’ll remember this device for future visits.</p>
      {status?.emailEnabled && <form onSubmit={sendLink}><label htmlFor="family-email">Your email</label><input id="family-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} autoFocus /><button type="submit" className="btn-ember" disabled={busy || !email.trim() || !status.emailConfigured}>{busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Mail size={18} aria-hidden="true" />} Send sign-in link</button><p className="family-sign-in-small">{status.emailConfigured ? "No password to remember." : "Email delivery is temporarily unavailable. Contact the family caretaker."}</p></form>}
      {status?.pinAvailable && <details open={!status.emailEnabled}><summary>Use the family PIN during the transition</summary><form onSubmit={usePin}><label htmlFor="family-pin">Family PIN</label><input id="family-pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} required maxLength={32} /><button className="btn-ember" disabled={busy || !pin}>Open Breadloaf Hill <ArrowRight size={17} aria-hidden="true" /></button></form></details>}
      {!status && !error && <p role="status">One moment…</p>}
    </>}
    {error && <p className="family-sign-in-error" role="alert">{error}</p>}
    <Link className="family-sign-in-help" href="/login/request-access">Need your email added to the family list?</Link>
    <div className="family-sign-in-public"><Link href="/emergency">Emergency contacts</Link><Link href="/guide">Local guide</Link><Link href="/weather">Weather</Link></div>
  </section>;
}
