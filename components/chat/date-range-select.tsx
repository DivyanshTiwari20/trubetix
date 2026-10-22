"use client";

import { CalendarRange, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DATE_RANGE_PRESETS } from "@/lib/config";
import type { DatePreset } from "@/types";

export function DateRangeSelect({
  value,
  onChange,
  disabled,
}: {
  value: DatePreset;
  onChange: (value: DatePreset) => void;
  disabled?: boolean;
}) {
  const current =
    DATE_RANGE_PRESETS.find((preset) => preset.value === value) ?? DATE_RANGE_PRESETS[1];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="gap-1.5 text-muted-foreground"
          aria-label="Research time window"
        >
          <CalendarRange className="size-3.5" />
          {current.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Time window</DropdownMenuLabel>
        {DATE_RANGE_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.value}
            onSelect={() => onChange(preset.value as DatePreset)}
          >
            {preset.label}
            {value === preset.value ? <Check className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
