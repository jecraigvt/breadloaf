import Link from "next/link";
import { Phone } from "lucide-react";
import { Header } from "@/components/layout/header";
import { PrintEmergencyCard } from "@/components/print-emergency-card";

const CONTACTS = [
  { name: "Poison Control", phone: "1-800-222-1222", description: "Northern New England Poison Center · available 24 hours", source: "https://healthvermont.org/about/contact-us/get-help-now" },
  { name: "Porter Medical Center", phone: "(802) 388-4701", description: "Hospital main number · 115 Porter Drive, Middlebury, VT", source: "https://www.uvmhealth.org/", directions: "https://www.google.com/maps/search/?api=1&query=Porter+Medical+Center+115+Porter+Drive+Middlebury+VT" },
  { name: "Vermont State Police", phone: "(802) 388-4919", description: "New Haven barracks · non-emergency inquiries", source: "https://vsp.vermont.gov/stations/newhaven" },
  { name: "Green Mountain Power", phone: "1-888-835-4672", description: "Report an electricity outage", source: "https://greenmountainpower.com/report-outage/" },
];

export default function EmergencyPage() {
  return <div className="fade-in emergency-page">
    <Header title="Emergency" subtitle="Help and the property address, always within reach." />
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-5">
      <PrintEmergencyCard />
      <section className="border-2 border-red-700 rounded-xl p-5 bg-red-50" aria-labelledby="emergency-call">
        <h2 id="emergency-call" className="text-xl font-semibold text-red-900">For an emergency, call 911</h2>
        <p className="mt-2 text-red-900">Fire, medical emergency, or immediate danger.</p>
        <a href="tel:911" className="inline-flex items-center gap-2 mt-4 px-5 py-3 rounded-lg bg-red-700 text-white font-semibold"><Phone size={20} aria-hidden="true" />Call 911</a>
      </section>
      <section className="p-5 bg-white border border-stone-300 rounded-xl" aria-labelledby="property-address">
        <h2 id="property-address" className="text-lg font-semibold">Tell the dispatcher</h2>
        <p className="text-xl mt-2">3995 Vermont Route 125<br />Ripton, Vermont 05766</p>
        <p className="mt-2 text-stone-600">The property is called Breadloaf Hill.</p>
        <a className="inline-block mt-3 text-green-800 underline" href="https://www.google.com/maps/search/?api=1&query=3995+Vermont+Route+125+Ripton+VT+05766" target="_blank" rel="noopener noreferrer">Open the property location</a>
      </section>
      <section aria-labelledby="other-contacts">
        <h2 id="other-contacts" className="text-lg font-semibold mb-3">Other useful numbers</h2>
        <ul className="space-y-3">{CONTACTS.map(contact => <li key={contact.name} className="p-4 bg-white border border-stone-200 rounded-xl">
          <h3 className="font-semibold">{contact.name}</h3><p className="text-sm text-stone-600 mt-1">{contact.description}</p>
          <a href={"tel:" + contact.phone.replace(/[^+\d]/g, "")} className="inline-flex items-center gap-2 py-3 text-green-800 font-semibold"><Phone size={16} aria-hidden="true" />{contact.phone}</a>
          <div className="flex gap-4 text-sm"><a href={contact.source} target="_blank" rel="noopener noreferrer" className="underline text-stone-600">Official contact information</a>{contact.directions && <a href={contact.directions} target="_blank" rel="noopener noreferrer" className="underline text-green-800">Hospital directions</a>}</div>
        </li>)}</ul>
      </section>
      <p className="text-sm text-stone-600 print:hidden">For property repairs, check <Link href="/maintenance" className="underline text-green-800">maintenance history</Link> for the provider previously used.</p>
    </div>
  </div>;
}
