"use client";

import { PanelLeft, PanelLeftOpen, Search, SquarePen, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useChat } from "@/components/chat/chat-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { matchesQuery } from "@/lib/chat/reducer";
import { APP_NAME } from "@/lib/config";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types";
import { ConversationItem } from "./conversation-item";
import { SidebarFooter } from "./sidebar-footer";

export interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate?: () => void;
  onOpenSettings: () => void;
  onRequestDeleteConversation: (conversation: Conversation) => void;
  onRequestClearAll: () => void;
}

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  onNavigate,
  onOpenSettings,
  onRequestDeleteConversation,
  onRequestClearAll,
}: AppSidebarProps) {
  const {
    state,
    hydrated,
    newConversation,
    selectConversation,
    renameConversation,
    togglePin,
    toggleArchive,
  } = useChat();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const conversations = useMemo(
    () =>
      hydrated
        ? state.conversations.filter(
            (conversation) =>
              showArchived === conversation.archived && matchesQuery(conversation, query),
          )
        : [],
    [hydrated, state.conversations, query, showArchived],
  );

  const archivedCount = useMemo(
    () => state.conversations.filter((conversation) => conversation.archived).length,
    [state.conversations],
  );

  const handleNew = () => {
    newConversation();
    onNavigate?.();
  };

  const handleSelect = (id: string) => {
    selectConversation(id);
    onNavigate?.();
  };

  const toggleSearch = () => {
    if (searchOpen) {
      setSearchOpen(false);
      setQuery("");
    } else {
      setSearchOpen(true);
    }
  };

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-1 p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleCollapsed}
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand sidebar</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="secondary" size="icon" onClick={handleNew} aria-label="New chat">
              <SquarePen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">New chat</TooltipContent>
        </Tooltip>
        <Separator className="my-1" />
        <ScrollArea className="w-full flex-1">
          <div className="flex flex-col items-center gap-1 py-1">
            {state.conversations
              .filter((conversation) => showArchived === conversation.archived)
              .slice(0, 12)
              .map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  collapsed
                  isActive={conversation.id === state.activeId}
                  onSelect={() => handleSelect(conversation.id)}
                  onRename={(title) => renameConversation(conversation.id, title)}
                  onTogglePin={() => togglePin(conversation.id)}
                  onToggleArchive={() => toggleArchive(conversation.id)}
                  onDelete={() => onRequestDeleteConversation(conversation)}
                />
              ))}
          </div>
        </ScrollArea>
        <SidebarFooter
          collapsed
          showArchived={showArchived}
          archivedCount={archivedCount}
          onToggleArchived={() => setShowArchived((value) => !value)}
          onOpenSettings={onOpenSettings}
          onRequestClearAll={onRequestClearAll}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <span className="min-w-0 truncate text-xl font-semibold tracking-tight">{APP_NAME}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleSearch}
                aria-label={searchOpen ? "Hide search" : "Search conversations"}
                aria-pressed={searchOpen}
                className="text-muted-foreground hover:text-foreground"
              >
                <Search className="size-[1.15rem]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{searchOpen ? "Hide search" : "Search"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onToggleCollapsed}
                aria-label="Collapse sidebar"
                className="text-muted-foreground hover:text-foreground"
              >
                <PanelLeft className="size-[1.15rem]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Collapse sidebar</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {searchOpen ? (
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className={cn("h-9 rounded-lg pl-8 text-sm", query ? "pr-7" : "")}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="px-3 pb-3">
        <Button
          variant="secondary"
          className="h-10 w-full justify-start gap-2.5 rounded-[10px] px-3 font-medium"
          onClick={handleNew}
        >
          <SquarePen className="size-[1.15rem]" />
          New chat
        </Button>
      </div>

      <div className="border-t border-sidebar-border" />

      <ScrollArea className="flex-1">
        <nav
          aria-label="Conversation history"
          className="flex min-w-0 flex-col gap-0.5 overflow-hidden px-2 py-2"
        >
          {conversations.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {query
                ? "No conversations match your search."
                : showArchived
                  ? "No archived conversations."
                  : "No conversations yet. Start a new chat."}
            </p>
          ) : (
            conversations.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isActive={conversation.id === state.activeId}
                onSelect={() => handleSelect(conversation.id)}
                onRename={(title) => renameConversation(conversation.id, title)}
                onTogglePin={() => togglePin(conversation.id)}
                onToggleArchive={() => toggleArchive(conversation.id)}
                onDelete={() => onRequestDeleteConversation(conversation)}
              />
            ))
          )}
        </nav>
      </ScrollArea>

      <SidebarFooter
        showArchived={showArchived}
        archivedCount={archivedCount}
        onToggleArchived={() => setShowArchived((value) => !value)}
        onOpenSettings={onOpenSettings}
        onRequestClearAll={onRequestClearAll}
      />
    </div>
  );
}
