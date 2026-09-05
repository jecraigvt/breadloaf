/** This policy is run from the trusted base checkout, never from the proposed worktree. */
export function isDevelopmentPath(file: string): boolean {
  if (file.includes("\\") || file.includes("..") || !/^[a-zA-Z0-9_./\[\]()-]+$/.test(file)) return false;
  return file === "src/app/globals.css"
    || /^src\/components\/.+\.(tsx|css)$/.test(file)
    || /^src\/app\/(?!api\/).+\/(page|loading|error)\.tsx$/.test(file)
    || file === "src/app/page.tsx";
}

export function changedPatchPaths(patch: string): string[] {
  if (!patch.trim()) return [];
  if (patch.length > 200_000 || /(?:^|\n)(?:GIT binary patch|Binary files|old mode|new mode|new file mode|deleted file mode|rename from|rename to|copy from|copy to)/.test(patch))
    throw new Error("Binary, mode, rename, creation, and deletion patches require manual preparation");
  const paths: string[] = [];
  for (const line of patch.split("\n")) {
    if (!line.startsWith("diff --git ")) continue;
    const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
    if (!match || match[1] !== match[2] || !isDevelopmentPath(match[1]))
      throw new Error("Patch changes a protected or unsupported path");
    paths.push(match[1]);
  }
  if (!paths.length) throw new Error("Patch has no recognizable file changes");
  for (const line of patch.split("\n")) {
    if (!line.startsWith("--- ") && !line.startsWith("+++ ")) continue;
    if (!/^(--- a\/|\+\+\+ b\/)/.test(line) || !paths.includes(line.slice(6)))
      throw new Error("Patch headers disagree with allowed paths");
  }
  return Array.from(new Set(paths));
}

export function publishingDecision(patch: string): { automatic: boolean; paths: string[]; reason: string } {
  const paths = changedPatchPaths(patch);
  if (!paths.length) return { automatic: false, paths, reason: "No changes proposed" };
  // The initial automatic lane is intentionally small. Interaction code gets the
  // same independent checks and a reviewable PR, rather than inferring safety
  // from a model's assertion. Expanding this list requires a maintainer change.
  if (paths.some((p) => !p.endsWith(".css")))
    return { automatic: false, paths, reason: "Code changes require maintainer review" };
  const added = patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).join("\n");
  if (/url\s*\(|@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding|\\|content\s*:|@font-face/i.test(added))
    return { automatic: false, paths, reason: "CSS includes resource, generated content, or escaped values requiring review" };
  if (patch.split("\n").filter((line) => /^[+-](?![+-])/.test(line)).length > 100)
    return { automatic: false, paths, reason: "Change exceeds the small presentation-fix limit" };
  return { automatic: true, paths, reason: "Small CSS-only presentation fix; independent checks still required" };
}
