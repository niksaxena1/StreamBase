"""Package a small per-panel proof summary, without runtime PostgreSQL dependencies."""
import argparse
from collections import Counter
import json
from pathlib import Path


def summarize(registry, validation):
    result = {p['id']: {'cases_run': 0, 'cases_passed': 0, 'outcomes': {}, 'notes': []}
              for p in registry['panels']}
    for target in validation['panels']:
        summary = result[target['panel']]
        counts = Counter(summary['outcomes']) + Counter(target['counts'])
        summary['outcomes'] = dict(counts)
        summary['cases_run'] = sum(counts.values())
        summary['cases_passed'] = sum(n for k, n in counts.items() if k.startswith('pass'))
        summary['notes'] = sorted(set(summary['notes'] + target.get('notes', [])))
    for summary in result.values():
        if not summary['cases_run']:
            summary['notes'].append('No SQL cases: structural/text panel or excluded datasource.')
        if summary['outcomes'].get('pass_both_error'):
            summary['notes'].append('Error parity: some original variable values or queries fail in both engines.')
    return result


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--validation', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=root/'app/panel_validation_summary.json')
    args = parser.parse_args()
    data = summarize(json.loads((root/'app/grafana_registry.json').read_text(encoding='utf-8')),
                     json.loads(args.validation.read_text(encoding='utf-8')))
    text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    if len(text.encode('utf-8')) >= 300_000:
        raise ValueError('Summary exceeds the package size budget')
    args.output.write_text(text + '\n', encoding='utf-8')
    print(f'{len(data)} panels, {len(text.encode("utf-8"))} bytes: {args.output}')
