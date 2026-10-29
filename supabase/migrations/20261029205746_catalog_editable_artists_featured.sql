-- Let catalog.update_track change artists/featured (needed when a Release Schedule rename adds artists).
create or replace function catalog.editable_track_columns()
 returns text[]
 language sql
 immutable
 set search_path to ''
as $function$
  select array['entity','title','sheet_artist','sheet_title','release_date','distributor_account',
               'status','label_genre','originality','exclusivity','comment_1','comment_2',
               'cover_original_artist','new_distro','genre','non_exclusive_samples',
               'artists','featured']
$function$;
