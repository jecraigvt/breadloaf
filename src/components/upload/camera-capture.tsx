"use client";

import { useRef, useState, useCallback } from "react";
import { Camera, RotateCcw, Check } from "lucide-react";

interface CameraCaptureProps {
  onCapture: (file: File) => void;
}

export function CameraCapture({ onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setIsStreaming(true);
        };
      }
    } catch {
      setError("Camera access denied. Use the file picker below instead.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImage(dataUrl);
    stopCamera();
  }, [stopCamera]);

  const retake = useCallback(() => {
    setCapturedImage(null);
    startCamera();
  }, [startCamera]);

  const confirm = useCallback(() => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], `scan-${Date.now()}.jpg`, {
            type: "image/jpeg",
          });
          onCapture(file);
        }
      },
      "image/jpeg",
      0.9
    );
  }, [onCapture]);

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {!isStreaming && !capturedImage && (
        <button
          onClick={startCamera}
          className="w-full flex items-center justify-center gap-3 bg-green-700 text-white py-4 rounded-xl text-lg font-medium hover:bg-green-800 transition-colors"
        >
          <Camera size={24} />
          Open Camera
        </button>
      )}

      {isStreaming && (
        <div className="relative rounded-xl overflow-hidden bg-black camera-overlay">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full"
          />
          <div className="absolute bottom-4 left-0 right-0 flex justify-center">
            <button
              onClick={capture}
              className="w-16 h-16 rounded-full bg-white border-4 border-green-700 shadow-lg active:scale-95 transition-transform"
            />
          </div>
        </div>
      )}

      {capturedImage && (
        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden">
            <img src={capturedImage} alt="Captured" className="w-full" />
          </div>
          <div className="flex gap-3">
            <button
              onClick={retake}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-stone-300 text-stone-600 font-medium hover:bg-stone-50"
            >
              <RotateCcw size={18} />
              Retake
            </button>
            <button
              onClick={confirm}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-green-700 text-white font-medium hover:bg-green-800"
            >
              <Check size={18} />
              Use Photo
            </button>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
