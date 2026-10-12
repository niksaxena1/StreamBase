import { Library } from "lucide-react";

import { SectionEmptyState } from "@/components/ui/DataStates";

export function LibraryNotConnected({ envVars }: { envVars: readonly string[] }) {
  return (
    <SectionEmptyState
      title="Library isn't connected"
      icon={<Library className="h-5 w-5" />}
      description="Set these environment variables for the app, then redeploy."
      action={
        <ul className="space-y-1 text-xs">
          {envVars.map((name) => (
            <li key={name}>
              <code
                className="rounded-md px-1.5 py-0.5 font-mono"
                style={{ background: "var(--sb-code-bg)", color: "var(--sb-text)" }}
              >
                {name}
              </code>
            </li>
          ))}
        </ul>
      }
    />
  );
}
