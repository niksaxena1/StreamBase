export function foldForSearch(input: string): string {
  // Make search forgiving:
  // - case-insensitive
  // - ignores diacritics (e.g. é -> e)
  // - folds some common "special letters" that don't decompose (e.g. ø -> o)
  // - ignores a few punctuation marks commonly typed/omitted
  const s = (input ?? "").toLowerCase();

  // NFD removes most accents into combining marks which we then strip.
  // Note: some letters (e.g. ø, ß, æ) don't decompose; handle via explicit folds below.
  const noDiacritics = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  return noDiacritics
    .replace(/[’'"]/g, "") // quotes/apostrophes
    .replace(/[._\-–—/\\()\\[\\]{}]/g, " ") // common punctuation to spaces
    .replace(/\s+/g, " ")
    .replace(/ø/g, "o")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/đ/g, "d")
    .replace(/ð/g, "d")
    .replace(/þ/g, "th")
    .replace(/ł/g, "l")
    .trim();
}

