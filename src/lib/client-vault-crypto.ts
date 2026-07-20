export interface EncryptedVaultSecret {
  encryptedSecret: string;
  secretIv: string;
  encryptionVersion: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer as ArrayBuffer;
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function deriveVaultEncryptionKey(
  passphrase: string,
  salt: string,
  iterations: number
): Promise<CryptoKey> {
  const source = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(fromBase64Url(salt)),
      iterations,
    },
    source,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptVaultSecret(
  key: CryptoKey,
  value: { password: string; recoveryNotes?: string }
): Promise<EncryptedVaultSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext)
  );
  return {
    encryptedSecret: toBase64Url(new Uint8Array(encrypted)),
    secretIv: toBase64Url(iv),
    encryptionVersion: 1,
  };
}

export async function decryptVaultSecret(
  key: CryptoKey,
  encryptedSecret: string,
  secretIv: string
): Promise<{ password: string; recoveryNotes?: string }> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(fromBase64Url(secretIv)) },
    key,
    toArrayBuffer(fromBase64Url(encryptedSecret))
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as {
    password: string;
    recoveryNotes?: string;
  };
}
