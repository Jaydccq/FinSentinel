const base = 'animate-pulse rounded';
const skeletonBg = 'bg-[#161618]';

export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`${base} ${skeletonBg} h-4 ${className}`} />;
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return <div className={`${base} ${skeletonBg} rounded h-28 ${className}`} />;
}

export function SkeletonCircle({
  size = 14,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`${base} ${skeletonBg} rounded-full flex-shrink-0 ${className}`}
      style={{ width: size * 4, height: size * 4 }}
    />
  );
}

/* --- Page-specific skeleton layouts --- */

export function DocumentListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="bg-[var(--bg-panel)] rounded border border-[var(--border-subtle)] border-l-[3px] border-l-[var(--border-strong)] px-5 py-3.5 flex items-center gap-4"
        >
          <div className={`${base} ${skeletonBg} h-4 w-4 rounded`} />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="w-2/3" />
            <SkeletonLine className="w-1/3 h-3" />
          </div>
          <div className={`${base} ${skeletonBg} h-5 w-20 rounded`} />
        </div>
      ))}
    </div>
  );
}

export function PortfolioListSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="surface-panel rounded px-4 py-4 md:px-5 flex items-center gap-3">
          <div className={`${base} ${skeletonBg} h-8 w-8 rounded`} />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="w-1/3" />
            <SkeletonLine className="w-1/4 h-3" />
          </div>
          <div className={`${base} ${skeletonBg} h-6 w-24 rounded`} />
        </div>
      ))}
    </div>
  );
}

export function WatchlistSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="surface-panel rounded p-4 space-y-3">
          <div className="flex items-center justify-between">
            <SkeletonLine className="w-14 h-4" />
            <div className={`${base} ${skeletonBg} h-5 w-16 rounded`} />
          </div>
          <SkeletonLine className="w-20 h-6" />
          <SkeletonLine className="w-16 h-3" />
        </div>
      ))}
    </div>
  );
}

export function ReportListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-[var(--bg-panel)] rounded border border-[var(--border-subtle)] border-l-[3px] border-l-[var(--border-strong)] p-5 flex items-center gap-5"
        >
          <SkeletonCircle size={14} />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div className={`${base} ${skeletonBg} h-4 w-4 rounded`} />
              <div className={`${base} ${skeletonBg} h-5 w-16 rounded`} />
            </div>
            <SkeletonLine className="w-3/4" />
            <SkeletonLine className="w-1/4 h-3" />
          </div>
          <div className={`${base} ${skeletonBg} h-9 w-16 rounded`} />
        </div>
      ))}
    </div>
  );
}

export function NewsListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="surface-panel rounded p-4 md:p-5">
          <div className="flex items-start gap-3">
            <div className="hidden sm:block min-w-14">
              <SkeletonLine className="w-10 h-3" />
            </div>
            <div className="flex-1 space-y-2.5">
              <div className="flex items-center gap-2">
                <div className={`${base} ${skeletonBg} h-5 w-16 rounded`} />
                <SkeletonLine className="w-2/3" />
              </div>
              <SkeletonLine className="w-full" />
              <SkeletonLine className="w-4/5" />
              <div className="flex items-center gap-2 mt-1">
                <div className={`${base} ${skeletonBg} h-5 w-12 rounded`} />
                <div className={`${base} ${skeletonBg} h-5 w-12 rounded`} />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="surface-panel rounded p-5 md:p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <SkeletonLine className="w-20 h-3" />
              <SkeletonLine className="w-28 h-7" />
            </div>
            <div className={`${base} ${skeletonBg} h-10 w-10 rounded`} />
          </div>
          <SkeletonLine className="h-1.5 w-full rounded" />
        </div>
      ))}
    </div>
  );
}
