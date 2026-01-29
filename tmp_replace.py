from pathlib import Path
path = Path('web/src/app/(main)/catalog/CatalogPageClient.tsx')
data = path.read_text()
old = 'Latest snapshot:{ }'
if old not in data:
    raise SystemExit('old not found')
data = data.replace(old, 'Latest data date:{ }', 1)
path.write_text(data)
