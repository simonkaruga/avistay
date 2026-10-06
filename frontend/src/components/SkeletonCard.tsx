export default function SkeletonCard() {
  return (
    <div className="rounded-2xl overflow-hidden bg-white shadow-xs animate-pulse">
      {/* photo placeholder matching 4:3 ratio */}
      <div className="relative bg-(--bg-overlay)" style={{ aspectRatio: "4/3" }}>
        <div className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-(--border)" />
      </div>
      {/* info skeleton */}
      <div className="p-3 space-y-2">
        <div className="h-3 bg-(--bg-overlay) rounded-full w-2/3" />
        <div className="h-4 bg-(--bg-overlay) rounded-full w-4/5" />
        <div className="flex justify-between pt-0.5">
          <div className="h-3 bg-(--bg-overlay) rounded-full w-1/4" />
          <div className="h-3 bg-(--bg-overlay) rounded-full w-1/3" />
        </div>
      </div>
    </div>
  );
}
