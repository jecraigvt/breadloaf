export interface NestedControlEvent {
  preventDefault(): void;
  stopPropagation(): void;
}

export function isolateTileMicTap(event: NestedControlEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function canRecordOnHub(permission: PermissionState | "unsupported"): boolean {
  return permission === "granted";
}

export async function microphonePermissionState(): Promise<PermissionState | "unsupported"> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unsupported";
  try {
    const status = await navigator.permissions.query(
      { name: "microphone" } as PermissionDescriptor
    );
    return status.state;
  } catch {
    return "unsupported";
  }
}
