"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { fetchApiJson } from "@/lib/api";
import { pathAfterDatasetModeSwitch } from "@/lib/datasetModeNavigation";
import { invalidateUserSettingsBundle } from "@/lib/userSettingsBundleFetch";
import { isForeignUniverseMessage, settingsRequireUniverseRefresh, UNIVERSE_CHANNEL, UNIVERSE_STORAGE_KEY, type Universe } from "./universeSyncEvents";

export function UniverseSync(props: Universe) {
  const router = useRouter();
  const current = useRef(props);
  current.current = props;
  useEffect(() => {
    let disposed = false;
    let checking = false;
    const refresh = () => {
      invalidateUserSettingsBundle();
      const clean = pathAfterDatasetModeSwitch(window.location.pathname, window.location.search);
      if (clean && clean !== window.location.pathname + window.location.search) window.history.replaceState(null, "", clean);
      router.refresh();
    };
    const check = async () => {
      if (document.visibilityState !== "visible" || checking) return;
      checking = true;
      try {
        const settings = await fetchApiJson<unknown>("/api/user-settings/all", { cache: "no-store" });
        if (!disposed && settingsRequireUniverseRefresh(current.current, settings)) refresh();
      } catch { /* Retry on the next visible event; an offline tab keeps its current content. */ }
      finally { checking = false; }
    };
    const storage = (event: StorageEvent) => { if (event.key === UNIVERSE_STORAGE_KEY && event.newValue) refresh(); };
    let channel: BroadcastChannel | undefined;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(UNIVERSE_CHANNEL);
        channel.onmessage = (event) => { if (isForeignUniverseMessage(event.data)) refresh(); };
      }
    } catch { /* Storage events still work when channels are blocked. */ }
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", check);
    return () => {
      disposed = true;
      channel?.close();
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);
  return null;
}
