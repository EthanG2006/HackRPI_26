"""Recover supplier statements from FDA labels and score location-aware DECRS candidates."""
import argparse
import csv
import io
import re
import zipfile
from concurrent.futures import ThreadPoolExecutor
from rapidfuzz.fuzz import token_set_ratio
import requests
from .common import CURATED, RAW, PUBLIC, PROCESSED, read, save

LABEL_QUERIES=[
    ('sodium-chloride-0-9-iv','openfda.manufacturer_name:Baxter AND openfda.generic_name:"SODIUM CHLORIDE" AND openfda.route:INTRAVENOUS'),
    ('lactated-ringers-iv','openfda.generic_name:LACTATED'),
    ('dextrose-5-iv','openfda.manufacturer_name:Baxter AND openfda.generic_name:DEXTROSE'),
    ('sodium-bicarbonate-inj','openfda.manufacturer_name:Hospira AND openfda.generic_name:"SODIUM BICARBONATE"'),
    ('atropine-inj','openfda.manufacturer_name:Hospira AND openfda.generic_name:"ATROPINE"'),
]


def fetch_evidence():
    path=RAW/'drls_reg.zip'
    if not path.exists():
        r=requests.get('https://www.accessdata.fda.gov/cder/drls_reg.zip',timeout=45)
        r.raise_for_status()
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(r.content)
    archive=zipfile.ZipFile(path)
    rows=csv.DictReader(io.StringIO(archive.read('drls_reg.txt').decode('utf-8-sig',errors='replace')),delimiter='\t')
    firms=[]
    for row in rows:
        row={k.strip():v.strip() for k,v in row.items() if k is not None and v is not None}
        if re.search(r'baxter|braun|hospira|pfizer|vantive',row['FIRM_NAME'],re.I):
            firms.append({k:row[k] for k in ('FEI_NUMBER','FIRM_NAME','ADDRESS','EXPIRATION_DATE','OPERATIONS')})
    save(CURATED/'registrations.json',dict(retrieved='2026-11-07',records=firms))
    def labels(pair):
        drug,query=pair
        response=requests.get('https://api.fda.gov/drug/label.json',params=dict(search=query,limit=20),timeout=30)
        if response.status_code==404:
            return []
        response.raise_for_status()
        return [dict(drugId=drug,labelId=r['id'],effective=r['effective_time'],
                     suppliers=r.get('openfda',{}).get('manufacturer_name',[]),
                     statements=[s for field in ('spl_unclassified_section','package_label_principal_display_panel','how_supplied')
                                 for s in r.get(field,[]) if re.search(r'manufactur|distributed|hospira|baxter',s,re.I)])
                for r in response.json().get('results',[])]
    evidence=[]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for group in pool.map(labels,LABEL_QUERIES):
            evidence.extend(group)
    save(CURATED/'label-evidence.json',dict(retrieved='2026-11-07',records=evidence))
    print(f'{len(evidence)} labels, {len(firms)} relevant registration records.')


def resolve(plants):
    registrations=read(CURATED/'registrations.json')['records']
    evidence=read(CURATED/'label-evidence.json')['records']
    output=[]
    for label in evidence:
        text=' '.join(label['statements'])
        # Explicit manufacturer/distributor role survives into the output. Addresses require separate matches.
        statements=re.findall(r'(?:manufactured (?:by|for|in)|distributed by)[\s\S]{0,190}',text,re.I)
        for supplier in label['suppliers']:
            candidates=[]
            for firm in registrations:
                name=token_set_ratio(supplier.lower(),firm['FIRM_NAME'].lower())/100
                address=firm['ADDRESS'].split(',')
                # City and company are tested independently so a headquarters cannot silently become a plant.
                city=address[1].strip().lower() if len(address)>1 else ''
                role_text=' '.join(statements)
                location=bool(len(city)>2 and re.search(r'\b'+re.escape(city)+r'\b',role_text,re.I))
                score=.60*name+.40*location
                if name>.55:
                    candidates.append(dict(fei=firm['FEI_NUMBER'],name=firm['FIRM_NAME'],address=firm['ADDRESS'],
                                           nameSimilarity=round(name,3),locationEvidence=location,confidence=round(score,3)))
            candidates.sort(key=lambda r:-r['confidence'])
            output.append(dict(drugId=label['drugId'],labelId=label['labelId'],effective=label['effective'],supplier=supplier,
                               roleStatements=statements[:4],candidates=candidates[:3],
                               accepted=bool(candidates and candidates[0]['locationEvidence'] and candidates[0]['confidence']>.87),
                               provenance='MODEL',sourceIds=['openfda-label','fda-decrs']))
    for plant in plants:
        if plant['provenance']=='SIMULATED':
            continue
        matches=[f for f in registrations if re.search(r'\b'+re.escape(plant['city'])+r'\b',f['ADDRESS'],re.I)]
        if matches:
            best=max(matches,key=lambda f:token_set_ratio(plant['company'].lower(),f['FIRM_NAME'].lower()))
            if token_set_ratio(plant['company'].lower(),best['FIRM_NAME'].lower())>55 or plant['id']=='pfizer-rocky-mount' and 'Hospira' in best['FIRM_NAME']:
                plant.update(fei=best['FEI_NUMBER'],address=best['ADDRESS'])
                plant['sourceIds'].append('fda-decrs')
    save(PUBLIC/'model/entity_resolution.json',dict(method='Structured label metadata and role-statement extraction with rapidfuzz company matching plus explicit city evidence.',
         nLabels=len(evidence),accepted=sum(r['accepted'] for r in output),links=output,
         notes=['Company-only matches remain unaccepted. Labeler registration cannot establish the exact manufacturing site.',
                'Current registration records are validation evidence. They are excluded from historical alert scoring.'],
         provenance='MODEL',sourceIds=['openfda-label','fda-decrs']))
    import pandas as pd
    pd.DataFrame([dict(drugId=r['drugId'],labelId=r['labelId'],supplier=r['supplier'],accepted=r['accepted']) for r in output]).to_parquet(PROCESSED/'label-resolution.parquet',index=False)
    return output


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--refresh',action='store_true')
    args=parser.parse_args()
    if args.refresh:
        fetch_evidence()
    plants=read(PUBLIC/'plants.json')
    resolve(plants)
    save(PUBLIC/'plants.json',plants)
