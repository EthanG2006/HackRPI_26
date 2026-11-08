"""Cache NHC forecast geometry, order WPC/SPC products by issue time, and preserve USGS timestamps."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zipfile import ZipFile
import csv
import io
import re
from collections import defaultdict
import warnings

import requests
import shapefile
from shapely.geometry import shape, box, mapping
from .common import RAW, PUBLIC, CURATED, iso, save, read

UTC = timezone.utc


def download(url, filename, params=None):
    path = RAW / filename
    if not path.exists():
        r = requests.get(url, params=params, timeout=60)
        r.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
    return path.read_bytes()


def reader(data, suffix):
    z = ZipFile(io.BytesIO(data))
    base = next(n[:-4] for n in z.namelist() if n.lower().endswith(suffix + '.shp'))
    return shapefile.Reader(**{ext:io.BytesIO(z.read(base+'.'+ext)) for ext in ('shp','shx','dbf')})


def rounded(coords):
    if isinstance(coords[0], (int,float)):
        return [round(x,3) for x in coords]
    return [rounded(sub) for sub in coords]


def advisory(storm_id, number):
    filename = f'{storm_id.lower()}_5day_{number:03d}.zip'
    data = download('https://www.nhc.noaa.gov/gis/forecast/archive/'+filename, filename)
    records = reader(data,'pts').shapeRecords()
    first = records[0].record.as_dict()
    raw = re.sub(r'\b(EDT|AST|EST|CDT|CST|AM|PM)\b', lambda m: m.group().upper(), first['ADVDATE'], flags=re.I)
    hour, ampm, tz, rest = raw.split(maxsplit=3)
    local = datetime.strptime(f'{hour.zfill(4)} {ampm} {rest.title()}', '%I%M %p %a %b %d %Y')
    issued = (local + timedelta(hours={'AST':4,'EDT':4,'CDT':5,'EST':5,'CST':6,'UTC':0}[tz])).replace(tzinfo=UTC)
    points = []
    for rec in records:
        r = rec.record.as_dict()
        if r['TAU']==0:
            valid = issued
        else:
            day,hm = r['VALIDTIME'].split('/')
            m_start = issued.replace(day=1,hour=int(hm[:2]),minute=int(hm[2:]))
            if int(day)<issued.day:
                m_start = (m_start+timedelta(days=32)).replace(day=1)
            valid = m_start.replace(day=int(day))
        points.append({'t':iso(valid),'lon':round(rec.shape.points[0][0],3),'lat':round(rec.shape.points[0][1],3),'vmaxKt':r['MAXWIND']})
    cone = shape(reader(data,'pgn').shape(0).__geo_interface__).simplify(0.025,preserve_topology=True)
    return dict(num=str(number),issued=iso(issued),forecast=points,cone=rounded(mapping(cone)['coordinates']))


def best_track(storm_id):
    data = download('https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2024-040425.txt','hurdat.txt')
    lines = data.decode().splitlines()
    i = next(i for i,l in enumerate(lines) if l.startswith(storm_id))
    result = []
    for line in lines[i+1:i+1+int(lines[i].split(',')[2])]:
        row = [s.strip() for s in line.split(',')]
        def hemi(s):
            return float(s[:-1])*(-1 if s[-1] in 'SW' else 1)
        p = dict(t=iso(datetime.strptime(row[0]+row[1],'%Y%m%d%H%M').replace(tzinfo=UTC)),status=row[3],
                 lat=hemi(row[4]),lon=hemi(row[5]),vmaxKt=int(row[6]),mslpMb=int(row[7]),r34Nm=list(map(int,row[8:12])))
        if len(row)>20 and row[20] and int(row[20])>0:
            p['rmwNm']=int(row[20])
        result.append(p)
    return result


def outlooks(start,end,kind):
    params=dict(year1=start.year,month1=start.month,day1=start.day,hour1=0,minute1=0,year2=end.year,
                month2=end.month,day2=end.day,hour2=23,minute2=59,type=kind,d=[1,2],geom='geom_layers')
    data=download('https://mesonet.agron.iastate.edu/cgi-bin/request/gis/outlooks.py',f'outlooks-{start:%Y%m%d}.zip',params)
    groups=defaultdict(list)
    crop = box(-88,28,-72,42)
    for rec in reader(data,'').iterShapeRecords():
        r=rec.record.as_dict()
        if kind=='C' and (r['CATEGORY']!='TORNADO' or r['DAY']!=1):
            continue
        geometry=shape(rec.shape.__geo_interface__).intersection(crop).simplify(0.035,preserve_topology=True)
        if geometry.is_empty or geometry.geom_type not in ('Polygon','MultiPolygon'):
            continue
        groups[r['PRODISS'],r['ISSUE'],r['EXPIRE'],r['DAY']].append(
            {'category' if kind=='E' else 'label':r['THRESHOLD'],'polygon':rounded(mapping(geometry)['coordinates'])})
    def stamp(s):
        return iso(datetime.strptime(s,'%Y%m%d%H%M').replace(tzinfo=UTC))
    return [dict(issued=stamp(key[0]),validStart=stamp(key[1]),validEnd=stamp(key[2]),day=key[3],
                 kind='tornado' if kind=='C' else 'rainfall',areas=areas,provenance='REPLAY',sourceIds=['iem-outlooks']) for key,areas in sorted(groups.items())]


def gauge():
    import json
    raw=download('https://waterservices.usgs.gov/nwis/iv/','usgs-02137727.json',
                 dict(format='json',sites='02137727',parameterCd='00065',startDT='2024-09-23',endDT='2024-10-12'))
    series=json.loads(raw)['value']['timeSeries'][0]
    info=series['sourceInfo']
    points=[{'t':iso(datetime.fromisoformat(p['dateTime'])),'v':float(p['value'])} for p in series['values'][0]['value']
            if float(p['value'])!=-999999]
    return dict(siteId='02137727',name='Catawba River near Pleasant Gardens',lat=info['geoLocation']['geogLocation']['latitude'],
                lon=info['geoLocation']['geogLocation']['longitude'],unit='ft',points=points,nearPlantId='baxter-north-cove',
                note='Regional gauge on the Catawba main stem. Stage is relative to gauge datum; gaps are retained.',
                provenance='REAL',sourceIds=['usgs-gauge'])


def add_imagery(scenario, result):
    for key in ('radar','satellite'):
        path=PUBLIC / key / scenario / 'frames.json'
        if path.exists():
            result[key]=read(path)


def hurricane(scenario,storm_id,n):
    with ThreadPoolExecutor(max_workers=8) as pool:
        advisories=list(pool.map(lambda idx: advisory(storm_id,idx),range(1,n+1)))
    result={'scenarioId':scenario, 'storm':dict(id=storm_id,name=scenario.title(),bestTrack=best_track(storm_id),
            advisories=advisories,provenance='REPLAY',sourceIds=['nhc-gis','hurdat2'])}
    if scenario=='helene':
        result['gauges']=[gauge()]
        result['rainfall']=outlooks(datetime(2024,9,23),datetime(2024,9,27),'E')
        if (CURATED/'north-cove-flood.json').exists():
            result['floodZones']=read(CURATED/'north-cove-flood.json')
    add_imagery(scenario,result)
    save(PUBLIC/'storms'/f'{scenario}.json',result)
    print(scenario,len(advisories),'archived advisories')


def tornado():
    raw = download('https://www.spc.noaa.gov/wcm/data/1950-2023_actual_tornadoes.csv','spc-tornadoes.csv')
    r = next(r for r in csv.DictReader(io.StringIO(raw.decode())) if r['date']=='2023-07-19' and r['st']=='NC' and r['mag']=='3')
    path=[[float(r['slon']),float(r['slat'])],[float(r['elon']),float(r['elat'])]]
    result=dict(scenarioId='rocky-mount',tornado=dict(t='2023-07-19T16:25:00Z',rating='EF3',path=path,
                widthYd=int(r['wid']),lengthMi=float(r['len']),peakWindMph=150,provenance='REPLAY',sourceIds=['spc-tornado','nws-tornado']),
                spc=outlooks(datetime(2023,7,19),datetime(2023,7,19),'C'))
    add_imagery('rocky-mount',result)
    save(PUBLIC/'storms/rocky-mount.json',result)


if __name__=='__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs=[pool.submit(hurricane,'helene','AL092024',18),pool.submit(hurricane,'maria','AL152017',25),pool.submit(tornado)]
        for f in jobs:
            try: f.result()
            except Exception as error: print(repr(error)); raise
