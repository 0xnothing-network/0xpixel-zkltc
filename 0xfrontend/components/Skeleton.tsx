export function NFTCardSkeleton() {
  return (
    <div className="bg-[#1A1A2E] rounded-xl overflow-hidden border border-[#2D2D44]">
      <div className="aspect-square bg-[#0F0F23] p-4 flex items-center justify-center">
        <div className="w-16 h-16 bg-[#2D2D44] rounded-lg animate-pulse" />
      </div>
      <div className="p-4 space-y-3">
        <div className="h-5 bg-[#2D2D44] rounded animate-pulse w-3/4" />
        <div className="h-4 bg-[#2D2D44] rounded animate-pulse w-1/2" />
        <div className="h-3 bg-[#2D2D44] rounded animate-pulse w-full" />
        <div className="pt-2 border-t border-[#2D2D44] space-y-2">
          <div className="h-9 bg-[#2D2D44] rounded-lg animate-pulse" />
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
