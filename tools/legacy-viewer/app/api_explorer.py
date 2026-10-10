"""Small read-only supplements required by the Explorer UI."""
from api_common import rows
import api_streams as streams


def all_scopes(available, playlists):
    known = {s['key'] for s in available}
    return available + [{'key': p['playlist_id'], 'label': p['playlist_id'],
                         'playlist_ids': [p['playlist_id']]} for p in playlists
                        if p['playlist_id'] not in known]


def playlists_query(ctx):
    base, params = streams.playlists_query(ctx)
    return '''with cards as (''' + base + '''), history as (
      select playlist_id,arg_max(total_track_mode,day) latest,
      arg_max(total_track_mode,day) filter(where day<?) baseline,
      arg_min(total_track_mode,day) filter(where day>=?) first_in_range
      from playlist_day d where d.dataset=? and d.day<=? group by playlist_id),
      membership as (select playlist_id,count(distinct spotify_track_id) observed_tracks
        from playlist_track_day where dataset=? and day between ? and ? group by playlist_id)
      select c.*,h.latest-coalesce(h.baseline,h.first_in_range) gained,
      m.observed_tracks from cards c join history h using(playlist_id)
      left join membership m using(playlist_id)
      order by total desc nulls last''', [*params, ctx.start, ctx.start, ctx.dataset,
                                        ctx.end, ctx.dataset, ctx.start, ctx.end]


def playlists(ctx):
    return {'rows': rows(ctx.con, *playlists_query(ctx))}


def overview(ctx, available):
    result = streams.overview(ctx, available)
    if streams.scope_ids(ctx, available) is not None:
        members = rows(ctx.con, *streams.track_query(ctx, available))
        result['kpis'].update({
            'tracks': len(members),
            'artists': len({a.strip() for r in members for a in r['artist'].split(',') if a.strip()}),
            'resets': sum(r['resets'] or 0 for r in members),
        })
        result['notes'].append('Tracks/artists/resets describe member ISRCs observed in this scope; counters and changes use playlist F2.')
    return result
