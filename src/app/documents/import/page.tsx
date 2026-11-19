"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { Header } from "@/components/layout/header";
import {
  archiveImportJson, archiveImportRequest, inventoryScans, scanFolderKey, sendArchiveScan,
  type ArchiveBatchInfo, type ScanInventory,
} from "@/lib/archive-import-client";
import { ARCHIVE_BATCH_BYTES, ARCHIVE_BATCH_FILES } from "@/lib/archive-import-format";
import { formatFileSize } from "@/lib/utils";
import "../../fieldguide-archive.css";

export default function ArchiveImportPage() {
  const [inventory, setInventory] = useState<ScanInventory | null>(null);
  const [groupImages, setGroupImages] = useState(false);
  const [recent, setRecent] = useState<ArchiveBatchInfo[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const [selectedFile, setSelectedFile] = useState("");
  const [uploaded, setUploaded] = useState(0);
  const [issue, setIssue] = useState("");
  const [finished, setFinished] = useState(false);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => archiveImportRequest<{ imports: ArchiveBatchInfo[] }>("", { signal: controller.signal })
      .then(result => { setRecent(result.imports); setAuthorized(true); });
    void refresh().catch(error => { if (!controller.signal.aborted) setIssue(error.message); });
    const timer = setInterval(() => { void refresh().catch(() => undefined); }, 30_000);
    return () => { clearInterval(timer); controller.abort(); active.current?.abort(); };
  }, []);

  const tooLarge = inventory && (inventory.scans.length > ARCHIVE_BATCH_FILES || inventory.sizeBytes > ARCHIVE_BATCH_BYTES);

  async function start() {
    if (!inventory?.scans.length || tooLarge || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const { signal } = controller;
    setIssue("");
    setBusy(true);
    setFinished(false);
    setSaved(0);
    setUploaded(0);
    try {
      const batch = await archiveImportRequest<ArchiveBatchInfo>("", archiveImportJson({
        folderKey: scanFolderKey(inventory, groupImages), folderName: inventory.folderName,
        groupImages, fileCount: inventory.scans.length, sizeBytes: inventory.sizeBytes,
      }, signal));
      let priorBytes = 0;
      for (const [position, entry] of inventory.scans.entries()) {
        setSelectedFile(entry.relativePath);
        await sendArchiveScan(batch.id, entry, position, signal, offset => setUploaded(priorBytes + offset));
        priorBytes += entry.file.size;
        setSaved(position + 1);
      }
      setFinished(true);
    } catch (error) {
      setIssue(signal.aborted ? "Import paused. Choose Resume import to pick up where you left off."
        : error instanceof Error ? error.message : "The import was interrupted.");
    } finally {
      active.current = null;
      setBusy(false);
      setSelectedFile("");
      void archiveImportRequest<{ imports: ArchiveBatchInfo[] }>("").then(result => setRecent(result.imports)).catch(() => undefined);
    }
  }

  return (
    <div className="fg-archive fg-upload">
      <Header title="Import a folder" subtitle="Save original scans to the family archive" />
      <div className="fg-archive-body space-y-5">
        <Link href="/documents" className="fg-archive-text-link"><ArrowLeft size={16} /> Back to Archive</Link>
        {issue && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{issue}</p>}
        {authorized && (
          <section className="fg-archive-panel space-y-4" aria-label="Folder import">
            <label htmlFor="scan-folder" className="flex items-center gap-2 font-semibold"><FolderOpen size={20} /> Scan folder</label>
            <input id="scan-folder" type="file" multiple disabled={busy}
              ref={element => { element?.setAttribute("webkitdirectory", ""); }}
              className="block w-full text-sm"
              onChange={event => {
                setInventory(inventoryScans(Array.from(event.target.files || [])));
                setIssue(""); setSaved(0); setUploaded(0); setFinished(false);
              }} />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={groupImages} disabled={busy}
                onChange={event => { setGroupImages(event.target.checked); setFinished(false); setSaved(0); setUploaded(0); }} />
              Treat images in each folder as pages of the same record.
            </label>
            {inventory && (
              <>
                <p className="break-words text-sm">
                  {inventory.scans.length} scans in {inventory.folderName} · {formatFileSize(inventory.sizeBytes)}
                </p>
                {inventory.needsReader > 0 && <p className="text-sm">Bucky can’t read {inventory.needsReader} of these scans yet. Their originals can still be saved.</p>}
                {inventory.skipped.length > 0 && (
                  <details className="text-sm">
                    <summary>See {inventory.skipped.length} files that will be skipped</summary>
                    <ul className="mt-2 max-h-32 overflow-auto">{inventory.skipped.map((file, index) => <li key={index} className="break-all">{file}</li>)}</ul>
                  </details>
                )}
                {tooLarge && <p role="alert" className="text-sm text-amber-800">Choose a folder with up to 25,000 scans and 15 GiB total.</p>}
                {(busy || saved > 0 || uploaded > 0) && (
                  <div aria-live="polite" className="space-y-1 text-sm">
                    <progress value={uploaded} max={Math.max(1, inventory.sizeBytes)} className="w-full" aria-label="Originals uploaded" />
                    <p>{saved} of {inventory.scans.length} originals saved</p>
                    {selectedFile && <p className="break-all text-stone-600">Working on {selectedFile}</p>}
                  </div>
                )}
                {finished ? (
                  <p role="status" className="text-sm text-green-800">Originals saved. Follow reading progress in <Link href="/bucky/jobs" className="underline">Bucky’s tasks</Link>.</p>
                ) : busy ? (
                  <button type="button" className="btn-quiet" onClick={() => active.current?.abort()}>Pause import</button>
                ) : (
                  <button type="button" className="btn-ember disabled:opacity-50" disabled={!inventory.scans.length || !!tooLarge} onClick={() => void start()}>
                    {issue || saved > 0 || uploaded > 0 ? "Resume import" : "Import folder"}
                  </button>
                )}
              </>
            )}
            <p className="text-sm text-stone-600">Select the same folder again to resume an import. Bucky reads supported scans after they’re saved.</p>
          </section>
        )}
        {recent.length > 0 && (
          <section className="fg-archive-panel space-y-2" aria-label="Recent imports">
            <h2 className="font-semibold">Recent imports</h2>
            <ul className="space-y-2 text-sm">
              {recent.map(batch => (
                <li key={batch.id} className="break-words">
                  {batch.folderName} · {batch.savedCount} of {batch.fileCount} saved · {batch.readCount ?? 0} read
                  {!!batch.unsupportedCount && " · " + batch.unsupportedCount + " need a reader"}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
