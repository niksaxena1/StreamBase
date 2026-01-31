#!/usr/bin/env python3

with open("src/app/(main)/collectors/page.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# Find the section we need to replace - the if (!selectedCollector) block
old_block = '''  if (!selectedCollector) {
    return (
      <RememberParamRedirect
        param="collector"
        storageKey="sb:last_collector"
        defaultValue="A"
        loadingTitle="Opening your last collector…"
        loadingSubtitle="If this is your first time, we'll start with A."
      />
    );
  }'''

new_block = '''  if (!selectedCollector) {
    // Fetch latest data to find the collector with highest streams
    const { data: latestRowForDefault } = await cachedQueries(
      {
        latest: async () =>
          await svc
            .from("playlist_daily_stats")
            .select("date")
            .order("date", { ascending: false })
            .limit(1)
            .maybeSingle(),
      },
      "collectors-latest-for-default",
      600,
    ).then((r) => r.latest);

    const latestRunDateForDefault = (latestRowForDefault as { date: string } | null)?.date ?? null;

    if (latestRunDateForDefault) {
      const { data: compareRowsForDefault } = await cachedQuery(
        async () =>
          await svc
            .from("collector_daily_compare")
            .select("collector,daily_streams_net")
            .eq("date", latestRunDateForDefault),
        `collectors-compare-for-default-${latestRunDateForDefault}`,
        600,
      );

      const rows = (compareRowsForDefault ?? []) as Array<{ collector: string; daily_streams_net: number }>;
      if (rows.length > 0) {
        // Find collector with highest streams
        const highestCollector = rows.reduce((max, current) => {
          const currentStreams = Number(current.daily_streams_net ?? 0);
          const maxStreams = Number(max.daily_streams_net ?? 0);
          return currentStreams > maxStreams ? current : max;
        });

        const defaultCollector = String(highestCollector.collector ?? "").toUpperCase();
        if ((COLLECTORS as readonly string[]).includes(defaultCollector)) {
          return (
            <RememberParamRedirect
              param="collector"
              storageKey="sb:last_collector"
              defaultValue={defaultCollector}
              loadingTitle="Opening collector with highest streams…"
              loadingSubtitle="Redirecting to your default collector."
            />
          );
        }
      }
    }

    // Fallback to RememberParamRedirect with default "A"
    return (
      <RememberParamRedirect
        param="collector"
        storageKey="sb:last_collector"
        defaultValue="A"
        loadingTitle="Opening your last collector…"
        loadingSubtitle="If this is your first time, we'll start with A."
      />
    );
  }'''

content = content.replace(old_block, new_block)

with open("src/app/(main)/collectors/page.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("Updated default collector selection logic")
