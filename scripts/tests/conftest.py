"""Make the scripts' sibling imports resolvable under pytest.

The pipeline scripts import shared modules as plain siblings
(`from streambase_postgrest import Postgrest`), which works when a script is
run directly (its own directory becomes sys.path[0]) but not when imported by
tests run from the repo root. Putting scripts/ on the path keeps both worlds
working without touching runtime code.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
