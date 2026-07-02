"use client";

export function PageLoader() {
  return (
    <div className="pixel-shell flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden" role="status" aria-label="Loading">
      <div className="pixel-grid-bg" />
      <div className="pixel-noise" />
      <div className="pixel-loader-card">
        <div className="pixel-loader-logo" aria-hidden="true">N</div>
        <div className="pixel-loader-track" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, index) => (
            <span key={index} style={{ animationDelay: `${index * 55}ms` }} />
          ))}
        </div>
        <span className="pixel-loader-label">LOADING</span>
      </div>
    </div>
  );
}
