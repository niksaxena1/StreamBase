from pathlib import Path
text = Path('web/src/app/(main)/catalog/CatalogPageClient.tsx').read_text()
start = text.index('Latest snapshot')
print(repr(text[start-20:start+60]))
