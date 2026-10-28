"use client";

import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChatMessage } from "@/types";
import { useChat } from "./chat-provider";

export function CopyButton({
  text,
  ariaLabel = "Copy message",
}: {
  text: string;
  ariaLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={ariaLabel} onClick={handleCopy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
    </Tooltip>
  );
}

export interface MessageActionsProps {
  message: ChatMessage;
  canRegenerate: boolean;
  onRegenerate: () => void;
}

export function MessageActions({ message, canRegenerate, onRegenerate }: MessageActionsProps) {
  const { setFeedback } = useChat();

  return (
    <div className="flex items-center gap-0.5">
      <CopyButton text={message.content} ariaLabel="Copy response" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Regenerate response"
            disabled={!canRegenerate}
            onClick={onRegenerate}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Regenerate</TooltipContent>
      </Tooltip>
      <span className="mx-1 h-4 w-px bg-border" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={message.feedback === "up" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="Mark response as helpful"
            aria-pressed={message.feedback === "up"}
            onClick={() => setFeedback(message.id, message.feedback === "up" ? null : "up")}
          >
            <ThumbsUp className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Helpful</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={message.feedback === "down" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="Mark response as not helpful"
            aria-pressed={message.feedback === "down"}
            onClick={() => setFeedback(message.id, message.feedback === "down" ? null : "down")}
          >
            <ThumbsDown className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Not helpful</TooltipContent>
      </Tooltip>
    </div>
  );
}
