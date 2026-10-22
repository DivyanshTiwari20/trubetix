import { useEffect, useState } from "react";
import { TubitexMark } from "@/components/brand/tubitex-logo";
import { Skeleton } from "@/components/ui/skeleton";

export function LoadingMessage() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex gap-3" role="status" aria-live="polite">
      <TubitexMark className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            Researching sources and preparing a briefing…
          </p>
          <span className="text-xs text-muted-foreground/70 font-mono">
            {elapsedSeconds}s
          </span>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      </div>
    </div>
  );
}
