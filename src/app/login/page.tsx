"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mountain, Loader2 } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const [pin, setPin] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [family, setFamily] = useState("");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Check if already authenticated
  useEffect(() => {
    fetch("/api/auth")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          router.replace(searchParams.get("from") || "/");
        }
      })
      .catch(() => {});
  }, [router, searchParams]);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newPin = [...pin];
    newPin[index] = value.slice(-1);
    setPin(newPin);
    setError("");

    // Auto-advance to next input
    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 4 digits entered
    if (value && index === 3) {
      const fullPin = newPin.join("");
      if (fullPin.length === 4) {
        submitPin(fullPin);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (pasted.length === 4) {
      setPin(pasted.split(""));
      submitPin(pasted);
    }
  };

  const submitPin = async (fullPin: string) => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: fullPin }),
      });

      const data = await res.json();

      if (res.ok) {
        setFamily(data.family);
        // Set username in localStorage
        localStorage.setItem("breadloaf-username", data.family);
        // Brief pause to show welcome, then redirect
        setTimeout(() => {
          router.replace(searchParams.get("from") || "/");
        }, 800);
      } else {
        setError("Invalid PIN");
        setPin(["", "", "", ""]);
        inputRefs.current[0]?.focus();
      }
    } catch {
      setError("Something went wrong");
      setPin(["", "", "", ""]);
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center">
      {/* Background */}
      <img
        src="/photos/hilltop-view.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Login card */}
      <div className="relative z-10 w-full max-w-sm mx-4">
        <div className="bg-white/95 backdrop-blur rounded-2xl shadow-2xl p-8 text-center">
          {/* Logo */}
          <div className="w-16 h-16 rounded-2xl bg-green-700 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Mountain size={32} className="text-white" />
          </div>

          <h1 className="text-2xl font-bold text-stone-800 mb-1">
            Breadloaf Hill
          </h1>
          <p className="text-stone-500 text-sm mb-8">
            Enter your family PIN to continue
          </p>

          {/* Success state */}
          {family ? (
            <div className="py-4">
              <p className="text-green-700 font-semibold text-lg">
                Welcome, {family}!
              </p>
              <Loader2
                size={20}
                className="animate-spin text-green-600 mx-auto mt-3"
              />
            </div>
          ) : (
            <>
              {/* PIN inputs */}
              <div className="flex gap-3 justify-center mb-6">
                {pin.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    onPaste={i === 0 ? handlePaste : undefined}
                    className={`w-14 h-16 text-center text-2xl font-bold rounded-xl border-2 focus:outline-none transition-all ${
                      error
                        ? "border-red-300 bg-red-50 text-red-700 animate-shake"
                        : "border-stone-200 bg-stone-50 text-stone-800 focus:border-green-500 focus:ring-2 focus:ring-green-200"
                    }`}
                    autoFocus={i === 0}
                    disabled={loading}
                  />
                ))}
              </div>

              {/* Error */}
              {error && (
                <p className="text-red-500 text-sm mb-4 font-medium">
                  {error}
                </p>
              )}

              {/* Loading */}
              {loading && (
                <Loader2
                  size={24}
                  className="animate-spin text-green-600 mx-auto mb-4"
                />
              )}
            </>
          )}

          <p className="text-stone-400 text-xs mt-6">
            Craig Family Property &middot; Ripton, VT
          </p>
        </div>
      </div>
    </div>
  );
}
