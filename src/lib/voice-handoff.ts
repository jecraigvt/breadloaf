const HANDOFF_KEY = "__breadloafVoiceHandoff";

interface VoiceHandoff {
  token: string;
  file: File;
}

export interface VoiceHandoffHost {
  __breadloafVoiceHandoff?: VoiceHandoff;
}

export function stageVoiceHandoff(
  file: File,
  host: VoiceHandoffHost = window as VoiceHandoffHost
): string {
  const token = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  host[HANDOFF_KEY] = { token, file };
  return token;
}

export function consumeVoiceHandoff(
  token: string,
  host: VoiceHandoffHost = window as VoiceHandoffHost
): File | null {
  const handoff = host[HANDOFF_KEY];
  if (!handoff || handoff.token !== token) return null;
  delete host[HANDOFF_KEY];
  return handoff.file;
}
