import requests,time
H={'User-Agent':'RxRadar-hackathon/0.1'}
# name, city lat, lon
S=[("Fresenius Kabi",35.72,-77.92),("Fresenius Kabi",42.97,-78.96),("Fresenius Kabi",41.89,-87.86),("Hospira",38.37,-97.66),("ICU Medical",30.4,-97.7),("ICU Medical",40.75,-111.95),
("Baxter",33.75,-90.72),("Baxter",36.34,-92.38),("Baxter",39.17,-86.53),("B. Braun",40.6,-75.5),("Hikma",41.37,-81.5),("Amphastar",34.03,-118.05),("Nephron",33.95,-81.1),("Exela",35.9,-81.5),("Civica",37.2,-77.4),
("Par",42.66,-83.13),("Eugia",40.27,-74.5),("QuVa",29.62,-95.63),("SCA Pharmaceuticals",34.75,-92.35),("Medefil",43.3,-73.65),("American Regent",40.8,-72.9),("Amgen",18.4,-65.92),("Lilly",18.4,-65.97)]
for n,la,lo in S:
    d=.3
    r=requests.get('https://nominatim.openstreetmap.org/search',params=dict(q=n,format='json',limit=3,viewbox=f'{lo-d},{la+d},{lo+d},{la-d}',bounded=1),headers=H,timeout=30).json()
    print(n,la,lo,'->',[(x['display_name'][:55],x['lat'][:8],x['lon'][:9]) for x in r]); time.sleep(1.1)
