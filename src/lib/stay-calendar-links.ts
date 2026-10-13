import { stayDateKey } from "./stay-dates";

export function googleVisitTemplate(stay: { guestName: string; checkIn: Date | string; checkOut: Date | string; notes: string | null }, roomName: string) {
  const params = new URLSearchParams({ action: "TEMPLATE", text: `${stay.guestName} at Breadloaf Hill`,
    dates: `${stayDateKey(stay.checkIn).replace(/-/g, "")}/${stayDateKey(stay.checkOut).replace(/-/g, "")}`,
    details: `Room: ${roomName}\n${stay.notes || ""}`, location: "Breadloaf Hill, Vermont" });
  return `https://calendar.google.com/calendar/render?${params}`;
}
