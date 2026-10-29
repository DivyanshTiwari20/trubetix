"use client";

import { CheckCircle2, Info, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

interface HealthIntegration {
  gemini: { configured: boolean; model: string };
  serpapi: { configured: boolean };
  newsapi: { configured: boolean };
  apify?: { configured: boolean };
}

interface HealthResponse {
  status: "ok" | "degraded";
  integrations: HealthIntegration;
  limits: {
    maxQueries: number;
    maxResultsPerQuery: number;
    maxEvidence: number;
    timeoutMs: number;
  };
}

function StatusRow({
  label,
  detail,
  configured,
}: {
  label: string;
  detail: string;
  configured: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <Badge variant={configured ? "success" : "warning"}>
        {configured ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
        {configured ? "Configured" : "Not configured"}
      </Badge>
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/health")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("bad status"))))
      .then((data: HealthResponse) => {
        if (!cancelled) setHealth(data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load configuration status.");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Integration status and research configuration for this workspace.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !health ? (
          <p className="text-sm text-muted-foreground">Loading configuration…</p>
        ) : (
          <div className="space-y-1">
            <StatusRow
              label="AI analysis"
              detail={health.integrations.gemini.configured ? "Analysis enabled" : "Analysis key missing"}
              configured={health.integrations.gemini.configured}
            />
            <StatusRow
              label="Live search"
              detail={health.integrations.serpapi.configured ? "Search enabled" : "Search key missing"}
              configured={health.integrations.serpapi.configured}
            />
            <StatusRow
              label="News search"
              detail={health.integrations.newsapi.configured ? "News search enabled" : "Optional — news key missing"}
              configured={health.integrations.newsapi.configured}
            />
            <StatusRow
              label="Deep search"
              detail={health.integrations.apify?.configured
                ? "Deep search enabled"
                : "Deep search key missing"}
              configured={health.integrations.apify?.configured ?? false}
            />
            <Separator className="my-3" />
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <p>
                Conversations are stored in this browser only. Research limits:{" "}
                {health.limits.maxQueries} queries, {health.limits.maxResultsPerQuery} results per
                query, {health.limits.maxEvidence} evidence items.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
