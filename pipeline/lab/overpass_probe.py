import requests,sys,re
for pat in sys.argv[1:]:
    q=f'[out:json][timeout:60];area["ISO3166-1"="US"]->.a;(nwr["name"~"{pat}",i](area.a);nwr["operator"~"{pat}",i](area.a););out center tags 40;'
    for url in ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']:
        try: r=requests.post(url,data=q,timeout=90); r.raise_for_status(); break
        except Exception as e: r=None
    if r is None: print(pat,'ERR'); continue
    for e in r.json()['elements']:
        c=e.get('center') or e; t=e['tags']
        print(pat,'|',t.get('name'),'|',round(c['lat'],4),round(c['lon'],4),'|',t.get('addr:city',''),t.get('addr:state',''),t.get('industrial') or t.get('man_made') or t.get('building',''))
