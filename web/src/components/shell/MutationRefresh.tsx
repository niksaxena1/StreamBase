"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { invalidateUserSettingsBundle } from "@/lib/userSettingsBundleFetch";
import { ROUTER_MUTATION_EVENT } from "./pageMutationEvents";

/** Clears cached RSC destinations after successful API saves, including settings. */
export function MutationRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      invalidateUserSettingsBundle();
      router.refresh();
    };
    window.addEventListener(ROUTER_MUTATION_EVENT, refresh);
    return () => window.removeEventListener(ROUTER_MUTATION_EVENT, refresh);
  }, [router]);
  return null;
}
