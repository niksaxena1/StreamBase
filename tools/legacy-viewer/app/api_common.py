"""Shared parameter validation and UTC calendar semantics (stdlib + DuckDB)."""
import csv
import datetime as dt
import decimal
import io
import json


class APIError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def json_default(value):
    if isinstance(value, (dt.date, dt.datetime)): return value.isoformat()
    if isinstance(value, decimal.Decimal): return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(type(value).__name__)


def rows(con, sql, params=()):
    result = con.execute(sql, params)
    names = [d[0] for d in result.description]
    return [dict(zip(names, row)) for row in result.fetchall()]


def one(con, sql, params=()):
    result = rows(con, sql, params)
    return result[0] if result else None


def date(value):
    try: return dt.date.fromisoformat(str(value))
    except (ValueError, TypeError): raise APIError('Dates must be YYYY-MM-DD') from None


def integer(p, key, default, low=0, high=5000):
    try: value = int(p.get(key, default))
    except (ValueError, TypeError): raise APIError(key + ' must be an integer') from None
    if not low <= value <= high: raise APIError(key + ' out of range')
    return value


def order(p, allowed, default):
    key = p.get('sort', default)
    if key not in allowed: raise APIError('Invalid sort column')
    direction = p.get('dir', 'desc').lower()
    if direction not in ('asc', 'desc'): raise APIError('Invalid sort direction')
    return key + ' ' + direction + ' nulls last'


def norm(column):
    # NFKD/strip_accents does not decompose Scandinavian stroked letters.
    return "replace(replace(strip_accents(lower(coalesce(" + column + ",''))), 'ø','o'), 'ł','l')"


def search(column):
    return 'contains(' + norm(column) + ', ' + norm('?') + ')'


class Context:
    def __init__(self, con, p, bounds, followers=False):
        self.con, self.p = con, p
        self.dataset = p.get('dataset', 'stats2')
        if self.dataset not in ('stats2', 'stats'): raise APIError('Invalid dataset')
        self.grain = p.get('grain', 'day')
        if self.grain not in ('day', 'week', 'month'): raise APIError('Invalid grain')
        start, end = bounds['followers' if followers else self.dataset]
        self.start, self.end = date(p.get('from', start)), date(p.get('to', end))
        if self.start > self.end: raise APIError('from must be on or before to')
        if (self.end - self.start).days > 20000: raise APIError('Date range too large')
        self.days = (self.end - self.start).days + 1

    def page(self, sql, params, allowed, default, export=False):
        sort = order(self.p, allowed, default)
        if export: return sql + ' order by ' + sort, params
        total = self.con.execute('select count(*) from (' + sql + ') t', params).fetchone()[0]
        query = sql + ' order by ' + sort + ' limit ? offset ?'
        result = rows(self.con, query, [*params, integer(self.p, 'limit', 100, 1), integer(self.p, 'offset', 0, 0, 10000000)])
        return {'total': total, 'rows': result}


def bucket_sql(daily_sql, grain, cumulative, summed=(), extra=(), ma_column=None):
    """Input: one row/day. LAST non-null counters, SUM non-null deltas.

    Bound clipping is applied by the caller AFTER MA7, which includes up to six
    days before the requested range. Calendar RANGE prevents a gap becoming 7 rows.
    """
    bucket = "cast(date_trunc('" + grain + "', day) as date)"
    fields = [bucket + ' as bucket']
    for field in cumulative:
        fields.extend([f'arg_max({field},day) as {field}', f'max(day) filter(where {field} is not null) as {field}_day'])
    fields += [f'sum({field}) as {field}' for field in summed]
    fields += list(extra)
    data_column = ma_column or next(iter(cumulative))
    fields += [f'count({data_column}) as days_with_data', f'count(*)-count({data_column}) as days_missing']
    counter = next(iter(cumulative))
    if ma_column:
        fields += [f'count({counter}) as counter_days_with_data', f'count(*)-count({counter}) as counter_days_missing']
    if ma_column and grain == 'day': fields += ['max(ma7) as ma7']
    else: fields += ['null::double as ma7']
    return 'select ' + ','.join(fields) + ' from (' + daily_sql + ') daily group by 1 order by 1'


def with_calendar(sql, ctx, ma_column=None):
    """Densify UTC days, retain NULLs, and calculate MA7 before range clipping."""
    ma = 'null::double as ma7'
    if ma_column:
        ma = f'case when count({ma_column}) over w >= 4 then avg({ma_column}) over w end as ma7'
    return ('with input as (' + sql + '), calendar as (select cast(day as date) as day from generate_series(?::date, ?::date, interval 1 day) s(day)), '
            'dense as (select calendar.day, input.* exclude(day) from calendar left join input using(day)), '
            'moving as (select *, ' + ma + ' from dense window w as (order by day range between interval 6 day preceding and current row)) '
            'select * from moving where day >= ?'), [ctx.start - dt.timedelta(days=6), ctx.end, ctx.start]


def csv_chunks(con, sql, params=(), batch=256):
    """No fetchall: bounded Python memory even for multi-million-row exports."""
    result = con.execute(sql, params)
    buf = io.StringIO(newline='')
    writer = csv.writer(buf)
    yield b'\xef\xbb\xbf'
    writer.writerow([d[0] for d in result.description])
    yield buf.getvalue().encode('utf-8')
    buf.seek(0); buf.truncate(0)
    while True:
        chunk = result.fetchmany(batch)
        if not chunk: break
        for row in chunk:
            writer.writerow([json.dumps(v, default=json_default, ensure_ascii=False, separators=(',', ':')) if isinstance(v, (dict, list)) else v for v in row])
        yield buf.getvalue().encode('utf-8')
        buf.seek(0); buf.truncate(0)
