"""Expand plants.json with verified-existence US/PR sites and fill floodZone/elevationM/riverDistKm for all real plants.
River distance: Esri-hosted 'USA Rivers and Streams' (NHD-derived) FeatureServer queried within 10 km, min distance point->polyline segments (USGS NHD host unreachable from build machine; OSM Overpass was down)."""
import json, math, time, os, requests
P='web/public/data/plants.json'; BK='data/raw/plants.backup.json'; GC='data/raw/plants/geocode_cache.json'
H={'User-Agent':'RxRadar-hackathon/0.1'}
plants=json.load(open(BK))  # always rebuild from the untouched backup
ids0={p['id'] for p in plants}
# id, name, company, address, city, st, geocode query, (lat,lon) override, drugs, conf, sterile, sources, note
N=[
('fresenius-kabi-wilson','Fresenius Kabi Wilson','Fresenius Kabi','5200 Corporate Pkwy W, Wilson, NC 27893','Wilson','NC','Corporate Pkwy, Wilson, North Carolina 27893',None,[],0.5,True,['fk-wilson','ncbiotech-fk'],'Prefilled-syringe center of excellence and freeflex IV bags (acquired from BD 2016). Product-level drug link not verified, so drugIds left empty.'),
('fresenius-kabi-grand-island','Fresenius Kabi Grand Island','Fresenius Kabi','3159 Staley Rd, Grand Island, NY 14072','Grand Island','NY','3159 Staley Rd, Grand Island, NY',None,[],0.5,True,['fk-us-insight'],'Two IV-drug production buildings plus a vial facility. Product-level drug link not verified; drugIds empty.'),
('fresenius-kabi-melrose-park','Fresenius Kabi Melrose Park','Fresenius Kabi','2020 N Ruby St, Melrose Park, IL 60160','Melrose Park','IL','Ruby Street, Melrose Park, Illinois 60160',None,[],0.5,True,['fk-melrose','il-sfm-fk'],'Sterile injectables campus under multi-year $250M expansion. Product-level drug link not verified; drugIds empty. Street position approximate (Ruby St centroid).'),
('pfizer-mcpherson','Pfizer McPherson (Hospira)','Pfizer','McPherson, KS 67460','McPherson','KS',None,(38.3711,-97.6641),['morphine-inj','hydromorphone-inj'],0.5,True,['fiercepharma-mcpherson'],'Major US injectable-painkiller plant (Hospira legacy). Opioid product mapping inferred from press coverage; position approximate (town-level).'),
('icu-medical-austin','Otsuka ICU Medical Austin','ICU Medical','3900 Howard Ln, Austin, TX 78728','Austin','TX','3900 Howard Ln, Austin, TX',None,[],0.6,True,['icu-austin-expansion','txdlr-icu'],'Primary US IV-solutions plant (Austin, ~700k sq ft, NW Austin). Which solutions it makes is not verified here; drugIds empty. Address from TDLR project filing.'),
('hikma-cherry-hill','Hikma Cherry Hill','Hikma','2 Esterbrook Ln, Cherry Hill, NJ 08003','Cherry Hill','NJ','2 Esterbrook Lane, Cherry Hill, NJ',None,[],0.6,True,['hikma-us-locations'],'Hikma injectables manufacturing plant (vials, prefilled syringes, IV bags). Product mapping unverified; drugIds empty.'),
('hikma-bedford','Hikma Bedford','Hikma','200 Northfield Rd, Bedford, OH 44146','Bedford','OH','Northfield Road, Bedford, Ohio 44146',None,[],0.6,True,['hikma-us-locations'],'Hikma injectables R&D and manufacturing plant. Product mapping unverified; drugIds empty.'),
('hikma-columbus','Hikma Columbus','Hikma','1809 Wilson Rd, Columbus, OH 43228','Columbus','OH','1809 North Wilson Road, Columbus, Ohio',None,[],0.5,False,['hikma-us-locations'],'Oral, nasal and respiratory (inhalation) products plant; not a sterile injectable site. Albuterol link not verified.'),
('amphastar-ims-south-el-monte','Amphastar / International Medication Systems','Amphastar','1886 Santa Anita Ave, South El Monte, CA 91733','South El Monte','CA','1886 Santa Anita Avenue, South El Monte, CA',None,['atropine-inj','dextrose-50-inj','epinephrine-inj','lidocaine-inj','sodium-bicarbonate-inj'],0.8,True,['amphastar-10k'],'Emergency prefilled syringes (atropine, calcium chloride, dextrose, epinephrine, lidocaine, sodium bicarbonate) per Amphastar FY2025 10-K; filling site is IMS, South El Monte.'),
('exela-lenoir','Exela Pharma Sciences Lenoir','Exela','1245 Blowing Rock Blvd, Lenoir, NC 28645','Lenoir','NC','1245 Blowing Rock Boulevard, Lenoir, NC',None,['sodium-bicarbonate-inj'],0.6,True,['ncsos-exela','pharmacompass-exela'],'Sterile injectables maker; sodium bicarbonate link from public shortage reporting (not re-verified here).'),
('nephron-west-columbia','Nephron Pharmaceuticals West Columbia','Nephron','4500 12th Street Ext, West Columbia, SC 29172','West Columbia','SC',None,(33.90116,-81.04128),['albuterol-inhalation'],0.7,True,['sccommerce-nephron'],'Large US-based sterile 503B/ANDA site; known albuterol inhalation solution maker (not re-verified in this pass).'),
('baxter-cleveland-ms','Baxter Cleveland','Baxter','Cleveland, MS 38732','Cleveland','MS',None,(33.76484,-90.719),[],0.5,True,['baxter-jobs-cleveland'],'Large Baxter plant (pour bottles, glass IV, reconstitution devices per Baxter job posting). Drug mapping unverified; drugIds empty. Position from OSM.'),
('baxter-aibonito-pr','Baxter Aibonito','Baxter','Aibonito, PR','Aibonito','PR',None,(18.1378,-66.2591),['sodium-chloride-minibag'],0.7,True,['baxter-pr-letter-2018'],'Small-volume parenteral (MINI-BAG) plant in Puerto Rico per Baxter post-Maria statement.'),
('baxter-round-lake-il','Baxter Round Lake','Baxter','Route 120 & Wilson Rd, Round Lake, IL 60073','Round Lake','IL',None,(42.3345,-88.1314),[],0.4,True,['il-sfm-baxter'],'Baxter IV Systems Division facility per Illinois State Fire Marshal tank record. Drug mapping unverified; drugIds empty.'),
('simtra-bloomington','Simtra BioPharma Solutions Bloomington','Simtra (ex-Baxter BioPharma)','927 S Curry Pike, Bloomington, IN 47403','Bloomington','IN','South Curry Pike, Bloomington, Indiana',None,[],0.6,True,['baxter-bloomington'],'Sterile fill-finish CDMO (formerly Baxter BioPharma Solutions). Contract products, so drugIds empty.'),
('par-sterile-rochester','Par Sterile Products Rochester','Par Pharmaceutical','870 Parkdale Rd, Rochester, MI 48307','Rochester','MI','Parkdale Road, Rochester, Michigan',None,['vasopressin-inj','epinephrine-inj'],0.5,True,['par-sterile'],'Par Sterile Products makes Vasostrict (vasopressin) and Adrenalin (epinephrine); links from product knowledge, not re-verified in this pass.'),
('sca-pharmaceuticals-little-rock','SCA Pharmaceuticals Little Rock','SCA Pharmaceuticals','8821 Knoedl Ct, Little Rock, AR 72205','Little Rock','AR',None,(34.74794,-92.37396),[],0.5,True,['osm-sca'],'503B outsourcing facility (ready-to-use syringes/bags). Product mapping unverified; drugIds empty.'),
('civica-petersburg','Civica Petersburg','Civica','N Normandy Dr, Petersburg, VA 23805','Petersburg','VA','Normandy Drive, Petersburg, Virginia 23805',None,[],0.6,True,['civica-petersburg-news'],'Non-profit sterile injectables plant (vials and prefilled syringes) next to AMPAC; product list unverified so drugIds empty. Position approximate (street-level).'),
('amgen-juncos-pr','Amgen Juncos','Amgen','Road 31 Km 24.6, Juncos, PR 00777','Juncos','PR',None,(18.2346,-65.90604),[],0.4,True,['osm-amgen-juncos'],'Biologics fill-finish site in Puerto Rico; no drug in the canonical list is linked.'),
('eugia-east-windsor','Eugia US East Windsor','Eugia (AuroMedics)','279 Princeton-Hightstown Rd, East Windsor, NJ 08520','East Windsor','NJ','279 Princeton-Hightstown Road, East Windsor, NJ',None,[],0.4,True,['eugia-us'],'Sterile generic injectables (incl. oncology) site; product mapping unverified; drugIds empty.'),
('pfizer-kalamazoo','Pfizer Kalamazoo','Pfizer','7000 Portage Rd, Kalamazoo, MI 49001','Kalamazoo','MI','7000 Portage Road, Kalamazoo, MI',None,[],0.4,True,['pfizer-kalamazoo'],'Large Pfizer sterile-injectables and pharma site; product mapping unverified; drugIds empty.'),
]
cache=json.load(open(GC)) if os.path.exists(GC) else {}
def geocode(q):
    if q in cache: return cache[q]
    time.sleep(1.1); r=requests.get('https://nominatim.openstreetmap.org/search',params=dict(q=q,format='json',limit=1),headers=H,timeout=30).json()
    cache[q]=[float(r[0]['lat']),float(r[0]['lon'])] if r else None
    os.makedirs(os.path.dirname(GC),exist_ok=True); json.dump(cache,open(GC,'w')); return cache[q]
