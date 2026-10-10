export const pages = [
  {
    route: "lookup",
    title: "Track lookup",
    icon: "⌕",
    description: "Compare two UTC stream readings for one track.",
  },
  {
    route: "overview",
    title: "Overview",
    icon: "◫",
    description:
      "Explore the archive’s streams, observations and coverage over time.",
  },
  {
    route: "tracks",
    title: "Tracks",
    icon: "♫",
    description:
      "Inspect track history by stable ISRC identity, including gaps and counter resets.",
  },
  {
    route: "artists",
    title: "Artists",
    icon: "♙",
    description:
      "Explore the artists represented in the restored stream observations.",
  },
  {
    route: "playlists",
    title: "Playlists",
    icon: "☷",
    description:
      "Explore archived playlist membership and daily stream totals.",
  },
  {
    route: "milestones",
    title: "Milestones",
    icon: "⚑",
    description:
      "Browse recorded track milestones and their original observations.",
  },
  {
    route: "tax",
    title: "Tax",
    icon: "▦",
    description:
      "Review archived monthly calculations and the original revenue assumptions.",
  },
  {
    route: "followers",
    title: "Followers",
    icon: "♧",
    description:
      "Inspect archived playlist follower readings and collection coverage.",
  },
  {
    route: "original",
    title: "Original dashboards",
    icon: "▥",
    description:
      "Explore the original Grafana panel definitions and faithful archive calculations.",
  },
  {
    route: "quality",
    title: "Data quality",
    icon: "◇",
    description:
      "Review missing observations, confidence, identity matches and counter resets.",
  },
  {
    route: "archive",
    title: "Archive",
    icon: "▤",
    description:
      "Inspect source provenance, archive bounds and validation metadata.",
  },
] as const;
