"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/lib/toast";

export function PurgeCacheButton({
  purgeAction,
}: {
  purgeAction: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await purgeAction();
      showToast("Vercel Data Cache purged", "success");
    } catch {
      showToast("Failed to purge cache", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      loading={loading}
      onClick={handleClick}
    >
      Purge Vercel Data Cache
    </Button>
  );
}
