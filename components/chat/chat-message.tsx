"use client";

import type { ChatMessage } from "@/types";
import { AssistantMessage } from "./assistant-message";
import { CopyButton } from "./message-actions";

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
        <div className="group flex max-w-[85%] flex-col items-end gap-1">
          <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
            {message.content}
          </div>
          <div className="hidden group-focus-within:block group-hover:block">
            <CopyButton text={message.content} ariaLabel="Copy message" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <AssistantMessage
        message={message}
        canRegenerate={canRegenerate}
        onRegenerate={onRegenerate}
      />
    </div>
  );
}
