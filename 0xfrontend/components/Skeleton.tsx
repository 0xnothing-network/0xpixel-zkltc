export function NFTCardSkeleton() {
  return (
    <div className="pixel-panel overflow-hidden">
      <div className="flex aspect-square items-center justify-center border-b border-white/[0.08] bg-[#07070d] p-4">
        <div className="grid h-20 w-20 grid-cols-4 gap-1" aria-hidden="true">
          {Array.from({ length: 16 }).map((_, index) => (
            <span key={index} className="skeleton-pixel" style={{ animationDelay: `${index * 35}ms` }} />
          ))}
        </div>
      </div>
      <div className="p-4 space-y-3">
        <div className="h-4 w-3/4 skeleton-pixel" />
        <div className="h-3 w-1/2 skeleton-pixel" />
        <div className="h-3 w-full skeleton-pixel" />
        <div className="space-y-2 border-t border-white/[0.08] pt-2">
          <div className="h-9 skeleton-pixel" />
        </div>
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6" style={{ fontFamily: "var(--font-departure)" }}>
      {Array.from({ length: count }).map((_, i) => (
        <NFTCardSkeleton key={i} />
      ))}
    </div>
  );
}
