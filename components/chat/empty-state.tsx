import { TubitexMark } from "@/components/brand/tubitex-logo";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/config";
import { ExamplePrompts } from "./example-prompts";

export function EmptyState({ onSelectPrompt }: { onSelectPrompt: (prompt: string) => void }) {
  return (
    <div className="flex w-full max-w-2xl flex-col items-center text-center">
      <TubitexMark className="size-11 rounded-xl" />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Welcome to {APP_NAME}
      </h1>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
        {APP_DESCRIPTION}
      </p>
      <p className="mt-6 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Try one of these
      </p>
      <div className="mt-3 w-full">
        <ExamplePrompts onSelect={onSelectPrompt} />
      </div>
    </div>
  );
}
