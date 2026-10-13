export interface EmailAuthentication { verified: boolean; reason: string }
export interface RawHeader { key: string; value: string }

export function rawEmailHeaders(source: Buffer): RawHeader[] {
  const headerText = source.subarray(0, Math.min(source.length, 256 * 1024)).toString("utf8").split(/\r?\n\r?\n/, 1)[0];
  const lines = headerText.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  return lines.flatMap((line) => {
    const separator = line.indexOf(":");
    return separator < 1 ? [] : [{ key: line.slice(0, separator).trim().toLowerCase(), value: line.slice(separator + 1).trim() }];
  });
}

/** Gmail's outermost receiving result is authoritative; never accept a lower/forwarded result. */
export function gmailSenderAuthentication(headers: RawHeader[], fromEmail: string, fromCount = 1): EmailAuthentication {
  if (fromCount !== 1 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(fromEmail)) return { verified: false, reason: "The message has no single valid From address" };
  const result = headers.find((header) => header.key === "authentication-results");
  if (!result || !/^mx\.google\.com\s*;/i.test(result.value)) return { verified: false, reason: "Gmail's receiving authentication result is missing" };
  const domain = fromEmail.split("@")[1].toLowerCase();
  const sections = result.value.split(";").slice(1);
  const dmarc = sections.find((section) => /^\s*dmarc\s*=\s*pass\b/i.test(section));
  const alignedFrom = dmarc?.match(/\bheader\.from\s*=\s*([^\s;)]+)/i)?.[1]?.replace(/^"|"$/g, "").toLowerCase();
  if (alignedFrom !== domain) return { verified: false, reason: "Gmail did not report DMARC passing for the actual From domain" };
  if (!sections.some((section) => /^\s*(?:dkim|spf)\s*=\s*pass\b/i.test(section))) return { verified: false, reason: "Gmail reported no passing SPF or DKIM result" };
  return { verified: true, reason: `Gmail verified the From domain ${domain}` };
}

export function isOwnMailNotification(headers: RawHeader[], fromEmail: string): boolean {
  return fromEmail.toLowerCase() === "breadloafhillsite@gmail.com" && headers.some((header) => header.key === "x-breadloaf-notification" || header.key === "x-breadloaf-question-id");
}

/** Allow-all is deliberately absent: strangers need per-message curator review. */
export function emailIntakeDisposition(input: { authentication: EmailAuthentication; knownSender: boolean; ownNotification: boolean }): "received" | "quarantined" | "ignored" {
  if (input.ownNotification) return "ignored";
  return input.authentication.verified && input.knownSender ? "received" : "quarantined";
}
