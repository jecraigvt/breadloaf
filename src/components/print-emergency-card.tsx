"use client";

export function PrintEmergencyCard() {
  return <button type="button" onClick={() => window.print()} className="print:hidden px-4 py-2 border border-stone-300 rounded-lg bg-white text-stone-800">Print a house emergency card</button>;
}
