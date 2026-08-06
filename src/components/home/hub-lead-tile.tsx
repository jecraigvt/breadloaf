"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Loader2, Mic, Square, X } from "lucide-react";
import { useState } from "react";
import {
  formatRecordingClock,
  RECORDING_WARN_SECONDS,
  useVoiceRecorder,
} from "@/components/voice/use-voice-recorder";
import {
  canRecordOnHub,
  isolateTileMicTap,
  microphonePermissionState,
} from "@/lib/hub-mic";
import { stageVoiceHandoff } from "@/lib/voice-handoff";

interface HubLeadTileProps {
  lbl: string;
  sub: string;
  href: string;
}

function voiceMemoName(extension: string): string {
  const stamp = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Voice memo ${stamp}.${extension}`.replace(/[,:]/g, "");
}

export function HubLeadTile({ lbl, sub, href }: HubLeadTileProps) {
  const router = useRouter();
  const [checkingPermission, setCheckingPermission] = useState(false);
  const recorder = useVoiceRecorder({
    fileName: voiceMemoName,
    onComplete: (file) => {
      const token = stageVoiceHandoff(file);
      router.push(`/assistant?voice=${encodeURIComponent(token)}`);
    },
  });

  const handleMicTap = async (event: React.MouseEvent<HTMLButtonElement>) => {
    // The button intentionally lives inside the tile Link. Both calls are
    // required or a tap starts the mic and navigates at the same time.
    isolateTileMicTap(event);
    if (checkingPermission || recorder.starting || recorder.recording) return;

    setCheckingPermission(true);
    const permission = await microphonePermissionState();
    if (!canRecordOnHub(permission)) {
      setCheckingPermission(false);
      router.push("/assistant?record=1");
      return;
    }

    const started = await recorder.startRecording();
    setCheckingPermission(false);
    if (!started && !recorder.error) router.push("/assistant?record=1");
  };

  const showOverlay = checkingPermission || recorder.starting || recorder.recording || Boolean(recorder.error);
  const overlay = showOverlay && typeof document !== "undefined"
    ? createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-stone-950/55 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Bucky voice recording"
        >
          <div className="w-full max-w-sm border border-stone-300 bg-[#f5efe4] p-5 shadow-2xl">
            {recorder.error ? (
              <>
                <div className="flex items-start gap-3">
                  <Mic size={20} className="mt-0.5 shrink-0 text-red-700" />
                  <p className="text-sm leading-6 text-stone-700">{recorder.error}</p>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button type="button" className="btn-quiet !mt-0" onClick={recorder.clearError}>Close</button>
                  <button type="button" className="btn-ember" onClick={() => router.push("/assistant?record=1")}>Open Bucky</button>
                </div>
              </>
            ) : recorder.recording ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-red-600" />
                  <div>
                    <div className="font-mono text-xs uppercase tracking-[0.18em] text-red-700">
                      Recording {formatRecordingClock(recorder.seconds)}
                    </div>
                    <p className="mt-2 text-sm text-stone-600">Talk naturally. Stop when you are done; the recording will open in Bucky automatically.</p>
                  </div>
                </div>
                {recorder.seconds >= RECORDING_WARN_SECONDS && (
                  <p className="mt-3 text-sm text-amber-800">Wrap up soon so Bucky can listen to the whole recording.</p>
                )}
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button type="button" className="btn-quiet !mt-0 flex items-center justify-center gap-2" onClick={() => recorder.stopRecording(true)}>
                    <X size={14} /> Cancel
                  </button>
                  <button type="button" className="btn-ember flex items-center justify-center gap-2" onClick={() => recorder.stopRecording(false)}>
                    <Square size={13} fill="currentColor" /> Stop
                  </button>
                </div>
              </>
            ) : (
              <div className="py-5 text-center">
                <Loader2 size={26} className="mx-auto animate-spin text-green-800" />
                <p className="mt-3 font-serif text-xl text-stone-800">Opening the microphone&hellip;</p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <Link href={href} className="tile-text tile-lead relative">
        <div className="lbl">Sec. {lbl}</div>
        <div>
          <div className="big"><em>Bucky</em><br />Dragon</div>
          <div
            style={{
              marginTop: 6,
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            {sub}
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => void handleMicTap(event)}
          className={`absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-[#f5efe4] text-green-800 shadow-sm transition-colors hover:bg-white ${checkingPermission || recorder.starting ? "opacity-50" : ""}`}
          aria-label="Record a voice note for Bucky"
          aria-disabled={checkingPermission || recorder.starting}
        >
          {checkingPermission || recorder.starting
            ? <Loader2 size={16} className="animate-spin" />
            : <Mic size={17} />}
        </button>
      </Link>
      {overlay}
    </>
  );
}
