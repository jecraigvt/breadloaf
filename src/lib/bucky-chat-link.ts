export type BuckyChatLink = {
  kind: "internal" | "external";
  href: string;
};

const BREADLOAF_HOSTS = new Set(["breadloafhill.com", "www.breadloafhill.com"]);

/** Only allow site paths and ordinary webpages in generated chat replies. */
export function resolveBuckyChatLink(href: string | undefined): BuckyChatLink | null {
  const value = href?.trim();
  // Browsers normalize backslashes and control characters in URLs. Reject them
  // before deciding whether a destination stays on this site.
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value) || value.startsWith("//")) {
    return null;
  }

  if (value.startsWith("/")) {
    return { kind: "internal", href: value };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    return null;
  }

  if (BREADLOAF_HOSTS.has(url.hostname) && !url.port) {
    return { kind: "internal", href: `${url.pathname}${url.search}${url.hash}` };
  }

  return { kind: "external", href: url.href };
}
