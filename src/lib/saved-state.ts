/** A failed HTTP response must never be presented as a saved family change. */
export async function requestSavedState<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not save. Please try again.");
  if (body === null) throw new Error("The server did not confirm the saved change. Please try again.");
  return body as T;
}
