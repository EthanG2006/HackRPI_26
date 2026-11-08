"""Public weather snapshots with explicit freshness and bounded, parallel upstream requests."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import json
import time
import httpx

DATA = Path(__file__).resolve().parents[1]/"web"/"public"/"data"
FEEDS = {"nhc-live":"https://www.nhc.noaa.gov/CurrentStorms.json",
         "nws-live":"https://api.weather.gov/alerts/active?status=actual",
         "spc-live":"https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson"}
cached = None
next_fetch = 0.


def get_feed(source):
    response = httpx.get(FEEDS[source], headers={"User-Agent":"RxRadar/1.0 (HackRPI weather operations demo)"},
                         timeout=3.5, follow_redirects=True)
    response.raise_for_status()
    return response.json()


def coordinate(x, negative):
    if isinstance(x, str):
        x=x.strip()
        if x and x[-1].isalpha():
            return float(x[:-1])*(-1 if x[-1].upper() in negative else 1)
    return float(x)


def parse_storms(data):
    storms=[]
    for s in data["activeStorms"]:
        try:
            lat=coordinate(s.get("latitudeNumeric", s.get("latitude")), "S")
            lon=coordinate(s.get("longitudeNumeric", s.get("longitude")), "W")
            storms.append(dict(id=s["id"],name=s["name"],classification=s.get("classification","Tropical cyclone"),
                               intensityKt=float(s.get("intensity") or 0),lat=lat,lon=lon))
        except (TypeError, ValueError, KeyError):
            continue
    return storms


def parse_alerts(data):
    rank={"Extreme":4,"Severe":3,"Moderate":2,"Minor":1}
    def score(f):
        p=f["properties"]
        return (rank.get(p.get("severity"),0),p.get("urgency")=="Immediate",p.get("sent",""))
    result=[]
    for f in sorted(data["features"],key=score,reverse=True)[:220]:
        p=f["properties"]
        alert={k:p.get(k,"") for k in ("id","event","severity","headline","areaDesc","onset","expires")}
        if f.get("geometry",{}):
            g=f["geometry"]
            if g["type"] in ("Polygon","MultiPolygon"):
                alert["polygon"]=g["coordinates"]
        result.append(alert)
    return result


def parse_spc(data):
    areas=[]
    for f in data["features"]:
        p=f["properties"]
        if f.get("geometry") and f["geometry"]["type"] in ("Polygon","MultiPolygon"):
            areas.append(dict(label=p["LABEL"],polygon=f["geometry"]["coordinates"]))
    p=data["features"][0]["properties"]
    return dict(kind="categorical", issued=p["ISSUE_ISO"],validStart=p["VALID_ISO"],
                validEnd=p["EXPIRE_ISO"],areas=areas,provenance="REAL",sourceIds=["spc-live"])


def snapshot():
    global cached, next_fetch
    if cached and time.monotonic() < next_fetch:
        return cached
    parsers={"nhc-live":("activeStorms",parse_storms), "nws-live":("alerts",parse_alerts),"spc-live":("spc",parse_spc)}
    current={"activeStorms":[],"alerts":[],"sourceIds":[],"fromCache":False}
    failed=[]
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures={sid:pool.submit(get_feed,sid) for sid in FEEDS}
        for sid, future in futures.items():
            try:
                key,parser=parsers[sid]
                current[key]=parser(future.result())
                current["sourceIds"].append(sid)
            except (httpx.HTTPError, KeyError, TypeError, IndexError, ValueError):
                failed.append(sid)
    if not current["sourceIds"]:
        prev=(cached or json.loads((DATA/"live_cache.json").read_text(encoding="utf-8-sig")))
        cached={**prev,"fromCache":True}
        next_fetch=time.monotonic()+30
        return cached
    current["fetchedAt"]=datetime.now(timezone.utc).isoformat(timespec="seconds")
    if current["activeStorms"]:
        title="NHC tracking " + ", ".join(s["name"] for s in current["activeStorms"][:4]) + "."
    elif "nhc-live" in failed:
        title="NHC status unavailable."
    else:
        title="No active NHC tropical cyclones."
    if current["alerts"]:
        a=current["alerts"][0];title+=f' Highest NWS alert: {a["event"]} • {a["areaDesc"].split(";")[0]}.'
    elif current.get("spc"):
        title+=" SPC outlook: "+current["spc"]["areas"][-1]["label"]+"."
    if failed:
        title+=" Missing feeds: "+", ".join(sid.split("-")[0].upper() for sid in failed)+"."
    current["headline"]=title
    cached=current; next_fetch=time.monotonic()+180
    return current


if __name__=="__main__":
    snap=snapshot()
    if not snap["fromCache"]:
        (DATA/"live_cache.json").write_text(json.dumps({**snap,"fromCache":True},separators=(",",":")),encoding="utf-8")
    print(snap["headline"],snap["sourceIds"],len(snap["alerts"]))
