"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import "../sign-in.css";
export default function RequestFamilyAccess() {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function request(event: FormEvent) { event.preventDefault(); setBusy(true); setError("");
    try { const response = await fetch("/api/auth/access-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setMessage(data.message); }
    catch (e) { setError(e instanceof Error ? e.message : "Please try again shortly."); } finally { setBusy(false); }
  }
  return <section className="family-sign-in"><Link className="family-sign-in-brand" href="/">Breadloaf <em>Hill.</em></Link><p className="eyebrow">Family access</p><h1>Find your <em>place.</em></h1><p>Give the family caretaker your name and the email you want to use. Approval connects it to your family profile.</p>{message ? <p role="status">{message}</p> : <form onSubmit={request}><label htmlFor="access-name">Your name</label><input id="access-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={120} required /><label htmlFor="access-email">Your email</label><input id="access-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} required /><button className="btn-ember" disabled={busy}>{busy ? "Saving…" : "Request family access"}</button></form>}{error && <p className="family-sign-in-error" role="alert">{error}</p>}<Link href="/login" className="family-sign-in-help">Back to sign in</Link></section>;
}
