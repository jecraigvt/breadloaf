import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export class UnsafeExternalUrlError extends Error {}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2))))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    const first = Number.parseInt(lower.split(":")[0], 16);
    // Only native global unicast. Exclude embedded IPv4/tunnels/documentation.
    return first >= 0x2000 && first <= 0x3fff && !lower.includes(".")
      && !/^2001:(?:0*:|0*db8:|0*[01][0-9a-f]{0,2}:)/i.test(lower)
      && !lower.startsWith("2002:") && !lower.startsWith("3fff:");
  }
  return false;
}

export function safeLinkUrl(value: string | URL): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new UnsafeExternalUrlError("Invalid link URL"); }
  if (!["https:", "http:"].includes(url.protocol)) throw new UnsafeExternalUrlError(`Unsupported link protocol: ${url.protocol}`);
  if (url.username || url.password || (url.port && !["80", "443"].includes(url.port))) {
    throw new UnsafeExternalUrlError("Links cannot contain credentials or private service ports");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if ((isIP(hostname) && !isPublicAddress(hostname))
    || hostname === "localhost" || !hostname.includes(".") && !isIP(hostname)
    || /\.(?:localhost|local|internal|invalid)$/.test(hostname)) {
    throw new UnsafeExternalUrlError("Links must point to a public website");
  }
  return url;
}

interface Address { address: string; family: number }
export interface SafeExternalFetchOptions { maxBytes?: number; timeoutMs?: number; maxRedirects?: number }
export interface SafeExternalFetchDependencies {
  resolve(hostname: string): Promise<Address[]>;
  request(url: URL, address: Address, options: Required<SafeExternalFetchOptions>): Promise<Response>;
}

async function pinnedRequest(url: URL, address: Address, options: Required<SafeExternalFetchOptions>): Promise<Response> {
  return new Promise((resolve, reject) => {
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [{ address: address.address, family: address.family }]);
      else callback(null, address.address, address.family);
    };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET", family: address.family, lookup: pinnedLookup,
      maxHeaderSize: 16 * 1024,
      headers: { "User-Agent": "BreadloafHill/1.0 (+https://breadloafhill.com)", "Accept-Encoding": "identity" },
    });
    const timer = setTimeout(() => request.destroy(new Error("Linked website timed out")), options.timeoutMs);
    const fail = (error: Error) => { clearTimeout(timer); reject(error); };
    request.on("error", fail);
    request.on("response", (response) => {
      const status = response.statusCode || 502;
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy(); clearTimeout(timer);
        resolve(new Response(null, { status, headers })); return;
      }
      if (Number(headers.get("content-length")) > options.maxBytes) {
        response.destroy(); request.destroy(); fail(new Error("Linked content is too large")); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > options.maxBytes) {
          response.destroy(); request.destroy(); fail(new Error("Linked content is too large"));
        } else chunks.push(chunk);
      });
      response.on("error", fail);
      response.on("end", () => {
        clearTimeout(timer);
        resolve(new Response([204, 205, 304].includes(status) ? null : new Uint8Array(Buffer.concat(chunks)), { status, headers }));
      });
    });
    request.end();
  });
}

const dependencies: SafeExternalFetchDependencies = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  request: pinnedRequest,
};

/** Validate every destination and pin the actual connection to a checked DNS address. */
export async function safeExternalFetch(value: string | URL, options: SafeExternalFetchOptions = {}, services = dependencies): Promise<Response> {
  const limits = { maxBytes: options.maxBytes ?? 2 * 1024 * 1024, timeoutMs: options.timeoutMs ?? 10000, maxRedirects: options.maxRedirects ?? 3 };
  const deadline = Date.now() + limits.timeoutMs;
  let url = safeLinkUrl(value);
  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
      services.resolve(hostname),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Linked website DNS lookup timed out")), Math.max(1, deadline - Date.now())); }),
    ]).finally(() => clearTimeout(timer));
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new UnsafeExternalUrlError("The linked website resolves to a private or reserved address");
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Linked website timed out");
    const response = await services.request(url, addresses[0], { ...limits, timeoutMs: remaining });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || hop === limits.maxRedirects) throw new UnsafeExternalUrlError("Linked website redirects too many times");
    url = safeLinkUrl(new URL(location, url));
  }
  throw new UnsafeExternalUrlError("Linked website redirects too many times");
}
