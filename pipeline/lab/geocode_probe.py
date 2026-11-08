import requests,time,sys,json
Q=sys.argv[1:]
H={'User-Agent':'RxRadar-hackathon/0.1'}
for q in Q:
    r=requests.get('https://nominatim.openstreetmap.org/search',params=dict(q=q,format='json',limit=2,addressdetails=0),headers=H,timeout=30).json()
    print(q,'->',[(x['display_name'][:70],x['lat'][:7],x['lon'][:8]) for x in r]); time.sleep(1.1)
