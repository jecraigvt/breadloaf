"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Safari records AAC in MP4; keep it first. Chrome and Android use WebM.
export const RECORDING_MIME_TYPES = [
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

export const RECORDING_WARN_SECONDS = 25 * 60;

export function formatRecordingClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function recordingExtension(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

interface VoiceRecorderOptions {
  onComplete: (file: File) => void;
  fileName?: (extension: string) => string;
}

export function useVoiceRecorder(options: VoiceRecorderOptions) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRef = useRef(false);
  const startingRef = useRef(false);
  const onCompleteRef = useRef(options.onComplete);
  const fileNameRef = useRef(options.fileName);

  useEffect(() => {
    onCompleteRef.current = options.onComplete;
    fileNameRef.current = options.fileName;
  }, [options.fileName, options.onComplete]);

  const release = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    startingRef.current = false;
    setStarting(false);
    setRecording(false);
    setSeconds(0);
  }, []);

  const startRecording = useCallback(async (): Promise<boolean> => {
    if (recording || startingRef.current || recorderRef.current) return false;
    startingRef.current = true;
    setStarting(true);
    setError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support audio recording.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = RECORDING_MIME_TYPES.find((type) =>
        MediaRecorder.isTypeSupported(type)
      );
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      discardRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const discarded = discardRef.current;
        const chunks = chunksRef.current;
        const type = recorder.mimeType || "audio/webm";
        release();
        if (discarded || chunks.length === 0) return;

        const extension = recordingExtension(type);
        const name = fileNameRef.current?.(extension) || `Voice memo.${extension}`;
        onCompleteRef.current(new File([new Blob(chunks, { type })], name, { type }));
      };

      recorder.start(1000);
      startingRef.current = false;
      setStarting(false);
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
      return true;
    } catch (recordingError) {
      release();
      setError(
        recordingError instanceof Error
          ? recordingError.message
          : "Could not access the microphone. Check this site's microphone permission."
      );
      return false;
    }
  }, [recording, release]);

  const stopRecording = useCallback((discard = false) => {
    discardRef.current = discard;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else release();
  }, [release]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return {
    recording,
    starting,
    seconds,
    error,
    clearError: () => setError(null),
    startRecording,
    stopRecording,
  };
}
