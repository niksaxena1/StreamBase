import { Alert } from "@/components/ui/Alert";
import { cachedSpotifyMarketAvailability } from "@/lib/health/spotifyMarketAvailability";
import { scanStaleness } from "@/lib/health/spotifyMarketFormat";

/**
 * Health warning (shared Alert, above the warnings list) when the nightly territory scan has not
 * succeeded for over 36 hours. Reads the same cached snapshot as the Territories section, so it adds
 * no query. Renders nothing while the scan is current, never ran, or the data is unavailable.
 */
export async function TerritoryScanAlert() {
  const { data } = await cachedSpotifyMarketAvailability();
  const { message } = scanStaleness(data?.lastCheckedAt);
  if (!message) return null;
  return (
    <Alert variant="error" title="Territory scan is overdue">
      {message}{" "}
      <a href="#territories" className="underline">
        Territories
      </a>
    </Alert>
  );
}
