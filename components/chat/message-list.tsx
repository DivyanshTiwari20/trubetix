"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/types";
import { useChat } from "./chat-provider";
import { ChatMessageItem } from "./chat-message";
import { LoadingMessage } from "./loading-message";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const { isGenerating, regenerate } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isGenerating]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      {messages.map((message, index) => {
        const isLast = index === messages.length - 1;
        const canRegenerate = message.role === "assistant" && isLast && !isGenerating;
        return (
          <ChatMessageItem
            key={message.id}
            message={message}
            canRegenerate={canRegenerate}
            onRegenerate={() => void regenerate(message.id)}
          />
        );
      })}
      {isGenerating ? <LoadingMessage /> : null}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}
