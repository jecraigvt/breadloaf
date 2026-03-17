"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileImage, FileText } from "lucide-react";

interface FileDropzoneProps {
  onFile: (file: File) => void;
}

export function FileDropzone({ onFile }: FileDropzoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFile(acceptedFiles[0]);
      }
    },
    [onFile]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
      "image/heic": [".heic"],
      "application/pdf": [".pdf"],
    },
    maxSize: 20 * 1024 * 1024,
    multiple: false,
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
        {isDragActive ? "Drop file here" : "Tap to choose a file"}
      </p>
      <p className="text-stone-400 text-sm mt-1">or drag and drop</p>
      <div className="flex items-center justify-center gap-4 mt-3 text-xs text-stone-400">
        <span className="flex items-center gap-1">
          <FileImage size={14} /> Images
        </span>
        <span className="flex items-center gap-1">
          <FileText size={14} /> PDFs
        </span>
        <span>Max 20MB</span>
      </div>
    </div>
  );
}
