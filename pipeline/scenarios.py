"""Archived forecast counterfactuals and a vectorized, inventory-conserving 90-day cascade."""
from datetime import datetime
import numpy as np
from scipy.special import expit
from shapely.geometry import shape, Point
from .common import PUBLIC, PROCESSED, read, save
from .catalog import FLUIDS, MARIA, TORNADO

PRIOR_MEAN=np.array([-3.8,3.8,4.6,2.1])
PRIOR_SD=np.array([.65,.65,.55,.8])
PRIOR_LABELS=['Intercept','Excessive rainfall category','Forecast hurricane exposure','Tornado probability']


def elapsed(a,b):
    return (datetime.fromisoformat(b.replace('Z','+00:00'))-datetime.fromisoformat(a.replace('Z','+00:00'))).total_seconds()/3600


def inside(coords,lon,lat):
    kind='Polygon' if isinstance(coords[0][0][0],(int,float)) else 'MultiPolygon'
    return shape(dict(type=kind,coordinates=coords)).covers(Point(lon,lat))


def historical_hazard(storm,plant):
    """Only archived products issued no later than each evaluation timestamp enter the score."""
    advisories=storm.get('storm',{}).get('advisories',[])
    timestamps=sorted({x['issued'] for x in advisories+storm.get('rainfall',[])+storm.get('spc',[])})
    weights=np.random.default_rng(2026).normal(PRIOR_MEAN,PRIOR_SD,(2048,4))
    rows=[]
    for t in timestamps:
        known=[a for a in advisories if a['issued']<=t]
        wind=0.
        distance=9999.
        if known:
            forecast=known[-1]['forecast']
            for p in forecast:
                d=np.hypot((p['lat']-plant['lat'])*111,(p['lon']-plant['lon'])*111*np.cos(np.radians(plant['lat'])))
                distance=min(distance,d)
                wind=max(wind,min(1.,p['vmaxKt']/115)*np.exp(-(d/180)**2))
        category=None
        latest={}
        for outlook in storm.get('rainfall',[]):
            if outlook['issued']<=t and outlook['validEnd']>t:
                latest[outlook['day']]=outlook
        order=['MRGL','SLGT','MDT','HIGH']
        levels=[a['category'] for o in latest.values() for a in o['areas'] if inside(a['polygon'],plant['lon'],plant['lat'])]
        if levels:
            category=max(levels,key=order.index)
        rain={None:0,'MRGL':.1,'SLGT':.25,'MDT':.6,'HIGH':1}[category]
        tor=0.
        spc=[o for o in storm.get('spc',[]) if o['issued']<=t]
        if spc:
            for a in spc[-1]['areas']:
                if inside(a['polygon'],plant['lon'],plant['lat']):
                    tor=max(tor,float(a['label']) if a['label'].replace('.','').isdigit() else 0)
        x=np.array([1,rain,wind,tor])
        lo,med,hi=np.quantile(expit(weights@x),[.1,.5,.9])
        rows.append(dict(t=t,plantId=plant['id'],p=round(float(med),3),lo=round(float(lo),3),hi=round(float(hi),3),
                         inputs=dict(eroCategory=category,minDistKm=round(float(distance),1),tornadoProb=tor),
                         forecastWindExposure=round(float(wind),3)))
    return rows


def cascade(drug,loss,opening,recovery):
    days=np.arange(90)
    curve={}
    bands={}
    for key,scale,buffer in [('p10',1.22,.72),('p50',1,1),('p90',.78,1.28)]:
        deficit=np.clip(loss*scale,0,.95)*np.clip((days-1)/4,0,1)*np.exp(-np.maximum(0,days-recovery)/22)
        curve[key]=np.round(1-deficit,3).tolist()
        # Each hospital starts with a simulated buffer. Daily consumption is one normalized unit.
        stock=np.array(opening)*buffer
        depleted=np.full(len(stock),999)
        for day,supply in enumerate(1-deficit):
            stock+=supply
            depleted[(stock<1-1e-8)&(depleted==999)]=day
            stock=np.maximum(0,stock-1)
        bands[key]=depleted.tolist()
    return curve,bands


