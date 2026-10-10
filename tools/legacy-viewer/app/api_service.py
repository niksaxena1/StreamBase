"""Read-only database service shared by HTTP handlers and integration tests."""
import json
import os
from pathlib import Path
from urllib.parse import unquote

import duckdb

import api_archive as archive
import api_followers as followers
import api_streams as streams
import api_explorer as explorer
from api_art import Art
from api_lookup import Lookup
from api_original import Original
from api_common import APIError, Context, one, rows


class Service:
    def __init__(self, path, art_dir=None):
        self.con=duckdb.connect(str(path),read_only=True)
        self.con.execute('SET threads = '+str(min(4,max(1,os.cpu_count() or 1))))
        self.con.execute("SET memory_limit='512MB'")
        self.meta={k:json.loads(v) for k,v in self.con.execute('select key,value from meta').fetchall()}
        self.playlists=rows(self.con,'select * from playlists order by name nulls last')
        self.scopes=streams.scopes(self.playlists)
        self.bounds={r[0]:(r[1],r[2]) for r in self.con.execute('select dataset,min(day),max(day) from catalog_day group by dataset').fetchall()}
        self.bounds['followers']=self.con.execute('select min(day),max(day) from pf_playlist_day').fetchone()
        self._meta_response=None
        registry = os.environ.get('LEGACY_REGISTRY')
        sidecar = Path(path).parent / 'grafana_registry.json'
        self.original=Original(registry or (sidecar if sidecar.is_file() else None))
        self.lookup=Lookup()
        self.art=Art(self.con,art_dir)
        self.lookup.art=self.art

    def close(self): self.con.close()

    # Panels whose first (cold) load takes several seconds; computed in the background at startup
    # so they are cached before anyone opens them (Tax V2 'Notes' diagnostics, Spotify Dash 'Alert').
    WARM_PANELS = ('stats2.tax-v2.56', 'stats2.tax-v2.59', 'stats2.spotify-dash.117')

    def warm(self):
        cur = self.con.cursor()
        try:
            for panel_id in self.WARM_PANELS:
                try: self.original.panel(cur, {'id': panel_id})
                except Exception: pass  # a failed warm-up only means the first view is slower
        finally:
            cur.close()

    def metadata(self,con):
        if self._meta_response is not None: return self._meta_response
        datasets=[]
        for dataset,label in [('stats2','stats2 complete'),('stats','stats server subset')]:
            stats=one(con,'''select count(distinct isrc) tracks,count(distinct selected_spotify_track_id) selected_ids,sum(observation_count) observations from isrc_day where dataset=?''',[dataset])
            # ISRC selected observations are not the raw row count: use verified metadata.
            profiles=self.meta.get('raw_profiles',{})
            raw=profiles.get('src_tracks' if dataset=='stats2' else 'scratch.old_tracks',{})
            stats['observations']=raw.get('rows',stats['observations'])
            stats['spotify_ids']=con.execute('select count(distinct spotify_track_id) from track_day where dataset=?',[dataset]).fetchone()[0]
            stats['playlists']=con.execute('select count(distinct playlist_id) from playlist_day where dataset=?',[dataset]).fetchone()[0]
            stats.pop('selected_ids')
            datasets.append({'key':dataset,'label':label,'first_day':self.bounds[dataset][0],'last_day':self.bounds[dataset][1],**stats})
        pf=one(con,'select count(*) playlists,count(distinct account_name) accounts,sum(readings) readings from pf_playlists')
        pf.update({'first_day':self.bounds['followers'][0],'last_day':self.bounds['followers'][1]})
        pf['groups']=[r[0] for r in con.execute('select distinct unnest(dashboard_groups) g from pf_playlists order by g').fetchall()]
        self._meta_response={'build':self.meta,'datasets':datasets,'followers':pf,'playlists':self.playlists,'scopes':self.scopes}
        return self._meta_response

    def dispatch(self,con,path,p):
        if path=='/api/original/dashboards': return self.original.list_dashboards()
        if path=='/api/original/variable-options': return self.original.options(con,p)
        if path=='/api/original/panel': return self.original.panel(con,p)
        if path=='/api/original/panel-sql': return self.original.sql(p)
        if path=='/api/raw/observations': return self.original.raw(con,p)
        if path=='/api/raw/follower-readings': return self.original.raw(con,p,True)
        if path=='/api/meta': return self.metadata(con)
        if path=='/api/archive': return archive.archive(con)
        if path=='/api/export': return self.export(con,p)
        ctx=Context(con,p,self.bounds,path.startswith('/api/followers'))
        if path=='/api/lookup/artists': return self.lookup.artists(ctx)
        if path=='/api/lookup/tracks': return self.lookup.tracks(ctx)
        if path=='/api/lookup/between': return self.lookup.between(ctx)
        if path=='/api/lookup/monthly': return self.lookup.monthly(ctx)
        if path=='/api/lookup/days': return self.lookup.days(ctx)
        if path=='/api/lookup/artist-report': return self.lookup.artist_report(ctx)
        if path=='/api/lookup/search': return self.lookup.search(ctx)
        if path=='/api/explorer/playlists': return explorer.playlists(ctx)
        if path.startswith('/api/explorer/playlist/'):
            return self.playlist_art(streams.playlist(ctx,unquote(path[len('/api/explorer/playlist/'):]),explorer.all_scopes(self.scopes,self.playlists)))
        if path=='/api/explorer/overview':
            return explorer.overview(ctx,explorer.all_scopes(self.scopes,self.playlists))
        if path=='/api/explorer/tracks':
            return self.paged_art(streams.tracks(ctx,explorer.all_scopes(self.scopes,self.playlists)))
        if path=='/api/overview': return streams.overview(ctx,self.scopes)
        if path=='/api/tracks': return self.paged_art(streams.tracks(ctx,self.scopes))
        if path=='/api/artists':
            result=streams.artists(ctx,self.scopes)
            return {**result,'rows':self.art.with_artists(result['rows'],'artist')}
        if path.startswith('/api/artist/'):
            name=unquote(path[len('/api/artist/'):])
            result=streams.artist(ctx,name,self.scopes)
            return {**result,'art':self.art.artist(name),'top_tracks':self.art.with_tracks(result['top_tracks']),'tracks':self.art.with_tracks(result['tracks'])}
        if path=='/api/playlists': return {'rows':rows(con,*streams.playlists_query(ctx))}
        if path.startswith('/api/playlist/'): return self.playlist_art(streams.playlist(ctx,unquote(path[len('/api/playlist/'):]),self.scopes))
        if path.startswith('/api/track/'):
            suffix=path[len('/api/track/'):]
            if suffix.endswith('/readings'):
                isrc=unquote(suffix[:-len('/readings')])
                sql,params=streams.readings_query(ctx,isrc)
                return {'rows':rows(con,sql+' limit 5000',params),'limit':5000,'method':'F1 per-id UTC day mode; ties choose higher reading'}
            result=streams.track(ctx,unquote(suffix),self.scopes)
            identity=result['identity']
            identity['art']=self.art.track(identity['isrc'])
            identity['artists']=self.art.credits(identity['artist'])
            return result
        if path=='/api/milestones': return archive.milestones(ctx)
        if path=='/api/quality': return archive.quality(ctx,self.meta)
        if path=='/api/followers/overview': return followers.overview(ctx)
        if path=='/api/followers/playlists': return followers.playlists(ctx)
        if path=='/api/followers/accounts': return {'rows':rows(con,*followers.accounts_query(ctx))}
        if path.startswith('/api/followers/playlist/'): return followers.playlist(ctx,unquote(path[len('/api/followers/playlist/'):]))
        raise APIError('Endpoint not found',404)

    def paged_art(self,result):
        return {**result,'rows':self.art.with_tracks(result['rows'])}

    def playlist_art(self,result):
        return {**result,'tracks':self.art.with_tracks(result['tracks'])}

    def export(self,con,p):
        view=p.get('view','')
        ctx=Context(con,p,self.bounds,view.startswith('followers_'))
        if view in ('lookup_monthly','lookup_daily','artist_report'): return self.lookup.export(ctx,view)
        if view=='archive': return 'select * from archive_inventory order by server,relative_path', []
        if view=='followers_overview': return followers.overview_query(ctx)[:2]
        if view=='followers_accounts': return followers.accounts_query(ctx)
        if view=='explorer_playlists': return explorer.playlists_query(ctx)
        if view=='explorer_tracks': return streams.tracks(ctx,explorer.all_scopes(self.scopes,self.playlists),True)
        if view=='explorer_overview': return streams.overview(ctx,explorer.all_scopes(self.scopes,self.playlists),True)
        if view=='explorer_playlist':
            pp=dict(p); pp['playlist']=required(p,'id')
            return streams.overview(Context(con,pp,self.bounds),explorer.all_scopes(self.scopes,self.playlists),True)
        if view=='tracks': return streams.tracks(ctx,self.scopes,True)
        if view=='track':
            # When day is provided, export the unpaginated readings view; otherwise
            # this is the plotted track series. raw=1 exports all source readings.
            if p.get('day') or p.get('raw')=='1': return streams.readings_query(ctx,required(p,'isrc'),p.get('raw')=='1')
            return streams.track_series(ctx,required(p,'isrc'))
        if view=='track_records': return streams.track_records(ctx,required(p,'isrc'))
        if view=='overview': return streams.overview(ctx,self.scopes,True)
        if view=='artists': return streams.artists(ctx,self.scopes,True)
        if view=='artist': return streams.artist_series(ctx,required(p,'name'))
        if view=='playlists': return streams.playlists_query(ctx)
        if view=='playlist':
            pp=dict(p); pp['playlist']=required(p,'id')
            return streams.overview(Context(con,pp,self.bounds),self.scopes,True)
        if view=='milestones': return archive.milestones(ctx,True)
        if view=='followers_playlists': return followers.playlists(ctx,True)
        if view=='followers_playlist': return followers.playlist_query(ctx,required(p,'id'))
        if view=='quality_resets': return archive.reset_query(ctx)
        raise APIError('Invalid export view')


def required(p,key):
    value=p.get(key) or (p.get('playlist') if key=='id' else p.get('artist') if key=='name' else None)
    if not value: raise APIError(key+' is required')
    return value
