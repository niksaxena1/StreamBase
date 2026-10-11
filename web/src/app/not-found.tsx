import Link from "@/components/shell/RouteLink";
import { Button } from "@/components/ui/Button";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <div className="sb-card flex flex-col items-center gap-4 p-8 text-center max-w-sm">
        <h1 className="font-semibold" style={{ color: "var(--sb-text)" }}>
          404 — Page not found
        </h1>
        <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
          The page you are looking for could not be found.
        </p>
        <Button asChild variant="primary" size="sm">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
