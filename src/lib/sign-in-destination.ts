/** Shared by server and sign-in UI; never navigate to an external or recursive sign-in URL. */
export function safeSignInDestination(value: unknown): string {
  if (typeof value !== "string" || value.length > 1500 || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return "/";
  try {
    const parsed = new URL(value, "https://breadloafhill.com");
    if (parsed.origin !== "https://breadloafhill.com" || parsed.pathname.startsWith("/login") || parsed.pathname.startsWith("/api/auth")) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return "/"; }
}
