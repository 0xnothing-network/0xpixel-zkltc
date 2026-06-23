"use client";

export function PageLoader() {
  return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col items-center justify-center gap-4">
      <div className="grid grid-cols-2 gap-1 w-12 h-12">
        <div className="bg-indigo-500 animate-pulse" style={{ animationDelay: "0ms" }} />
        <div className="bg-indigo-500 animate-pulse" style={{ animationDelay: "200ms" }} />
        <div className="bg-indigo-500 animate-pulse" style={{ animationDelay: "400ms" }} />
        <div className="bg-indigo-500 animate-pulse" style={{ animationDelay: "600ms" }} />
      </div>
      <span
        className="text-[#94A3B8] animate-pulse"
        style={{ fontFamily: "var(--font-departure), monospace", fontSize: "10px", fontWeight: 700, letterSpacing: "0.3em" }}
      >
        LOADING
      </span>
    </div>
  );
}
