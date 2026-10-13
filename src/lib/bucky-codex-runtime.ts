import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

interface RuntimeOptions { platform?: NodeJS.Platform; appBinRoot?: string; searchPath?: string; }
async function executableFile(candidate: string): Promise<boolean> {
  try { return (await stat(candidate)).isFile(); } catch { return false; }
}

/** App updates replace versioned executable directories. Custom runtimes stay explicit. */
export async function resolveCodexRuntime(configured: string, options: RuntimeOptions = {}): Promise<string | null> {
  const platform = options.platform || process.platform;
  const appBinRoot = options.appBinRoot || path.join(process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local"), "OpenAI", "Codex", "bin");
  const managed = platform === "win32" && (configured === "codex" || path.resolve(configured).toLowerCase().startsWith(path.resolve(appBinRoot).toLowerCase() + path.sep));
  if (managed) {
    const directories = await readdir(appBinRoot, { withFileTypes: true }).catch(() => []);
    const candidates = await Promise.all(directories.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && /^[a-f0-9]{8,64}$/i.test(entry.name)).map(async entry => {
      const executable = path.join(appBinRoot, entry.name, "codex.exe");
      const metadata = await stat(executable).catch(() => null);
      return metadata?.isFile() ? { executable, modified: metadata.mtimeMs } : null;
    }));
    const newest = candidates.filter((candidate): candidate is { executable: string; modified: number } => candidate !== null).sort((a, b) => b.modified - a.modified)[0];
    if (newest) return newest.executable;
  }
  if (path.isAbsolute(configured) || configured.includes(path.sep)) return await executableFile(configured) ? configured : null;
  const name = platform === "win32" ? `${configured.replace(/\.exe$/i, "")}.exe` : configured;
  for (const directory of (options.searchPath ?? process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    if (await executableFile(candidate)) return candidate;
  }
  return null;
}
