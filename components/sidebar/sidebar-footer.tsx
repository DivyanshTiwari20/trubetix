"use client";

import { Archive, ChevronUp, Settings, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface SidebarFooterProps {
  collapsed?: boolean;
  showArchived: boolean;
  archivedCount: number;
  onToggleArchived: () => void;
  onOpenSettings: () => void;
  onRequestClearAll: () => void;
}

function AccountMenu({
  onOpenSettings,
  onRequestClearAll,
  children,
}: {
  onOpenSettings: () => void;
  onRequestClearAll: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-[13rem]">
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        <div className="px-2 pb-1 text-xs text-muted-foreground">Local browser storage</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onRequestClearAll}>
          <Trash2 /> Clear all conversations
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SidebarFooter({
  collapsed = false,
  showArchived,
  archivedCount,
  onToggleArchived,
  onOpenSettings,
  onRequestClearAll,
}: SidebarFooterProps) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-sidebar-border pt-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleArchived}
              aria-label={showArchived ? "Show active conversations" : "Show archived conversations"}
              aria-pressed={showArchived}
            >
              <Archive className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {showArchived ? "Show active" : "Show archived"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="Settings">
              <Settings className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
        <ThemeToggle />
        <AccountMenu onOpenSettings={onOpenSettings} onRequestClearAll={onRequestClearAll}>
          <Button variant="ghost" size="icon" aria-label="Account menu">
            <Avatar>
              <AvatarFallback>PR</AvatarFallback>
            </Avatar>
          </Button>
        </AccountMenu>
      </div>
    );
  }

  return (
    <div className="space-y-1 border-t border-sidebar-border p-2">
      <Button
        variant={showArchived ? "secondary" : "ghost"}
        className="w-full justify-start"
        onClick={onToggleArchived}
        aria-pressed={showArchived}
      >
        <Archive className="size-4" />
        {showArchived ? "Show active" : "Show archived"}
        {archivedCount > 0 ? (
          <span className="ml-auto rounded-full bg-secondary px-1.5 text-xs text-muted-foreground">
            {archivedCount}
          </span>
        ) : null}
      </Button>
      <div className="flex items-center gap-1">
        <AccountMenu onOpenSettings={onOpenSettings} onRequestClearAll={onRequestClearAll}>
          <Button variant="ghost" className={cn("h-10 flex-1 justify-start gap-2 px-2")}>
            <Avatar>
              <AvatarFallback>PR</AvatarFallback>
            </Avatar>
            <span className="flex flex-col items-start leading-tight">
              <span className="text-sm font-medium">Local workspace</span>
              <span className="text-xs text-muted-foreground">This browser</span>
            </span>
            <ChevronUp className="ml-auto size-4 text-muted-foreground" />
          </Button>
        </AccountMenu>
        <ThemeToggle />
      </div>
    </div>
  );
}