new=[]
for (i,nm,co,addr,city,st,q,ov,drugs,conf,ster,src,note) in N:
    ll=ov or geocode(q)
    if not ll: print('NO GEOCODE',i); continue
    new.append(dict(id=i,name=nm,company=co,address=addr,city=city,state=st,country='US',lat=round(ll[0],5),lon=round(ll[1],5),drugIds=drugs,share={},shareProvenance='MODEL',linkConfidence=conf,sterileInjectable=ster,provenance='REAL',sourceIds=src,notes=note))
# shares: new plants split 70% of each drug's residual (1 - existing REAL shares); stand-ins keep the rest, proportionally
real=[p for p in plants if p['provenance']=='REAL']; stand=[p for p in plants if p['provenance']!='REAL']
for d in {d for p in new for d in p['drugIds']}:
    R=max(0,1-sum(p['share'].get(d,0) for p in real)); mk=[p for p in new if d in p['drugIds']]
    pool=0.7*R
    for p in mk: p['share'][d]=round(pool/len(mk),3)
    ss=[p for p in stand if d in p['share']]; tot=sum(p['share'][d] for p in ss)
    for p in ss: p['share'][d]=round((R-pool)*p['share'][d]/tot,3) if tot>0 else p['share'][d]
def get(url,**kw):
    for a in range(4):
        try:
            r=requests.get(url,timeout=60,**kw)
            if r.status_code==200: return r
        except Exception: pass
        time.sleep(2*(a+1))