def impact_placeholder():
    return dict(patientsProtected=0,dollarsSaved=0,co2TonsAvoided=0,highSviPreventedPct=0,
                breakdown={k:[] for k in ('patients','dollars','co2','equity')})


def build(drugs,plants,hospitals):
    baselines=read(PROCESSED/'replay-baselines.json')
    definitions=[
        ('helene','Hurricane Helene','North Cove, NC · September 2024','2024-09-23T15:00:00Z','2024-10-12T00:00:00Z',
         '2024-09-27T04:00:00Z','baxter-north-cove',FLUIDS,32,dict(longitude=-83.3,latitude=27.5,zoom=4.2,pitch=25)),
        ('rocky-mount','Rocky Mount tornado','Nash County, NC · July 2023','2023-07-19T06:03:00Z','2023-08-31T00:00:00Z',
         '2023-07-19T16:25:00Z','pfizer-rocky-mount',TORNADO,25,dict(longitude=-77.8,latitude=36,zoom=8,pitch=35)),
        ('maria','Hurricane Maria','Puerto Rico · September 2017','2017-09-16T21:00:00Z','2017-10-31T00:00:00Z',
         '2017-09-20T10:15:00Z','baxter-jayuya-pr',MARIA,38,dict(longitude=-65,latitude=18.2,zoom=5.6,pitch=35)),
    ]
    for sid,name,subtitle,start,end,failure,plant_id,hero,recovery,camera in definitions:
        plant=next(p for p in plants if p['id']==plant_id)
        storm=read(PUBLIC/'storms'/f'{sid}.json')
        hazard=historical_hazard(storm,plant)
        triggered=next((r for r in hazard if r['p']>=.52 and r['t']<failure),None)
        # The tornado had low broad-area probabilities. A high-confidence site prediction is unsupported.
        if sid=='rocky-mount':
            triggered=None
        events=[dict(t=a['issued'],kind='advisory',label='NHC advisory '+a['num'],provenance='REPLAY',sourceIds=['nhc-gis']) for a in storm.get('storm',{}).get('advisories',[])]
        notes=['Inventories, routing, contract prices, per-product shares and recovery durations are planning assumptions. Bands span inventory and recovery sensitivity.',
               'Historical weather products enter at their issue timestamp. Retrospective supply metadata and the present FDA snapshot limit this counterfactual to a forecast replay.']
        if sid=='helene':
            events.extend([
                dict(t='2024-09-25T08:24:00Z',kind='outlook',label='WPC High Risk issued',detail='First High Risk area in the region. North Cove enters High Risk in the 19:31Z update.',provenance='REPLAY',sourceIds=['iem-outlooks'],pin=True),
                dict(t='2024-09-27T03:10:00Z',kind='landfall',label='Florida landfall',provenance='REAL',sourceIds=['helene-report'],pin=True),
                dict(t=failure,kind='plant-hit',label='North Cove flood day',detail='Sep 27 local date verified. 04:00Z is local midnight, a conservative lower bound for timing.',provenance='REAL',sourceIds=['baxter-helene'],pin=True),
                dict(t='2024-10-09T04:00:00Z',kind='allocation',label='Allocations increase',detail='Baxter increased highest-demand IV allocations to 60% on Oct 9. Intraday time is unspecified.',provenance='REAL',sourceIds=['baxter-allocation'],pin=True),
                dict(t='2024-10-11T04:00:00Z',kind='other',label='FDA supply update',detail='FDA reported inadequate national supply of lactated Ringers, 70% dextrose and PD solution. This is a publication date.',provenance='REAL',sourceIds=['fda-helene'],pin=True)])
            notes.append('Plant-failure hour is unpublished. Flood-day midnight is the lower bound for alert lead time. The Sep 25 19:31Z High Risk polygon contains the North Cove point.')
        elif sid=='maria':
            events.append(dict(t=failure,kind='landfall',label='Puerto Rico landfall',detail='NHC estimated landfall near Yabucoa at 10:15Z. Used as a disruption reference; site shutdown time is unavailable.',provenance='REAL',sourceIds=['maria-report'],pin=True))
            events.append(dict(t='2017-10-24T04:00:00Z',kind='other',label='FDA testimony',detail='FDA described Maria worsening existing IV-solution shortages.',provenance='REAL',sourceIds=['fda-maria'],pin=True))
            notes.append('Maria affects small-volume parenteral bags in this replay. Large-volume IV solutions were not manufactured by Baxter in Puerto Rico.')
        else:
            events.append(dict(t=failure,kind='plant-hit',label='EF3 tornado begins',detail='Surveyed tornado window 16:25–16:58Z. Exact warehouse impact minute is unavailable.',provenance='REAL',sourceIds=['nws-tornado'],pin=True))
            events.append(dict(t='2023-08-03T04:00:00Z',kind='allocation',label='Emergency order process',detail='Pfizer restricted selected high-medical-need presentations to emergency direct orders.',provenance='REAL',sourceIds=['pfizer-products'],pin=True))
            notes.append('The broad SPC 2% tornado outlook did not justify an early site-specific disruption alert. This case is retained as a missed-event sensitivity example.')
        s=dict(id=sid,name=name,subtitle=subtitle,start=start,end=end,day0=failure,heroPlantIds=[plant_id],heroDrugIds=hero,camera=camera,
               events=events,hazard=hazard,outages=[],drugRisk=[],hospitalStockouts={},inventoryDoh={},
               impact=impact_placeholder(),provenance='MODEL',notes=notes)
        if triggered:
            t=triggered['t']
            adv=next((a for a in reversed(storm['storm']['advisories']) if a['issued']<=t),None)
            products=[f"NHC advisory {adv['num']} · {adv['issued']}"] if adv else []
            products.extend([f"WPC day {o['day']} · {o['issued']}" for o in storm.get('rainfall',[]) if o['issued']==t])
            lead=round(elapsed(t,failure),2)
            s['alert']=dict(t=t,cutoff=t,productsUsed=products,plantId=plant_id,prob=triggered['p'],probCI=[triggered['lo'],triggered['hi']],
                            threshold=.52,leadTimeHours=lead,actualEventT=failure,drivers=['Archived forecast hazard intersects a concentrated supply site.',
                            'All hospitals receive the same planning alert. Inventory and site shares require operational confirmation.'],
                            message=f"{plant['name']} is exposed to severe weather. Review IV supply buffers and activate a coordinated pharmacy plan.")
            s['backtest']=dict(scenarioId=sid,alertT=t,plantFailureT=failure,leadTimeHours=lead,
                               notes=('Lead time is a conservative lower bound against local flood-day midnight. ' if sid=='helene' else 'Lead time uses Puerto Rico landfall as the disruption reference. ') +
                               'Weather issue timestamps are respected. Priors, static supply links, and current FDA snapshot make this a retrospective counterfactual with no prospective validation.')
            s['events'].append(dict(t=t,kind='alert',label='Rx Radar planning alert',provenance='MODEL',sourceIds=['assumptions'],pin=True))
        p=triggered['p'] if triggered else max([h['p'] for h in hazard] or [.08])
        # The complete conditional outage scenario is preserved for the allocation policy comparison.
        s['outages']=[dict(plantId=plant_id,pDisrupt=p,ci=[triggered['lo'],triggered['hi']] if triggered else [.01,.19],
                           outageDays=dict(p10=round(recovery*.7),p50=recovery,p90=round(recovery*1.45)))]
        beds=np.array([h['beds'] for h in hospitals])
        rural=np.array([h['rural'] for h in hospitals])
        high=np.array([h['svi']>=.75 for h in hospitals])
        opening=2.4+np.minimum(4.5,np.log1p(beds)/1.4)-1.1*rural-.6*high
        for drug in drugs:
            did=drug['id']
            base=baselines[start[:4]][did]['baselineRisk']
            loss=plant['share'].get(did,0)
            weather=(1-base)*loss*p
            curve,bands=cascade(drug,loss,opening,recovery)
            if loss:
                s['hospitalStockouts'][did]=bands
                s['inventoryDoh'][did]=opening.round(2).tolist()
            s['drugRisk'].append(dict(drugId=did,risk=round(base+weather,3),
                                      ci=[round(max(0,base-.04+weather*.65),3),round(min(.99,base+.06+weather*1.3),3)],
                                      supplyCurve=curve,hospitalsAtRisk=sum(d<999 for d in bands['p50']),
                                      firstStockoutDay=min(bands['p50']),
                                      shap=[dict(feature='baseline',label='Earlier FDA posting pattern',value=round(base,3)),
                                            dict(feature='weather',label='Forecast hazard × assumed site share',value=round(weather,3))]))
        s['drugRisk'].sort(key=lambda r:-r['risk'])
        s['events'].sort(key=lambda r:r['t'])
        snapshots=[]
        selected=[]
        previous=-1.
        for h in hazard:
            if h['t']<=start:
                continue
            if not selected or abs(h['p']-previous)>=.08 or triggered and h['t']==triggered['t']:
                selected.append(h)
                previous=h['p']
        # An explicit baseline exists even before the first archived product.
        baseline=dict(t=start,plantId=plant_id,p=0.,lo=0.,hi=0.)
        for h in [baseline]+selected:
            risks=[]
            stocks={}
            for d in drugs:
                did=d['id']
                base=baselines[start[:4]][did]['baselineRisk']
                share=plant['share'].get(did,0.)
                loss=share*h['p']
                curve,band=cascade(d,loss,opening,recovery)
                weather=(1-base)*loss
                if share:
                    stocks[did]=band
                risks.append(dict(drugId=did,risk=round(base+weather,3),
                                  ci=[round(base+(1-base)*share*h['lo'],3),round(base+(1-base)*share*h['hi'],3)],
                                  supplyCurve=curve,hospitalsAtRisk=sum(day<999 for day in band['p50']),firstStockoutDay=min(band['p50']),
                                  shap=[dict(feature='baseline',label='Earlier FDA posting pattern',value=round(base,3)),
                                        dict(feature='weather',label='Issued forecast hazard × assumed share',value=round(weather,3))]))
            risks.sort(key=lambda r:-r['risk'])
            snapshots.append(dict(t=h['t'],drugRisk=risks,hospitalStockouts=stocks,
                                  outages=[dict(plantId=plant_id,pDisrupt=h['p'],ci=[h['lo'],h['hi']],outageDays=dict(p10=0,p50=recovery if h['p']>=.5 else 0,p90=recovery if h['p']>=.1 else 0))],
                                  hazardProbability=h['p'],impact=impact_placeholder()))
        s['predictionSnapshots']=sorted(snapshots,key=lambda row:row['t'])
        s['notes'].append('Timeline snapshots use expected supply loss = assumed site share × the latest selected issued-forecast hazard score. Updates occur at meaningful hazard changes and the alert. Equity comparison conditions on an outage.')
        save(PUBLIC/'scenarios'/f'{sid}.json',s)
        save(PUBLIC/'events'/f'{sid}.json',s['events'])
        print(sid,'alert',triggered and triggered['t'],'max p',p,'hero stockouts',next(r['hospitalsAtRisk'] for r in s['drugRisk'] if r['drugId']==hero[0]))
    save(PUBLIC/'model/hazard_model.json',dict(name='Prior-predictive Bayesian logistic hazard score',
        features=[dict(feature=str(i),label=l,priorMean=float(m),priorSd=float(sd),postMean=float(m),postSd=float(sd),
                       rationale='Prototype expert assumption; coefficient posterior equals prior because a labeled control cohort is unavailable.') for i,(l,m,sd) in enumerate(zip(PRIOR_LABELS,PRIOR_MEAN,PRIOR_SD))],
        nEvents=0,nNonEvents=0,events=[],provenance='MODEL',notes=[
            '2,048 draws from explicit normal coefficient priors produce the displayed 80% prior-predictive intervals. No posterior training claims are made.',
            'Rainfall inputs use polygon intersections at issuance. Wind exposure uses the latest archived forecast path and intensity. The score is uncalibrated.',
            'The July 2023 tornado remains a missed-event example. Three curated disasters cannot identify false-alarm rates or support calibrated site outage probabilities.']))


