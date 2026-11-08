from pathlib import Path
import json
from functools import lru_cache
DATA=Path(__file__).resolve().parents[2]/"web"/"public"/"data"
@lru_cache(maxsize=1)
def data():
    def read(name):
        return json.loads((DATA/(name+".json")).read_text(encoding="utf-8-sig"))
    return read("plants"),read("drugs"),read("hospitals")["hospitals"]
