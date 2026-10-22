import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { RiskClaim, SourcedClaim } from "@/types";

type EvidenceKind = "reported" | "interpretation" | "recommendation";

const KIND_LABELS: Record<EvidenceKind, string> = {
  reported: "Reported",
  interpretation: "Interpretation",
  recommendation: "Recommendation",
};

const KIND_VARIANTS: Record<EvidenceKind, "default" | "secondary" | "outline"> = {
  reported: "default",
  interpretation: "secondary",
  recommendation: "outline",
};

export function EvidenceBadge({ kind }: { kind: EvidenceKind }) {
  return (
    <Badge variant={KIND_VARIANTS[kind]} title={`This section is ${KIND_LABELS[kind].toLowerCase()}`}>
      {KIND_LABELS[kind]}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: RiskClaim["severity"] }) {
  const variant = severity === "high" ? "destructive" : severity === "medium" ? "warning" : "secondary";
  return <Badge variant={variant}>{severity} risk</Badge>;
}

export function ConfidenceBadge({ confidence }: { confidence: "low" | "medium" | "high" }) {
  const variant = confidence === "high" ? "success" : confidence === "medium" ? "secondary" : "warning";
  return <Badge variant={variant}>{confidence} confidence</Badge>;
}

export function AnalysisSection({
  title,
  kind,
  children,
}: {
  title: string;
  kind?: EvidenceKind;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {kind ? <EvidenceBadge kind={kind} /> : null}
      </div>
      {children}
    </section>
  );
}

function SourceChips({ indices }: { indices: number[] }) {
  if (indices.length === 0) {
    return <span className="text-xs italic text-muted-foreground">No linked source</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {indices.map((index) => (
        <a
          key={index}
          href={`#source-${index}`}
          className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-secondary px-1 text-[10px] font-medium text-secondary-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
          aria-label={`Source ${index}`}
        >
          {index}
        </a>
      ))}
    </span>
  );
}

export function ClaimList({ claims }: { claims: (SourcedClaim | RiskClaim)[] }) {
  return (
    <ul className="space-y-3">
      {claims.map((claim, index) => (
        <li key={`${claim.title}-${index}`} className="flex gap-2">
          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{claim.title}</p>
              {"severity" in claim ? <SeverityBadge severity={claim.severity} /> : null}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{claim.detail}</p>
            <SourceChips indices={claim.sourceIndices} />
          </div>
        </li>
      ))}
    </ul>
  );
}
