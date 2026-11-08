"""Refresh public reference data. The normal offline build uses the shipped snapshots."""
import csv
import io
import json
import re
from concurrent.futures import ThreadPoolExecutor
from zipfile import ZipFile

import requests
from .common import CURATED, PUBLIC, RAW, save

HIFLD = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/Hospitals/FeatureServer/0'
NRI = 'https://services8.arcgis.com/RdbQZfEkeO8qG89L/ArcGIS/rest/services/NRI_Counties/FeatureServer/0'
SVI = 'https://svi2.cdc.gov/webapi/Documents/download?year=2022&type=csv&category=states_counties&name=SVI_2022_US_COUNTY'
FDA = 'https://download.open.fda.gov/drug/shortages/drug-shortages-0001-of-0001.json.zip'


def fetch(url, **params):
    response = requests.get(url, params=params, timeout=45, headers={'User-Agent': 'RxRadarHackathon/1.0'})
    response.raise_for_status()
    return response


def features(service, fields, order):
    rows = []
    while True:
        page = fetch(service + '/query', where='1=1', outFields=fields,
                     returnGeometry='false', orderByFields=order, resultRecordCount=1000,
                     resultOffset=len(rows), f='json').json()
        rows.extend(feature['attributes'] for feature in page['features'])
        if not page.get('exceededTransferLimit'):
            return rows


def geography():
    with ThreadPoolExecutor(max_workers=3) as pool:
        hospitals = pool.submit(features, HIFLD, 'FID,ID,NAME,CITY,STATE,TYPE,STATUS,BEDS,LATITUDE,LONGITUDE,COUNTYFIPS,OWNER', 'FID')
        risks = pool.submit(features, NRI, 'STCOFIPS,COUNTY,HRCN_RISKS,IFLD_RISKS,TRND_RISKS', 'OBJECTID')
        svi_response = fetch(SVI)
        svi_rows = csv.DictReader(io.StringIO(svi_response.content.decode('utf-8-sig')))
        scores = {r['FIPS'].zfill(5): float(r['RPL_THEMES']) for r in svi_rows if float(r['RPL_THEMES']) >= 0}
        counties = {}
        for r in risks.result():
            fips = r['STCOFIPS']
            counties[fips] = {'name': r['COUNTY'], 'svi': scores.get(fips, 0.5),
                              'sviImputed': fips not in scores}
            for field, name in [('HRCN_RISKS','nriHurricane'), ('IFLD_RISKS','nriRiverine'), ('TRND_RISKS','nriTornado')]:
                if r[field] is not None:
                    counties[fips][name] = round(r[field], 2)
        result = []
        for r in hospitals.result():
            name = r['NAME'].title()
            if r['STATUS'] == 'CLOSED':
                continue
            lat, lon = r['LATITUDE'], r['LONGITUDE']
            if not (-179 <= lon <= -64 and 17 <= lat <= 73):
                continue
            fips = str(r['COUNTYFIPS']).zfill(5)
            pediatric = bool(re.search(r"children|pediatric", name, re.I))
            beds = r['BEDS'] if r['BEDS'] > 0 else 80
            kind = ('childrens' if pediatric else 'critical_access' if 'CRITICAL' in r['TYPE']
                    else 'acute' if 'ACUTE' in r['TYPE'] else 'other')
            idx = 'hifld-' + str(r['FID'])
            if 'samaritan hospital' == name.lower() and r['CITY'].upper() == 'TROY':
                idx, name = 'samaritan-troy', 'Samaritan Hospital'
            if name.lower() in ('albany medical center hospital','albany medical center') and r['STATE'] == 'NY':
                idx, name = 'albany-medical-center', 'Albany Medical Center'
            imputed = ['rural','safetyNet','systemSize','pediatric']
            if beds != r['BEDS']:
                imputed.append('beds')
            if fips not in scores:
                imputed.append('svi')
            result.append(dict(id=idx,name=name,city=r['CITY'].title(),state=r['STATE'],lat=round(lat,4),
                               lon=round(lon,4),beds=int(beds),type=kind,rural=kind=='critical_access' or beds<40,
                               safetyNet='GOVERNMENT' in r['OWNER'],pediatric=pediatric, fips=fips,
                               svi=scores.get(fips,0.5), systemSize=max(1,round(beds/90)),
                               provenance='SIMULATED', imputed=imputed))
        save(PUBLIC / 'hospitals.json', {'hospitals': result, 'sourceIds': ['hifld','cdc-svi','assumptions']})
        save(PUBLIC / 'counties.json', {'counties': counties, 'sourceIds': ['cdc-svi','fema-nri']})
        print(f'{len(result)} hospital locations, {len(counties)} counties, {len(scores)} measured SVI ranks.')
        print([r for r in result if r['city']=='Troy' and r['state']=='NY' or 'Albany Medical' in r['name']])


def shortages():
    archive = ZipFile(io.BytesIO(fetch(FDA).content))
    data = json.loads(archive.read(archive.namelist()[0]))
    rows = []
    for r in data['results']:
        rows.append({k:r.get(k) for k in ['generic_name','initial_posting_date','status','discontinued_date','package_ndc']})
    save(CURATED / 'fda-postings.json', {'asOf':data['meta'].get('last_updated'),'records':rows})
    print(f'{len(rows)} FDA presentation records.')


if __name__ == '__main__':
    with ThreadPoolExecutor() as pool:
        list(pool.map(lambda fn: fn(), [geography, shortages]))
