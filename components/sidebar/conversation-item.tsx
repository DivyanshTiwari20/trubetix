"use client";

import {
  Archive,
  ArchiveRestore,
  Download,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types";

export interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

const MAX_TITLE_WORDS = 5;

function shortTitle(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length <= MAX_TITLE_WORDS) return title.trim();
  return `${words.slice(0, MAX_TITLE_WORDS).join(" ")}…`;
}

function fileName(title: string): string {
  const safe = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return safe || "conversation";
}

function toMarkdown(conversation: Conversation): string {
  const lines = [`# ${conversation.title}`, ""];
  for (const message of conversation.messages) {
    lines.push(`## ${message.role === "user" ? "You" : "Tubitex"}`, "");
    lines.push(message.content.trim(), "");
    if (message.sources.length > 0) {
      lines.push("Sources:", "");
      for (const source of message.sources) {
        lines.push(`- [${source.title}](${source.originalUrl || source.canonicalUrl})`);
      }
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onTogglePin,
  onToggleArchive,
  onDelete,
}: ConversationItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);

  const startEditing = () => {
    setDraft(conversation.title);
    setEditing(true);
  };

  const commit = () => {
    const next = draft.trim();
    if (next && next !== conversation.title) onRename(next);
    setEditing(false);
  };

  const download = () => {
    const blob = new Blob([toMarkdown(conversation)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName(conversation.title)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  if (editing) {
    return (
      <form
        className="px-1"
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
      >
        <Input
          autoFocus
          value={draft}
          aria-label="Conversation title"
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
            }
          }}
          className="h-8 text-sm"
        />
      </form>
    );
  }

  return (
    <div
      className={cn(
        "group/item flex min-w-0 items-center gap-1 overflow-hidden rounded-lg pr-1 transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/60",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={isActive ? "page" : undefined}
        title={conversation.title}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[0.9375rem] focus-visible:outline-none"
      >
        {conversation.pinned ? (
          <Pin className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{shortTitle(conversation.title)}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${conversation.title}`}
            className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/item:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={startEditing}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onTogglePin}>
            {conversation.pinned ? <PinOff /> : <Pin />}
            {conversation.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleArchive}>
            {conversation.archived ? <ArchiveRestore /> : <Archive />}
            {conversation.archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={download}>
            <Download /> Download chat
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
