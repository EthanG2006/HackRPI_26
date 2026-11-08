import io, os, json, math, base64, numpy as np, requests
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
from shapely.geometry import shape, Point
from shapely.strtree import STRtree
from shapely import prepare, contains_xy
W,E,S,N,RES=-110,-55,8,50,0.1; NX,NY=550,420; Z=6; n=2**Z
D='data/raw/aws-terrain'
def tx(lon): return (lon+180)/360*n
def ty(lat): r=math.radians(lat); return (1-math.asinh(math.tan(r))/math.pi)/2*n
x0,x1=int(tx(W)),int(tx(E)); y0,y1=int(ty(N)),int(ty(S))
def get(xy):
    x,y=xy; f=f'{D}/{Z}_{x}_{y}.png'
    if not os.path.exists(f):
        r=requests.get(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png',timeout=60); r.raise_for_status(); open(f,'wb').write(r.content)
    a=np.asarray(Image.open(f).convert('RGB')).astype(np.float64)
    return xy,a[...,0]*256+a[...,1]+a[...,2]/256-32768
tiles=[(x,y) for y in range(y0,y1+1) for x in range(x0,x1+1)]
S_=np.zeros(NY*NX); C=np.zeros(NY*NX)
with ThreadPoolExecutor(8) as ex:
    for (x,y),el in ex.map(get,tiles):
        px=(x+(np.arange(256)+.5)/256)/n; lon=px*360-180
        py=(y+(np.arange(256)+.5)/256)/n; lat=np.degrees(np.arctan(np.sinh(math.pi*(1-2*py))))
        ci=np.floor((lon-W)/RES).astype(int); ri=np.floor((N-lat)/RES).astype(int)
        ok_c=(ci>=0)&(ci<NX); ok_r=(ri>=0)&(ri<NY)
        R,Cc=np.meshgrid(ri,ci,indexing='ij'); m=np.outer(ok_r,ok_c)
        idx=(R*NX+Cc)[m]; np.add.at(S_,idx,el[m]); np.add.at(C,idx,1)
elev=np.where(C>0,S_/np.maximum(C,1),0); print('empty cells',int((C==0).sum()))
elev=np.clip(np.round(elev),-32768,32767).astype('<i2').reshape(NY,NX)
gj=json.load(open('web/public/basemap/land.json'))
geoms=[shape(f['geometry']).buffer(0) for f in gj['features']]
lons=W+(np.arange(NX)+.5)*RES; lats=N-(np.arange(NY)+.5)*RES
LX,LY=np.meshgrid(lons,lats); land=np.zeros((NY,NX),bool)
for g in geoms:
    b=g.bounds
    if b[2]<W or b[0]>E or b[3]<S or b[1]>N: continue
    prepare(g); land|=contains_xy(g,LX,LY)
land=land.astype(np.uint8)
out=dict(west=W,south=S,east=E,north=N,nx=NX,ny=NY,res=RES,elevB64=base64.b64encode(elev.tobytes()).decode(),landB64=base64.b64encode(land.tobytes()).decode(),sourceIds=['aws-terrain-tiles','natural-earth'],
 note='0.1 deg cell means of AWS Terrain Tiles (Terrarium z6, ~2.4 km px) incl. ocean bathymetry; peaks and narrow valleys are smoothed. Land mask = Natural Earth polygons at cell centers.')
json.dump(out,open('web/public/data/terrain.json','w'),separators=(',',':'))
for nm,la,lo in [('Mt Mitchell',35.765,-82.265),('Marion NC',35.68,-82.01),('New Orleans',29.95,-90.07),('Gulf',25,-90),('San Juan',18.45,-66.07)]:
    r=int((N-la)/RES); c=int((lo-W)/RES); print(nm,int(elev[r,c]),int(land[r,c]))
