"use client";

import { Menu, PanelRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { ChatProvider, useChat } from "@/components/chat/chat-provider";
import { ChatView } from "@/components/chat/chat-view";
import { TubitexMark } from "@/components/brand/tubitex-logo";
import { ResearchPanel } from "@/components/research/research-meta";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STORAGE_KEYS } from "@/lib/config";
import { useStoredBoolean } from "@/lib/hooks/use-stored-state";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types";

interface ConfirmState {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  action: () => void;
}

const EMPTY_CONFIRM: ConfirmState = {
  open: false,
  title: "",
  description: "",
  confirmLabel: "Confirm",
  action: () => {},
};

function Shell() {
  const { activeConversation, deleteConversation, clearAll, newConversation } = useChat();
  const [collapsed, setCollapsed] = useStoredBoolean(STORAGE_KEYS.sidebarCollapsed, false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(EMPTY_CONFIRM);

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
  };

  const meta = useMemo(() => {
    const messages = activeConversation?.messages ?? [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate?.meta) return candidate.meta;
    }
    return null;
  }, [activeConversation]);

  const requestDelete = (conversation: Conversation) => {
    setConfirm({
      open: true,
      title: "Delete conversation",
      description: `"${conversation.title}" and its messages will be permanently removed from this browser.`,
      confirmLabel: "Delete",
      action: () => deleteConversation(conversation.id),
    });
  };

  const requestClearAll = () => {
    setConfirm({
      open: true,
      title: "Clear all conversations",
      description:
        "Every conversation stored in this browser will be permanently removed. This cannot be undone.",
      confirmLabel: "Clear all",
      action: () => clearAll(),
    });
  };

  const sidebarProps = {
    onToggleCollapsed: toggleCollapsed,
    onOpenSettings: () => setSettingsOpen(true),
    onRequestDeleteConversation: requestDelete,
    onRequestClearAll: requestClearAll,
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <aside
        className={cn(
          "hidden shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] md:flex",
          collapsed ? "w-16" : "w-[15.5rem]",
        )}
      >
        <div className="w-full">
          <AppSidebar collapsed={collapsed} {...sidebarProps} />
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0">
          <SheetTitle className="sr-only">Conversation navigation</SheetTitle>
          <AppSidebar
            collapsed={false}
            {...sidebarProps}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="size-5" />
            </Button>
            <TubitexMark className="md:hidden size-6 rounded-md" />
            <h1 className="truncate text-sm font-medium">
              {activeConversation?.title ?? "New research"}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setPanelOpen(true)}
                  aria-label="Open research context"
                >
                  <PanelRight className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Research context</TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              onClick={() => newConversation()}
              aria-label="New chat"
            >
              <Plus className="size-4" />
            </Button>
            <ThemeToggle className="md:hidden" />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <ChatView />
        </div>
      </div>

      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="right" className="w-[88%] max-w-sm bg-background">
          <SheetTitle className="sr-only">Research context</SheetTitle>
          <div className="h-full overflow-y-auto pt-2">
            <ResearchPanel meta={meta} />
          </div>
        </SheetContent>
      </Sheet>

      <SettingsDialog
        key={settingsOpen ? "settings-open" : "settings-closed"}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
      <ConfirmDialog
        open={confirm.open}
        onOpenChange={(open) => setConfirm((current) => ({ ...current, open }))}
        title={confirm.title}
        description={confirm.description}
        confirmLabel={confirm.confirmLabel}
        destructive
        onConfirm={confirm.action}
      />
    </div>
  );
}

export function AppShell() {
  return (
    <ChatProvider>
      <Shell />
    </ChatProvider>
  );
}