def apply_impacts():
    """Derive all displayed benefits from the bundled allocation comparison and explicit unit assumptions."""
    for path in (PUBLIC/'scenarios').glob('*.json'):
        s=read(path)
        eq=read(PUBLIC/'equity'/path.name)
        market=eq['policies']['market']
        fair=eq['policies']['rxradar']
        avoided=max(0,market['metrics']['patientsDelayed']-fair['metrics']['patientsDelayed'])
        high=np.array([h['svi']>=.75 for h in read(PUBLIC/'hospitals.json')['hospitals']])
        saved=(np.array(market['stockoutDay'])<999)&(np.array(fair['stockoutDay'])==999)
        equity=float((saved&high).sum()/max(1,saved.sum()))
        dollars=avoided*48
        units=avoided*4
        # Prototype freight factors are explicit sensitivity assumptions, not a certified lifecycle analysis.
        tonnes=units*.0005*1200*(.6-.08)/1000
        def item(key,label,value,unit,assumption):
            return dict(key=key,label=label,value=round(value,2),unit=unit,assumption=assumption,provenance='SIMULATED',sourceIds=['assumptions'])
        s['impact']=dict(patientsProtected=avoided,dollarsSaved=dollars,co2TonsAvoided=round(tonnes,1),highSviPreventedPct=round(equity,3),
            breakdown=dict(
                patients=[item('encounters','Potential delayed encounters avoided',avoided,'encounters','Difference between market and fair allocation. Four unfilled units represent one delayed encounter; unique patients are unavailable.')],
                dollars=[item('admin','Administrative disruption avoided',dollars,'USD','Avoided delayed encounters × $48 assumed administrative cost. Contract savings and cancelled procedures are excluded from this total.')],
                co2=[item('freight','Planned shipment substitution',tonnes,'t CO₂e','Four units per avoided encounter × 0.5 kg × 1,200 km × assumed (0.60 air − 0.08 ground) kg CO₂e per tonne-km. Shipment count and mode are simulated.'),
                     item('waste','Stock expiry avoidance',0,'units','Waste is not quantified because observed expiry and purchasing records are unavailable.')],
                equity=[item('high-svi','Share of prevented facility stockouts in high-SVI counties',equity*100,'%', 'Hospitals in counties with CDC SVI ≥ 0.75 among those stocked out under market and protected under fair allocation.')]))
        from copy import deepcopy
        for snapshot in s.get('predictionSnapshots',[]):
            chance=snapshot['hazardProbability']
            # Benefits require an actionable alert. A watch-stage forecast has no intervention assigned.
            benefit_chance=chance if s.get('alert') and snapshot['t']>=s['alert']['t'] else 0.
            expected=deepcopy(s['impact'])
            for field in ('patientsProtected','dollarsSaved','co2TonsAvoided'):
                expected[field]=round(expected[field]*benefit_chance,1 if field=='co2TonsAvoided' else 0)
            if benefit_chance==0:
                expected['highSviPreventedPct']=0
            for category in ('patients','dollars','co2'):
                for line in expected['breakdown'][category]:
                    line['value']=round(line['value']*benefit_chance,2)
                    line['assumption']+=' Expected value weighted by the forecast-only hazard score after an actionable alert. Benefits are zero before the intervention.'
            if benefit_chance==0:
                for line in expected['breakdown']['equity']:
                    line['value']=0
            snapshot['impact']=expected
        save(path,s)
