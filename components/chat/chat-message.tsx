"use client";

import { TubitexMark } from "@/components/brand/tubitex-logo";
import type { ChatMessage } from "@/types";
import { AssistantMessage } from "./assistant-message";

export interface ChatMessageItemProps {
  message: ChatMessage;
  canRegenerate: boolean;
  onRegenerate: () => void;
}

export function ChatMessageItem({
  message,
  canRegenerate,
  onRegenerate,
}: ChatMessageItemProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <TubitexMark className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <AssistantMessage
          message={message}
          canRegenerate={canRegenerate}
          onRegenerate={onRegenerate}
        />
      </div>
    </div>
  );
}
