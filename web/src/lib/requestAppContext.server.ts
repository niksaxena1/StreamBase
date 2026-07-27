import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { normalizeAppAccess, type AppAccess, type AppAccessRow } from "@/lib/appAccess";
import {
  buildCompetitorShellContext,
  loadCompetitorLabelsWithImages,
  type CompetitorLabelWithImage,
  type CompetitorShellContext,
} from "@/lib/competitorContext.server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export type RequestUserSettingsRow = {
  dataset_mode?: unknown;
  competitor_label_key?: unknown;
  hide_stale_override_annotations?: unknown;
  hide_stale_annotations_exclude_catalog?: unknown;
  artificial_streams_spike_ratio?: unknown;
  artificial_streams_include_weekends_user?: unknown;
} | null;

export type RequestAppContext = {
  sb: Awaited<ReturnType<typeof supabaseServer>>;
  svc: ReturnType<typeof supabaseService>;
  user: User | null;
  isAdmin: boolean;
  appAccess: AppAccess;
  settings: RequestUserSettingsRow;
  shellContext: CompetitorShellContext;
};

export function buildRequestShellContext(args: {
  appAccess: AppAccess;
  settings: RequestUserSettingsRow;
  competitorLabels: CompetitorLabelWithImage[];
}): CompetitorShellContext {
  return buildCompetitorShellContext({
    canUseCompetitor: args.appAccess.competitor,
    datasetMode: args.settings?.dataset_mode,
    savedCompetitorLabelKey: args.settings?.competitor_label_key,
    competitorLabels: args.competitorLabels,
  });
}

export const getRequestAppContext = cache(async (): Promise<RequestAppContext> => {
  const sb = await supabaseServer();
  const svc = supabaseService();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    const appAccess = normalizeAppAccess(null, false);
    return {
      sb,
      svc,
      user: null,
      isAdmin: false,
      appAccess,
      settings: null,
      shellContext: buildRequestShellContext({
        appAccess,
        settings: null,
        competitorLabels: [],
      }),
    };
  }

  const [adminResult, accessResult, settingsResult] = await Promise.all([
    sb.rpc("is_admin"),
    svc
      .from("app_user_access")
      .select("own_catalog,competitor,playlist_watch,playlist_watch_admin")
      .eq("user_id", user.id)
      .maybeSingle(),
    svc
      .from("user_settings")
      .select(
        "dataset_mode,competitor_label_key,hide_stale_override_annotations,hide_stale_annotations_exclude_catalog,artificial_streams_spike_ratio,artificial_streams_include_weekends_user",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const isAdmin = Boolean(adminResult.data);
  const appAccess = normalizeAppAccess(accessResult.data as AppAccessRow, isAdmin);
  const settings = (settingsResult.data ?? null) as RequestUserSettingsRow;
  const competitorLabels = appAccess.competitor ? await loadCompetitorLabelsWithImages() : [];

  return {
    sb,
    svc,
    user,
    isAdmin,
    appAccess,
    settings,
    shellContext: buildRequestShellContext({
      appAccess,
      settings,
      competitorLabels,
    }),
  };
});
