#!/usr/bin/env python3

with open("src/app/(main)/collectors/page.tsx", "r", encoding="utf-8") as f:
    lines = f.readlines()

# Find and replace lines 87-97 (the if (!selectedCollector) block)
new_lines = [
    '  if (!selectedCollector) {\n',
    '    // Fetch latest data to find the collector with highest streams\n',
    '    const { data: latestRowForDefault } = await cachedQueries(\n',
    '      {\n',
    '        latest: async () =>\n',
    '          await svc\n',
    '            .from("playlist_daily_stats")\n',
    '            .select("date")\n',
    '            .order("date", { ascending: false })\n',
    '            .limit(1)\n',
    '            .maybeSingle(),\n',
    '      },\n',
    '      "collectors-latest-for-default",\n',
    '      600,\n',
    '    ).then((r) => r.latest);\n',
    '\n',
    '    const latestRunDateForDefault = (latestRowForDefault as { date: string } | null)?.date ?? null;\n',
    '\n',
    '    if (latestRunDateForDefault) {\n',
    '      const { data: compareRowsForDefault } = await cachedQuery(\n',
    '        async () =>\n',
    '          await svc\n',
    '            .from("collector_daily_compare")\n',
    '            .select("collector,daily_streams_net")\n',
    '            .eq("date", latestRunDateForDefault),\n',
    '        `collectors-compare-for-default-${latestRunDateForDefault}`,\n',
    '        600,\n',
    '      );\n',
    '\n',
    '      const rows = (compareRowsForDefault ?? []) as Array<{ collector: string; daily_streams_net: number }>;\n',
    '      if (rows.length > 0) {\n',
    '        // Find collector with highest streams\n',
    '        const highestCollector = rows.reduce((max, current) => {\n',
    '          const currentStreams = Number(current.daily_streams_net ?? 0);\n',
    '          const maxStreams = Number(max.daily_streams_net ?? 0);\n',
    '          return currentStreams > maxStreams ? current : max;\n',
    '        });\n',
    '\n',
    '        const defaultCollector = String(highestCollector.collector ?? "").toUpperCase();\n',
    '        if ((COLLECTORS as readonly string[]).includes(defaultCollector)) {\n',
    '          return (\n',
    '            <RememberParamRedirect\n',
    '              param="collector"\n',
    '              storageKey="sb:last_collector"\n',
    '              defaultValue={defaultCollector}\n',
    '              loadingTitle="Opening collector with highest streams…"\n',
    '              loadingSubtitle="Redirecting to your default collector."\n',
    '            />\n',
    '          );\n',
    '        }\n',
    '      }\n',
    '    }\n',
    '\n',
    '    // Fallback to RememberParamRedirect with default "A"\n',
    '    return (\n',
    '      <RememberParamRedirect\n',
    '        param="collector"\n',
    '        storageKey="sb:last_collector"\n',
    '        defaultValue="A"\n',
    '        loadingTitle="Opening your last collector…"\n',
    '        loadingSubtitle="If this is your first time, we\'ll start with A."\n',
    '      />\n',
    '    );\n',
    '  }\n',
]

# Replace lines 87-97 (indices 86-96 in 0-based)
lines = lines[:86] + new_lines + lines[97:]

with open("src/app/(main)/collectors/page.tsx", "w", encoding="utf-8") as f:
    f.writelines(lines)

print("Updated collector selection by line replacement")
