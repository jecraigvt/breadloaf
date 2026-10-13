"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";

type Member = { id: string; name: string; email: string | null; branch: string | null; accessApproved: boolean; isCurator: boolean };
type Device = { id: string; userAgent: string | null; lastUsedAt: string; current: boolean };
type AccessRequest = { id: string; name: string; email: string };
type Actor = { memberId: string; displayName: string; isCurator: boolean };

export default function FamilyAccessPage() {
  const [actor, setActor] = useState<Actor | null>(null); const [devices, setDevices] = useState<Device[]>([]);
  const [members, setMembers] = useState<Member[]>([]); const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [memberId, setMemberId] = useState(""); const [email, setEmail] = useState(""); const [caretaker, setCaretaker] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<AccessRequest | null>(null);
  const memberSelector = useRef<HTMLSelectElement>(null);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function load() { try {
    const response = await fetch("/api/auth/devices", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error);
    setActor(data.actor); setDevices(data.devices);
    if (data.actor.isCurator) { const list = await fetch("/api/access", { cache: "no-store" }); const details = await list.json(); if (!list.ok) throw new Error(details.error); setMembers(details.members); setRequests(details.requests); }
  } catch (e) { setError(e instanceof Error ? e.message : "Access information is unavailable."); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  async function save(input: Record<string, unknown>) { setBusy(true); setError(""); setMessage("");
    try { const response = await fetch("/api/access", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setMessage("Family access updated."); if (input.action === "approve") { setSelectedRequest(null); setMemberId(""); setEmail(""); setCaretaker(false); } await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); }
  }
  async function forget(device: Device) { setBusy(true); setError("");
    try { const response = await fetch("/api/auth/devices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: device.id }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); if (data.signedOut) window.location.assign("/login"); else await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); }
  }
  function selectMember(id: string) { const member = members.find(m => m.id === id); setMemberId(id); if (!selectedRequest) setEmail(member?.email || ""); setCaretaker(Boolean(member?.isCurator)); }
  function chooseRequest(request: AccessRequest) { setSelectedRequest(request); setEmail(request.email); setMemberId(""); setCaretaker(false); requestAnimationFrame(() => { memberSelector.current?.scrollIntoView({ block: "center" }); memberSelector.current?.focus(); }); }
  return <div><Header title="Family access" subtitle="Your remembered devices and the people welcome here" /><div className="fg-directory" style={{ maxWidth: 800, margin: "auto" }}>
    {loading && <p role="status">Checking your devices…</p>}{error && <p role="alert" className="text-red-700 my-4">{error}</p>}{message && <p role="status" className="my-4">{message}</p>}
    {actor && <><h2 className="font-semibold my-5">Remembered for {actor.displayName}</h2><p className="text-sm mb-5">Your bookmark opens the site on these devices. Forget a shared or lost device to require a fresh email link.</p><div className="space-y-4">{devices.map(device => <article key={device.id} className="border rounded p-4"><p className="font-medium">{device.current ? "This device" : /iPhone|iPad/.test(device.userAgent || "") ? "Apple mobile device" : /Android/.test(device.userAgent || "") ? "Android device" : /Windows/.test(device.userAgent || "") ? "Windows computer" : "Remembered device"}</p><p className="text-sm my-2">Last used {new Date(device.lastUsedAt).toLocaleDateString()}</p><button className="btn-quiet" disabled={busy} onClick={() => void forget(device)}>{device.current ? "Sign out and forget this device" : "Forget device"}</button></article>)}</div></>}
    {actor?.isCurator && <section className="mt-10"><div className="section-head"><h2 className="lt">Welcome the family</h2></div><Link href="/mail-room" className="underline">Review Mail Room arrivals</Link>
      {requests.length > 0 && <div className="my-6"><h3 className="font-semibold">Access requests</h3>{requests.map(request => <article key={request.id} className="border rounded p-4 my-3"><p>{request.name} · {request.email}</p><div className="flex gap-4 mt-3"><button className="btn-quiet" disabled={busy} onClick={() => chooseRequest(request)}>Choose their family profile below</button><button className="btn-quiet" disabled={busy} onClick={() => void save({ action: "dismiss-request", requestId: request.id })}>Dismiss</button></div></article>)}</div>}
      {selectedRequest && <p className="text-sm mt-5">Reviewing {selectedRequest.name}’s request using {selectedRequest.email}. <button type="button" className="underline" onClick={() => { setSelectedRequest(null); setMemberId(""); setEmail(""); setCaretaker(false); }}>Cancel request selection</button></p>}
      <form className="grid gap-3 my-6" onSubmit={e => { e.preventDefault(); if (!busy) void save({ action: "approve", memberId, email, caretaker }); }}><label htmlFor="access-member">Family member</label><select ref={memberSelector} id="access-member" className="border rounded p-3" value={memberId} onChange={e => selectMember(e.target.value)} required><option value="">Choose a person</option>{members.map(member => <option key={member.id} value={member.id}>{member.name} {member.accessApproved ? "· approved" : "· needs email approval"}</option>)}</select><label htmlFor="approved-email">Their individual email</label><input id="approved-email" type="email" autoComplete="off" className="border rounded p-3" value={email} onChange={e => setEmail(e.target.value)} required /><label className="flex gap-3 items-center"><input type="checkbox" checked={caretaker} onChange={e => setCaretaker(e.target.checked)} disabled={memberId === actor.memberId} />Can manage family access</label><button className="btn-ember" disabled={busy || !memberId}>{busy ? "Saving…" : "Approve this email"}</button></form>
      <p className="text-sm">Approval does not send an invitation automatically. Tell them to use Send sign-in link. Changing an email forgets that person&apos;s existing devices.</p><div className="space-y-3 mt-5">{members.map(member => <div key={member.id} className="border-b py-3 flex justify-between gap-4"><div><p>{member.name}</p><p className="text-sm text-stone-600">{member.email || "Email needed"} · {member.accessApproved ? "Approved" : "Not approved"}</p></div>{member.accessApproved && member.id !== actor.memberId && <button disabled={busy} className="btn-quiet" onClick={() => void save({ action: "revoke", memberId: member.id })}>Revoke access</button>}</div>)}</div>
    </section>}
    {!actor && !loading && <Link className="underline" href="/login?from=%2Faccess">Use an email sign-in link</Link>}
  </div></div>;
}
