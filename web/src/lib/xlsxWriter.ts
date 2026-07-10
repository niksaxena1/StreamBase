import { utils, writeFileXLSX } from "xlsx";

// Keep the browser export surface write-only so Webpack can discard SheetJS readers.
export const xlsxWriter = { utils, writeFile: writeFileXLSX };
