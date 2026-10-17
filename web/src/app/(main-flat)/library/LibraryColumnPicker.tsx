"use client";

import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DEFAULT_HIDDEN_COLUMNS, LIBRARY_TABLE_COLUMNS, type LibraryColumnId } from "@/lib/library/columns";
import { LibraryToolbarPopover } from "./LibraryToolbarPopover";

export function LibraryColumnPicker({ hidden, onChange }: { hidden: LibraryColumnId[]; onChange: (ids: LibraryColumnId[]) => void }) {
  return (
    <LibraryToolbarPopover label="Columns" trigger={<span className="flex items-center gap-1"><Columns3 className="h-3.5 w-3.5" aria-hidden="true" />Columns</span>}>
      {() => (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {LIBRARY_TABLE_COLUMNS.filter((c) => !c.pinned).map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="accent-[var(--sb-accent)]" checked={!hidden.includes(c.id)} onChange={() => onChange(hidden.includes(c.id) ? hidden.filter((id) => id !== c.id) : [...hidden, c.id])} />
              {c.label}
            </label>
          ))}
          <Button variant="ghost" size="xs" onClick={() => onChange([...DEFAULT_HIDDEN_COLUMNS])}>Reset</Button>
        </div>
      )}
    </LibraryToolbarPopover>
  );
}
