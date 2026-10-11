import importlib.util
import pathlib
import sys

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_competitor_only_missing_filters_unenriched_rows():
    m = _load("enrich_competitor_tracks_with_spotify")
    assert "spotify_artist_ids=is.null" in m.candidate_filters(50, only_missing=True)
    assert "spotify_artist_ids=is.null" not in m.candidate_filters(50)


class _RecordingPg:
    def __init__(self):
        self.filters = None

    def select(self, table, select, filters):
        self.filters = filters
        return []


def test_own_only_missing_filters_unenriched_rows():
    m = _load("enrich_tracks_with_spotify")
    pg = _RecordingPg()
    m.enrich_batch(pg, sp=None, limit=10, only_missing=True)
    assert "spotify_artist_ids=is.null" in pg.filters
    pg = _RecordingPg()
    m.enrich_batch(pg, sp=None, limit=10)
    assert "spotify_artist_ids=is.null" not in pg.filters
