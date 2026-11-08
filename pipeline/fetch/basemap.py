"""Prepare low-bandwidth globe, relief and Natural Earth basemap assets."""
import json
import math
from pathlib import Path
from urllib.request import urlopen
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/cartography"
PUBLIC = ROOT / "web/public"

def file(name,url):
    p=RAW/name
    if not p.exists():
        p.write_bytes(urlopen(url,timeout=60).read())
    return p

def basemap():
    src=file("countries.geojson","https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson")
    features=[]
    for f in json.loads(src.read_text(encoding="utf-8"))["features"]:
        g=f["geometry"]
        polygons=g["coordinates"] if g["type"]=="MultiPolygon" else [g["coordinates"]]
        reduced=[]
        for polygon in polygons:
            rings=[]
            for ring in polygon:
                line=[ring[0]]
                for x,y in ring[1:-1]:
                    if max(abs(x-line[-1][0]),abs(y-line[-1][1]))>.06: line.append((x,y))
                if len(line)>2:
                    rings.append([[round(x,3),round(y,3)] for x,y in line+[line[0]]])
            if rings: reduced.append(rings)
        if reduced: features.append(dict(type="Feature",properties={"name":f["properties"]["ADMIN"]},geometry={"type":"MultiPolygon","coordinates":reduced}))
    (PUBLIC/"basemap/land.json").write_text(json.dumps({"type":"FeatureCollection","features":features},separators=(",",":")),encoding="utf-8")

def globe():
    p=PUBLIC/"textures"
    day=np.asarray(Image.open(p/"earth.jpg").convert("RGB"))/255
    night=np.asarray(Image.open(p/"night.webp").convert("RGB"))/255
    clouds=Image.open(file("clouds.jpg","https://www.solarsystemscope.com/textures/download/2k_earth_clouds.jpg")).convert("L")
    clouds.resize((1024,512),Image.Resampling.LANCZOS).save(p/"clouds.webp",quality=84)
    cloud=np.asarray(clouds)/255
    size=1050
    yy,xx=np.mgrid[:size,:size]
    x=(xx+.5-size*.5)/(size*.495)
    y=(size*.5-yy-.5)/(size*.495)
    z=np.sqrt(np.maximum(0,1-x*x-y*y))
    tilt=np.radians(32)
    lat=np.arcsin(np.clip(z*np.sin(tilt)+y*np.cos(tilt),-1,1))
    lon=np.radians(-76)+np.arctan2(x,z*np.cos(tilt)-y*np.sin(tilt))
    u=(.5+lon/(2*np.pi))%1
    v=np.clip(.5-lat/np.pi,0,.999)
    def project(a): return a[(v*a.shape[0]).astype(int),(u*a.shape[1]).astype(int)]
    texture=project(day)
    lamp=project(night).max(2)
    cover=project(cloud)**1.2
    shade=np.clip(.76*x+.56*y+.47*z+.13,0,1)
    lum=texture@[.28,.52,.20]
    surface=texture*.48+lum[:,:,None]*[.32,.61,.8]
    col=surface*(.17+.96*shade[:,:,None])
    col=col*(1-.63*cover[:,:,None])+cover[:,:,None]*[.62,.77,.87]*(.22+.78*shade[:,:,None])
    col+=lamp[:,:,None]*[.99,.67,.28]*(1-shade[:,:,None])**1.15*.95
    col+=(1-z[:,:,None])**4.3*[.16,.56,.76]*(.23+.77*shade[:,:,None])
    alpha=np.clip((1-np.sqrt(x*x+y*y))*size*.495+.5,0,1)
    result=np.dstack((np.clip(col,0,1),alpha))
    Image.fromarray(np.uint8(result*255)).save(p/"globe.webp",quality=88)

if __name__=="__main__":
    RAW.mkdir(parents=True,exist_ok=True)
    basemap()
    globe()
