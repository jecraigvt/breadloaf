"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileImage, FileText } from "lucide-react";

interface FileDropzoneProps {
  onFile: (file: File) => void;
  // When provided, multi-select is enabled and 2+ files go here instead
  onFiles?: (files: File[]) => void;
}

export function FileDropzone({ onFile, onFiles }: FileDropzoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      if (acceptedFiles.length > 1 && onFiles) {
        onFiles(acceptedFiles);
      } else {
        onFile(acceptedFiles[0]);
      }
    },
    [onFile, onFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
      "image/heic": [".heic"],
      "application/pdf": [".pdf"],
      "application/msword": [".doc"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.oasis.opendocument.text": [".odt"],
      "application/vnd.oasis.opendocument.spreadsheet": [".ods"],
      "application/vnd.oasis.opendocument.presentation": [".odp"],
      "text/plain": [".txt"],
      "text/csv": [".csv"],
      "audio/mpeg": [".mp3"],
      "audio/wav": [".wav"],
      "audio/mp4": [".m4a"],
      "audio/x-m4a": [".m4a"],
      "video/mp4": [".mp4"],
      "video/quicktime": [".mov"],
      "video/webm": [".webm"],
    },
    maxSize: 100 * 1024 * 1024,
    multiple: Boolean(onFiles),
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
        isDragActive
          ? "border-green-500 bg-green-50"
          : "border-stone-300 hover:border-green-400 hover:bg-stone-50"
      }`}
    >
      <input {...getInputProps()} />
      <Upload
        size={32}
        className={`mx-auto mb-3 ${
          isDragActive ? "text-green-600" : "text-stone-400"
        }`}
      />
      <p className="text-stone-600 font-medium">
        {isDragActive
          ? onFiles ? "Drop files here" : "Drop file here"
          : onFiles ? "Tap to choose files" : "Tap to choose a file"}
      </p>
      <p className="text-stone-400 text-sm mt-1">
        {onFiles ? "or drag and drop — multiple files welcome" : "or drag and drop"}
      </p>
      <div className="flex items-center justify-center gap-4 mt-3 text-xs text-stone-400">
        <span className="flex items-center gap-1">
          <FileImage size={14} /> Images
        </span>
        <span className="flex items-center gap-1">
          <FileText size={14} /> PDF, Word, Excel, Audio, Video
        </span>
        <span>Max 100MB</span>
      </div>
    </div>
  );
}
