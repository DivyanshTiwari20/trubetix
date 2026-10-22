import { Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/config";

export function TubitexMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm",
        className,
      )}
      aria-hidden="true"
    >
      <Radar className="size-4" />
    </span>
  );
}

export function TubitexLogo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <TubitexMark />
      <span className="text-sm font-semibold tracking-tight">{APP_NAME}</span>
    </span>
  );
}
