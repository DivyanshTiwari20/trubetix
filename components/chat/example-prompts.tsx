"use client";

import { ArrowUpRight } from "lucide-react";
import { EXAMPLE_PROMPTS } from "@/lib/config";

export function ExamplePrompts({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="grid w-full gap-2 sm:grid-cols-2">
      {EXAMPLE_PROMPTS.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => onSelect(prompt)}
          className="group flex items-start justify-between gap-2 rounded-xl border border-border bg-card p-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
        >
          <span>{prompt}</span>
          <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
        </button>
      ))}
    </div>
  );
}
