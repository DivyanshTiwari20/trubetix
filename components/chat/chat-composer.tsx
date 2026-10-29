"use client";

import { ArrowUp, Ban, BrainCircuit, Check, Search } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS } from "@/lib/config";
import { cn } from "@/lib/utils";
import { useChat } from "./chat-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateRangeSelect } from "./date-range-select";

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

export function ChatComposer({ value, onChange, inputRef }: ChatComposerProps) {
  const {
    sendMessage,
    isGenerating,
    stopGeneration,
    datePreset,
    setDatePreset,
    searchMode,
    setSearchMode,
  } = useChat();
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? internalRef;

  const canSend = value.trim().length > 0 && !isGenerating;

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [value, textareaRef]);

  const submit = () => {
    const text = value.trim();
    if (!text || isGenerating) return;
    onChange("");
    void sendMessage(text);
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={cn(
        "rounded-2xl border border-border bg-card p-2 shadow-sm transition-colors focus-within:border-ring",
        isGenerating && "border-primary/40",
      )}
      aria-busy={isGenerating}
    >
      <label htmlFor="tubitex-composer" className="sr-only">
        Ask Tubitex a research question
      </label>
      <Textarea
        id="tubitex-composer"
        ref={textareaRef}
        value={value}
        rows={1}
        maxLength={LIMITS.questionMaxLength}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Ask about a client, topic, or competitor…"
        className="max-h-[200px] min-h-[44px] resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:outline-none"
      />
      <div className="flex items-center justify-between gap-2 px-1 pb-0.5 pt-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <DateRangeSelect value={datePreset} onChange={setDatePreset} disabled={isGenerating} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isGenerating}
                className="gap-1.5 text-muted-foreground"
                aria-label={`Search mode: ${searchMode === "deep" ? "Deep thinking with Apify" : "Google dorking with SerpAPI"}`}
              >
                {searchMode === "deep" ? <BrainCircuit className="size-3.5" /> : <Search className="size-3.5" />}
                {searchMode === "deep" ? "Deep thinking" : "Google"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Instagram search mode</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setSearchMode("google")}>
                Google dorking · SerpAPI
                {searchMode === "google" ? <Check className="ml-auto size-4" /> : null}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSearchMode("deep")}>
                Deep thinking · Apify
                {searchMode === "deep" ? <Check className="ml-auto size-4" /> : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-2">
          {isGenerating ? (
            <Button type="button" variant="outline" size="sm" onClick={stopGeneration}>
              <Ban className="size-3.5" />
              Stop
            </Button>
          ) : null}
          <Button type="submit" size="icon" disabled={!canSend} aria-label="Send message">
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {isGenerating ? "Research in progress. Use Stop to cancel." : ""}
      </p>
      <p className="px-2 pb-0.5 text-[11px] text-muted-foreground">
        Enter to send · Shift + Enter for a new line
      </p>
    </form>
  );
}
