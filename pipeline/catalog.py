"""Curated medicine descriptions and auditable links between presentation families and sites."""
from collections import defaultdict
import networkx as nx
from .common import CURATED, PUBLIC, read, save

# id, display name, ATC-style grouping, assumed units / 100 staffed beds / day
PRODUCTS = '''
sodium-chloride-0-9-iv|0.9% Sodium Chloride|IV fluids|90
sodium-chloride-minibag|0.9% Sodium Chloride minibags|Small-volume IV|60
lactated-ringers-iv|Lactated Ringer’s|IV fluids|52
dextrose-5-iv|5% Dextrose|IV fluids|26
peritoneal-dialysis-solution|Peritoneal Dialysis Solution|Dialysis|16
dextrose-50-inj|50% Dextrose|Emergency|5
sterile-water-inj|Sterile Water for Injection|IV fluids|18
sodium-bicarbonate-inj|Sodium Bicarbonate|Electrolytes|8
potassium-chloride-inj|Potassium Chloride|Electrolytes|15
magnesium-sulfate-inj|Magnesium Sulfate|Electrolytes|4
calcium-gluconate-inj|Calcium Gluconate|Electrolytes|3
cisplatin-inj|Cisplatin|Oncology|2
carboplatin-inj|Carboplatin|Oncology|2
methotrexate-inj|Methotrexate|Oncology|2
fluorouracil-inj|Fluorouracil|Oncology|3
vincristine-inj|Vincristine|Oncology|1
cytarabine-inj|Cytarabine|Oncology|1
heparin-inj|Heparin Sodium|Anticoagulation|32
epinephrine-inj|Epinephrine|Emergency|3
norepinephrine-inj|Norepinephrine|Critical care|5
vasopressin-inj|Vasopressin|Critical care|3
atropine-inj|Atropine Sulfate|Emergency|4
amiodarone-inj|Amiodarone|Cardiac care|3
lidocaine-inj|Lidocaine|Anesthesia|12
bupivacaine-inj|Bupivacaine|Anesthesia|5
ondansetron-inj|Ondansetron|Supportive care|18
morphine-inj|Morphine Sulfate|Analgesia|15
hydromorphone-inj|Hydromorphone|Analgesia|5
fentanyl-inj|Fentanyl Citrate|Anesthesia|9
midazolam-inj|Midazolam|Anesthesia|6
ketamine-inj|Ketamine|Anesthesia|3
dexamethasone-inj|Dexamethasone|Supportive care|7
furosemide-inj|Furosemide|Cardiac care|12
naloxone-inj|Naloxone|Emergency|2
cefazolin-inj|Cefazolin|Antibiotics|11
vancomycin-inj|Vancomycin|Antibiotics|10
penicillin-g-benzathine-inj|Penicillin G Benzathine|Antibiotics|2
albuterol-inhalation|Albuterol inhalation solution|Respiratory|17
amoxicillin-oral-susp|Amoxicillin oral suspension|Antibiotics|5
dobutamine-inj|Dobutamine|Critical care|3
potassium-phosphates-inj|Potassium Phosphates|Electrolytes|8
'''.strip()
DRUGS=[line.split('|') for line in PRODUCTS.splitlines()]
FLUIDS = [DRUGS[i][0] for i in (0,2,3,4,6)]
TORNADO = ['sodium-bicarbonate-inj','atropine-inj','potassium-phosphates-inj','dobutamine-inj']
MARIA = ['sodium-chloride-minibag']


