"""Cache selected IEM NEXRAD scans and NASA GIBS daily Terra scenes for offline replays."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
import math
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2] / "web" / "public"
IEM = "https://mesonet.agron.iastate.edu"
GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi"
REGIONS = {
    "helene": ([-94, 20, -73, 39], "2024-09-23T18:00", 23, 6),
    "maria": ([-69.5, 15.5, -62.5, 21], "2017-09-19T06:00", 10, 3),
    "rocky-mount": ([-79.9, 34.9, -76.4, 37.3], "2023-07-19T12:00", 14, 0.5),
}

def fetch(url):
    with urlopen(Request(url, headers={"User-Agent": "RxRadar-HackRPI/1.0"}), timeout=30) as response:
        return response.read()

def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

def merc_y(lat):
    return 6378137 * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))

def frame(job):
    scenario, bounds, kind, dt = job
    west, south, east, north = bounds
    name = dt.strftime("%Y%m%dT%H%M")
    suffix = "webp" if kind == "satellite" else "png"
    relative = Path(f"data/{kind}/{scenario}/{name}.{suffix}")
    output = ROOT / relative
    output.parent.mkdir(parents=True, exist_ok=True)
    width = 640
    height = round(width * (merc_y(north) - merc_y(south)) / (6378137 * math.radians(east-west)))
    if not output.exists():
        if scenario == "maria" and kind == "radar":
            stamp = dt.strftime("%Y%m%d%H%M")
            base = f"{IEM}/archive/data/{dt:%Y/%m/%d}/GIS/prcomp/n0q_{stamp}"
            world = list(map(float, fetch(base + ".wld").split()))
            image = Image.open(BytesIO(fetch(base + ".png"))).convert("RGBA")
            arr = np.array(image)
            arr[:,:,3] = np.where(arr[:,:,:3].max(axis=2) > 40, arr[:,:,3], 0)
            if not arr[:,:,3].any():
                return None
            # Inverse Mercator row positions, then index the source's geographic world file.
            x = np.rint((np.linspace(west, east, width) - world[4]) / world[0]).astype(int)
            ys = np.linspace(merc_y(north), merc_y(south), height)
            lat = np.degrees(2*np.arctan(np.exp(ys / 6378137)) - np.pi/2)
            y = np.rint((lat-world[5]) / world[3]).astype(int)
            warped = arr[np.clip(y,0,arr.shape[0]-1)[:,None], np.clip(x,0,arr.shape[1]-1)]
            warped[(y<0)|(y>=arr.shape[0]),:] = 0
            warped[:,(x<0)|(x>=arr.shape[1])] = 0
            image = Image.fromarray(warped)
        else:
            radar = kind == "radar"
            params = dict(service="WMS", request="GetMap", version="1.1.1", styles="", srs="EPSG:3857",
                          bbox=",".join(map(str,[6378137*math.radians(west),merc_y(south),6378137*math.radians(east),merc_y(north)])),
                          width=width, height=height, transparent="TRUE",
                          layers="nexrad-n0r-wmst" if radar else "MODIS_Terra_CorrectedReflectance_TrueColor",
                          time=iso(dt) if radar else dt.date().isoformat(), format="image/png" if radar else "image/jpeg")
            url = IEM + "/cgi-bin/wms/nexrad/n0r-t.cgi" if radar else GIBS
            image = Image.open(BytesIO(fetch(url + "?" + urlencode(params))))
            if radar and image.convert("RGBA").getchannel("A").getbbox() is None:
                return None
        image.save(output, optimize=True, **({"quality":77} if suffix == "webp" else {}))
    available = dt if kind == "radar" else dt + timedelta(days=1)
    return scenario, kind, {"t":iso(available), "url":relative.as_posix(),"bounds":bounds, "observation":iso(dt)}

def main():
    jobs = []
    for scenario, (bounds, start, count, hours) in REGIONS.items():
        dt = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
        for i in range(count):
            jobs.append((scenario,bounds,"radar",dt+timedelta(hours=i*hours)))
        for i in range({"helene":6,"maria":6,"rocky-mount":2}[scenario]):
            jobs.append((scenario,bounds,"satellite",dt.replace(hour=0)+timedelta(days=i)))
    def guarded(job):
        try: return frame(job)
        except Exception as e: print(job[0], job[2], job[3], str(e), flush=True)
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = [r for r in pool.map(guarded,jobs) if r]
    for scenario in REGIONS:
        for kind in ("radar","satellite"):
            frames = sorted((f for s,k,f in results if s==scenario and k==kind), key=lambda f:f["t"])
            p = ROOT / "data" / kind / scenario / "frames.json"
            p.parent.mkdir(parents=True,exist_ok=True)
            p.write_text(json.dumps({"provenance":"REPLAY","sourceIds":["iem-radar" if kind=="radar" else "nasa-gibs"],"frames":frames},separators=(",",":")))
            print(scenario,kind,len(frames),flush=True)

if __name__ == "__main__":
    main()
