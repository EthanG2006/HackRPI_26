import json, sys
RAW='data/raw/hurdat2/hurdat2-1851-2025-092326.txt'
OUT='web/public/data/hurdat_presets.json'
NOTES={
'AL092024':'Helene: Cat 4 Big Bend landfall; extreme inland flooding in western NC knocked out Baxter North Cove, ~60% of US IV fluids.',
'AL142024':'Milton: rapid intensification to Cat 5 then Florida landfall near Sarasota; tornadoes and mass evacuation strained Gulf-coast hospital supply.',
'AL092022':'Ian: Cat 4 landfall in SW Florida with record surge; hospital evacuations and distribution disruption.',
'AL092021':'Ida: Cat 4 Louisiana landfall on the Ida anniversary of Katrina; long power outages and Gulf-coast plant/distribution disruption.',
'AL142018':'Michael: explosive rapid intensification to Cat 5 before Florida Panhandle landfall; tests short-lead warning limits.',
'AL062018':'Florence: slow-moving Carolinas rain event with record river flooding near NC plants (Pfizer Rocky Mount, Baxter Marion region).',
'AL152017':'Maria: Cat 4 direct hit on Puerto Rico; island-wide outage crippled PR sterile-injectable plants and caused the 2017-18 IV bag shortage.',
'AL092017':'Harvey: stalled over Texas with 60+ in of rain; extreme rainfall flooding of Houston-area facilities and distribution.',
'AL112017':'Irma: Cat 5 track up Florida and the Caribbean; long-track wind and outage hazard to PR and Florida supply chain.',
'AL122005':'Katrina: Cat 3 Gulf landfall with catastrophic surge; benchmark for hospital and pharmacy supply collapse.',
'AL111989':'Hugo: Cat 4 Charleston landfall that carried hurricane winds well inland to Charlotte, NC; wind decay inland benchmark.',
'AL041992':'Andrew: compact Cat 5 Florida landfall; benchmark for small-radius intense wind field and rapid inland decay.'}
want=set(NOTES); storms=[]; cur=None
for ln in open(RAW):
    p=[x.strip() for x in ln.split(',')]
    if p[0].startswith('AL') and len(p[0])==8:
        cur=None
        if p[0] in want:
            cur=dict(id=p[0],name=p[1].title(),year=int(p[0][4:]),note=NOTES[p[0]],track=[],sourceIds=['noaa-hurdat2']); storms.append(cur)
        continue
    if cur is None: continue
    d,t,ident,st=p[0],p[1],p[2],p[3]
    if ident not in ('','L','C','S','R','T','G','W','I','P') : pass
    def ll(s): return float(s[:-1])*(-1 if s[-1] in 'WS' else 1)
    r34=[int(x) for x in p[8:12]]; rmw=int(p[19]) if len(p)>19 and p[19].lstrip('-').isdigit() else -999
    pt=dict(t=f'{d[:4]}-{d[4:6]}-{d[6:]}T{t[:2]}:{t[2:]}:00Z',lat=ll(p[4]),lon=ll(p[5]),vmaxKt=int(p[6]),status=st)
    if int(p[7])!=-999: pt['mslpMb']=int(p[7])
    if rmw>0: pt['rmwNm']=rmw
    if all(x!=-999 for x in r34): pt['r34Nm']=r34
    cur['track'].append(pt)
order=[k for k in NOTES]; storms.sort(key=lambda s:order.index(s['id']))
json.dump(dict(storms=storms,sourceIds=['noaa-hurdat2']),open(OUT,'w'),separators=(',',':'))
for s in storms: print(s['id'],s['name'],len(s['track']),max(x['vmaxKt'] for x in s['track']),sum('rmwNm' in x for x in s['track']),sum('r34Nm' in x for x in s['track']))