def flood(lat,lon):
    r=get('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query',params=dict(geometry=f'{lon},{lat}',geometryType='esriGeometryPoint',inSR=4326,outFields='FLD_ZONE',returnGeometry='false',f='json'))
    if not r: return None
    f=r.json().get('features')
    if f is None: return None
    z=[x['attributes']['FLD_ZONE'] for x in f]
    for k in ('VE','V','AE','AO','AH','A','AR','A99'):  # most severe SFHA zone wins
        if k in z: return k
    return z[0] if z else 'X'
def elev(lat,lon):
    r=get('https://epqs.nationalmap.gov/v1/json',params=dict(x=lon,y=lat,units='Meters',wkid=4326))
    try: return round(float(r.json()['value']),1)
    except Exception: return None
def river(lat,lon,R=10000):
    r=get('https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Rivers_and_Streams/FeatureServer/0/query',params=dict(geometry=f'{lon},{lat}',geometryType='esriGeometryPoint',inSR=4326,distance=R,units='esriSRUnit_Meter',outFields='OBJECTID',returnGeometry='true',outSR=4326,f='json'))
    if not r: return None
    fs=r.json().get('features')
    if fs is None: return None
    kx=111.32*math.cos(math.radians(lat)); best=None
    for e in fs:
        for path in e['geometry']['paths']:
            pts=[((x-lon)*kx,(y-lat)*110.57) for x,y in path]
            for (x1,y1),(x2,y2) in zip(pts,pts[1:]):
                dx,dy=x2-x1,y2-y1; L=dx*dx+dy*dy; t=0 if L==0 else max(0,min(1,-(x1*dx+y1*dy)/L)); d=math.hypot(x1+t*dx,y1+t*dy)
                best=d if best is None or d<best else best
    return round(best,2) if best is not None else 'none'
allp=plants+new
ECF='data/raw/plants/enrich_cache.json'; EC=json.load(open(ECF)) if os.path.exists(ECF) else {}
for p in allp:
    if p['provenance']!='REAL': continue
    k=p['id']
    if k in EC: fz,el,rv=EC[k]
    else:
        fz=flood(p['lat'],p['lon']); el=elev(p['lat'],p['lon']); rv=river(p['lat'],p['lon'])
        if None not in (fz,el,rv): EC[k]=[fz,el,rv]; json.dump(EC,open(ECF,'w'))
    if fz is not None: p['floodZone']=fz
    if el is not None: p['elevationM']=el
    if rv=='none': p['riverDistKm']=10.0; p['notes']=(p.get('notes') or '')+' No mapped NHD-derived river/stream within 10 km; riverDistKm capped at 10.'
    elif rv is not None: p['riverDistKm']=rv
    print(p['id'],p.get('floodZone'),p.get('elevationM'),p.get('riverDistKm'),flush=True)
json.dump(allp,open(P,'w'),separators=(',',':'))