def make_catalog():
    counties=read(PUBLIC/'counties.json')['counties']
    specs=[
        ('baxter-north-cove','Baxter North Cove','Baxter','Marion','NC',35.835,-82.004,'37111',FLUIDS,[.58,.54,.4,.73,.28],'aha-north-cove'),
        ('pfizer-rocky-mount','Pfizer Rocky Mount','Pfizer','Rocky Mount','NC',36.045,-77.777,'37127',TORNADO,[.45,.41,.37,.36],'pfizer-products'),
        ('baxter-jayuya-pr','Baxter Jayuya','Baxter','Jayuya','PR',18.218,-66.59,'72073',MARIA,[.58],'baxter-maria'),
        ('b-braun-irvine','B. Braun Irvine','B. Braun','Irvine','CA',33.69,-117.86,'06059',FLUIDS[:3],[.16,.17,.16],'braun'),
        ('b-braun-daytona-beach','B. Braun Daytona Beach','B. Braun','Daytona Beach','FL',29.17,-81.075,'12127',FLUIDS[:3],[.12,.13,.12],'braun'),
        ('gulf-stand-in','Gulf Coast reserve site','Illustrative supplier','Houston','TX',29.76,-95.37,'48201',FLUIDS[:3]+TORNADO,[.1,.12,.12,.14,.16,.23,.28],'assumptions'),
        ('central-stand-in','Midwest injectable site','Illustrative supplier','Chicago','IL',41.88,-87.7,'17031',[r[0] for r in DRUGS if r[0] not in FLUIDS+MARIA],None,'assumptions'),
    ]
    plants=[]
    for idx,name,co,city,state,lat,lon,fips,drugids,shares,source in specs:
        county= counties.get(fips,{})
        shares=shares or [.26]*len(drugids)
        plants.append(dict(id=idx,name=name,company=co,city=city,state=state,country='US',lat=lat,lon=lon,
                           drugIds=drugids,share=dict(zip(drugids,shares)),shareProvenance='SIMULATED',
                           linkConfidence=.55 if source=='assumptions' else .82,sterileInjectable=True,
                           provenance='SIMULATED' if source=='assumptions' else 'REAL',sourceIds=[source,'assumptions'],
                           nri={k:county[v] for k,v in [('hurricane','nriHurricane'),('riverine','nriRiverine'),('tornado','nriTornado')] if v in county},
                           notes='Approximate site location. Product-specific market shares are scenario assumptions.'))
    essential={'sodium-chloride-0-9-iv','lactated-ringers-iv','dextrose-5-iv','cisplatin-inj','carboplatin-inj','methotrexate-inj','heparin-inj','epinephrine-inj','morphine-inj','atropine-inj','amoxicillin-oral-susp'}
    drugs=[]
    for i,(idx,name,group,demand) in enumerate(DRUGS):
        isfluid=idx in FLUIDS+MARIA
        distribution=[p['share'][idx] for p in plants if idx in p['share']]
        residual=1-sum(distribution)
        form='bag' if isfluid else 'bottle' if idx.endswith(('susp','inhalation')) else 'vial'
        drug=dict(id=idx,name=name,shortName=name,form='solution' if form=='bag' else 'injection' if form=='vial' else 'suspension' if idx.endswith('susp') else 'inhalation',
                  sterileInjectable=form!='bottle',whoEssential=idx in essential,noAlternative=False,
                  pediatric=idx=='amoxicillin-oral-susp',manufacturers=len(distribution)+2,hhi=round(1e4*(sum(x*x for x in distribution)+residual**2/2)),
                  contractPricePerUnit=round((5 if isfluid else 11)+(i%5)*.8,2),unit=form,grayMarketMultiplier=2.5,
                  dailyUsePer100Beds=int(demand),provenance='MODEL',sourceIds=['openfda','assumptions','who-eml'])
        drug['class']=group
        drug['alternatives']=[dict(name='Pharmacy-approved equivalent', note='Review approved presentations and available pack sizes with the wholesaler.')]
        drug['conservation']=[dict(strategy='Review nonessential use',note='A pharmacist and clinical team review local protocols and patient eligibility.')]
        if idx in FLUIDS[:3]+MARIA:
            drug['conservation']=[dict(strategy='Review oral hydration eligibility',note='Use a pharmacist-approved protocol for clinically appropriate patients.',sourceIds=['ashp-guidance'])]
        drugs.append(drug)
    return drugs,plants


def network(drugs,plants,hospitals):
    graph=nx.DiGraph()
    edges=[]
    dcs=[]
    for city,state,lon,lat in [('Atlanta','GA',-84.39,33.75),('Memphis','TN',-90.05,35.15),('Albany','NY',-73.76,42.65),
                              ('Dallas','TX',-96.8,32.78),('Chicago','IL',-87.63,41.88),('Riverside','CA',-117.4,33.95)]:
        idx=city.lower()
        dcs.append(dict(id=idx,name=city+' distribution hub',company='Simulated network',city=city,state=state,lon=lon,lat=lat,provenance='SIMULATED',sourceIds=['assumptions']))
    def node(kind,idx,label):
        nid=('dc' if kind=='distributor' else kind)+':'+idx
        graph.add_node(nid,kind=kind,label=label,refId=idx)
        return nid
    def edge(src,dst,kind,conf,prov,evidence):
        if graph.has_edge(src,dst):
            return
        graph.add_edge(src,dst)
        edges.append(dict(source=src,target=dst,kind=kind,confidence=conf,provenance=prov,evidence=evidence))
    names={d['id']:d['name'] for d in drugs}
    flows=[]
    for p in plants:
        pid=node('plant',p['id'],p['name'])
        lid=node('labeler',p['company'].lower().replace(' ','-'),p['company'])
        edge(lid,pid,'made-at',p['linkConfidence'],p['provenance'],p['sourceIds'][0])
        for idx in p['drugIds']:
            edge(node('drug',idx,names[idx]),lid,'labeled-by',p['linkConfidence'],p['provenance'],p['sourceIds'][0])
        for dc in sorted(dcs,key=lambda d:(d['lat']-p['lat'])**2+(.8*(d['lon']-p['lon']))**2)[:3]:
            edge(pid,node('distributor',dc['id'],dc['name']),'ships-to',.4,'SIMULATED','Geographic proximity; no transaction records.')
            flows.append(dict(plantId=p['id'],dcId=dc['id'],drugIds=p['drugIds'],volume=max(p['share'].values())))
    save(PUBLIC/'network.json',dict(nodes=[dict(id=k,**v) for k,v in graph.nodes(data=True)],edges=edges,flows=flows,sourceIds=['assumptions','aha-north-cove','pfizer-products','baxter-maria']))
    save(PUBLIC/'distributors.json',dcs)
    # Downstream relationship is deliberately synthetic and stored separately from published site evidence.
    for h in hospitals:
        nearest=min(dcs,key=lambda d:(h['lat']-d['lat'])**2+(.8*(h['lon']-d['lon']))**2)
        graph.add_edge('dc:'+nearest['id'],'hospital:'+h['id'],provenance='SIMULATED')
    from .common import PROCESSED
    import pandas as pd
    PROCESSED.mkdir(parents=True,exist_ok=True)
    nx.to_pandas_edgelist(graph).to_parquet(PROCESSED/'network.parquet',index=False)
