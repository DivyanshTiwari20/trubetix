"use client";

import { MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { TubitexLogo } from "@/components/brand/tubitex-logo";
import { useChat } from "@/components/chat/chat-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { groupConversations } from "@/lib/chat/reducer";
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
  const [showArchived, setShowArchived] = useState(false);

  const groups = useMemo(
    () => (hydrated ? groupConversations(state.conversations, { query, showArchived }) : []),
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
            <Button variant="default" size="icon" onClick={handleNew} aria-label="New chat">
              <MessageSquarePlus className="size-4" />
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
      <div className="flex items-center justify-between px-3 py-3">
        <TubitexLogo />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapsed}
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="size-4" />
        </Button>
      </div>

      <div className="px-3 pb-2">
        <Button className="w-full justify-start gap-2" onClick={handleNew}>
          <MessageSquarePlus className="size-4" />
          New chat
        </Button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className={cn("h-8 pl-8 text-sm", query ? "pr-7" : "")}
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

      <ScrollArea className="flex-1">
        <nav aria-label="Conversation history" className="space-y-3 px-3 pb-3">
          {groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {query
                ? "No conversations match your search."
                : showArchived
                  ? "No archived conversations."
                  : "No conversations yet. Start a new chat."}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.group}>
                <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {group.group}
                </p>
                <div className="space-y-0.5">
                  {group.conversations.map((conversation) => (
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
                  ))}
                </div>
              </div>
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
