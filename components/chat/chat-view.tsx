"use client";

import { useRef, useState } from "react";
import { ChatComposer } from "./chat-composer";
import { useChat } from "./chat-provider";
import { EmptyState } from "./empty-state";
import { MessageList } from "./message-list";

export function ChatView() {
  const { activeConversation } = useChat();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const messages = activeConversation?.messages ?? [];
  const isEmpty = messages.length === 0;

  const handleSelectPrompt = (prompt: string) => {
    setDraft(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (isEmpty) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-8">
        <EmptyState onSelectPrompt={handleSelectPrompt} />
        <div className="mt-6 w-full max-w-[42rem]">
          <ChatComposer value={draft} onChange={setDraft} inputRef={inputRef} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <MessageList messages={messages} />
      </div>
      <div className="border-t border-border bg-background/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto w-full max-w-[42rem]">
          <ChatComposer value={draft} onChange={setDraft} inputRef={inputRef} />
        </div>
      </div>
    </div>
  );
}
