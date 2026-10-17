import { catalogService } from "@/lib/supabase/catalogService";
import { parseLicensing, type LibraryLicenseDetail } from "./licensing";
import { fetchAllPages } from "./paging";

type Raw = Record<string, unknown>;

/** On-demand detail/bulk lookup only. Chunk IDs to keep PostgREST URLs short; page every chunk. */
export async function loadLibraryLicensing(catalogIds: string[]): Promise<LibraryLicenseDetail[]> {
  const out: LibraryLicenseDetail[] = [];
  const db = catalogService();
  for (let i = 0; i < catalogIds.length; i += 100) {
    const rows = await fetchAllPages<Raw>(async (from, to) => {
      const { data, error } = await db.from("pack_tracks")
        .select("pack_id,catalog_id,status,status_on,dropbox_path,shared_link,packs!inner(name,licensee,batch_date)")
        .in("catalog_id", catalogIds.slice(i, i + 100))
        .order("pack_id", { ascending: true }).order("catalog_id", { ascending: true }).range(from, to);
      return { data: data as unknown as Raw[] | null, error };
    });
    for (const row of rows) {
      const pack = row.packs && typeof row.packs === "object" && !Array.isArray(row.packs) ? row.packs as Raw : {};
      const batch = parseLicensing([{ ...row, licensee: pack.licensee ?? "Unknown licensee", pack: pack.name, batch_date: pack.batch_date }])[0];
      const packId = Number(row.pack_id);
      if (!batch || !Number.isSafeInteger(packId) || packId < 1 || typeof row.catalog_id !== "string") continue;
      out.push({ ...batch, pack_id: packId, catalog_id: row.catalog_id,
        dropbox_path: typeof row.dropbox_path === "string" ? row.dropbox_path : null,
        shared_link: typeof row.shared_link === "string" ? row.shared_link : null });
    }
  }
  return out.sort((a, b) => (b.batch_date ?? "").localeCompare(a.batch_date ?? "") || b.pack_id - a.pack_id);
}
