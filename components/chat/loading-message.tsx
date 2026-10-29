import { useEffect, useState } from "react";
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
    <div className="min-w-0 space-y-3" role="status" aria-live="polite">
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
  );
}
