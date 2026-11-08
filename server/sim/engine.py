"""Vectorized perturbations and plant-to-hospital inventory depletion for drawn tracks."""
from time import perf_counter
import hashlib
import json
import numpy as np
from . import catalog


def simulate(track, category, speed, members):
    before=perf_counter()
    plants,drugs,hospitals=catalog.data()
    path=np.array(track,dtype=float)
    east=lambda lat:111.2*np.maximum(.05,np.cos(np.radians(lat)))
    wrap=lambda v:(v+540)%360-180
    dist=np.hypot(wrap(np.diff(path[:,0]))*east((path[:-1,1]+path[1:,1])/2),np.diff(path[:,1])*111.2)
    hours=np.r_[0.,np.cumsum(dist)/(speed*1.852)]
    sigma=np.interp(hours,[0,12,24,36,48,60,72,96,120],[0,25,39,49,62,77,95,134,200])*1.852/np.sqrt(-2*np.log(1/3))
    seed=int.from_bytes(hashlib.sha256(json.dumps([track,category,speed,members]).encode()).digest()[:8],"little")
    rng=np.random.default_rng(seed)
    offsets=rng.normal(size=(members,len(path),2))
    for k in range(1,len(path)):
        offsets[:,k]=.88*offsets[:,k-1]+np.sqrt(1-.88**2)*offsets[:,k]
    pos=path[None,:,:]+offsets*sigma[None,:,None]/np.stack([east(path[:,1]),np.full(len(path),111.2)],axis=1)[None,:,:]
    pos[:,:,0]=wrap(pos[:,:,0]);pos[:,:,1]=np.clip(pos[:,:,1],-85,85)
    losses=[];outages=[];recover=12+category*4+8/speed
    for plant in plants:
        scale=east(plant["lat"])
        ax=wrap(pos[:,:-1,0]-plant["lon"])*scale; ay=(pos[:,:-1,1]-plant["lat"])*111.2
        bx=wrap(np.diff(pos[:,:,0],axis=1))*scale; by=np.diff(pos[:,:,1],axis=1)*111.2
        t=np.clip(-(ax*bx+ay*by)/np.maximum(1e-6,bx**2+by**2),0,1)
        nearest=np.min(np.hypot(ax+t*bx,ay+t*by),axis=1)
        hazard=np.clip((.42+category*.105)*np.exp(-(nearest/(45+category*30))**2)*(1+min(.16,1/speed)),0,1)
        loss=(rng.random(members)<hazard); losses.append(loss)
        prob=float(loss.mean()); err=1.282*np.sqrt((prob*(1-prob)+.001)/members)
        outages.append(dict(plantId=plant["id"],pDisrupt=round(prob,3),ci=[round(max(0,prob-err),3),round(min(1,prob+err),3)],
                            outageDays=dict(p10=round(recover*.65) if prob>.9 else 0,p50=round(recover) if prob>.5 else 0,p90=round(recover*1.45) if prob>.1 else 0)))
    beds=np.array([max(1,h["beds"]) for h in hospitals])
    opening=2.5+np.minimum(5,np.log1p(beds)/1.45)-1.3*np.array([h["rural"] for h in hospitals])-.7*np.array([h["svi"]>=.75 for h in hospitals])
    risks=[];stockouts={}; days=np.arange(90)
    losses=np.array(losses)
    for drug in drugs:
        share=np.array([p["share"].get(drug["id"],0.) for p in plants])
        members_loss=np.clip(share@losses,0,.98)
        lo,med,hi=np.quantile(members_loss,[.1,.5,.9],method="lower")
        baseline=drug["baselineRisk"];extra=(1-baseline)*float(members_loss.mean())
        supply={}; stock={}
        for key,loss in [("p10",hi),("p50",med),("p90",lo)]:
            deficit=loss*np.clip((days-2)/7,0,1)*np.exp(-np.maximum(0,days-10)/recover)
            supply[key]=(1-deficit).round(3).tolist()
            stocks=np.searchsorted(np.cumsum(deficit),opening+(not drug["sterileInjectable"]))
            stock[key]=np.where(stocks<90,stocks,999).tolist()
        stockouts[drug["id"]]=stock
        risks.append(dict(drugId=drug["id"],risk=round(baseline+extra,3),ci=[round(baseline+(1-baseline)*lo,3),round(baseline+(1-baseline)*hi,3)],
                          supplyCurve=supply,hospitalsAtRisk=sum(d<999 for d in stock["p50"]),firstStockoutDay=min(stock["p50"],default=999),
                          shap=[dict(feature="baseline",label="Baseline supply fragility",value=baseline),dict(feature="ensemble",label="Weather-exposed manufacturing share",value=round(extra,3))]))
    risks.sort(key=lambda d:-d["risk"])
    exposed=max(risks,key=lambda d:d["hospitalsAtRisk"])
    drug=next(d for d in drugs if d["id"]==exposed["drugId"])
    stocks=np.array(stockouts[drug["id"]]["p50"])
    at_risk=stocks<=30;count=int(at_risk.sum())
    restored=np.where(at_risk,beds*drug["dailyUsePer100Beds"]/100*np.minimum(3,31-stocks)*.25,0).sum()
    patients=round(restored/4); savings=round(restored*drug["contractPricePerUnit"]*(drug["grayMarketMultiplier"]-1))
    staff=count*2*40;freight=restored/100*.05*800*.52/1000; waste=restored*.03*.001
    vulnerable=float(np.mean(np.array([h["svi"]>=.75 for h in hospitals])[at_risk])) if count else 0
    def item(key,label,value,unit,assumption):
        return dict(key=key,label=label,value=value,unit=unit,assumption=assumption,provenance="SIMULATED")
    impact=dict(patientsProtected=patients,dollarsSaved=savings+staff,co2TonsAvoided=round(freight+waste,3),highSviPreventedPct=vulnerable,
                breakdown=dict(patients=[item("protected","Encounters protected",patients,"patients","Restore one-quarter of up to three shortage days. Four units support one encounter.")],
                               dollars=[item("price","Purchasing savings",savings,"USD","Recovered units times excess modeled markup."),item("staff","Staff time saved",staff,"USD","Two hours per exposed facility at $40/hour.")],
                               co2=[item("freight","Freight and waste avoided",round(freight+waste,3),"t CO₂e","Assume 50 kg per 100 units, 800 km, a 0.52 kg/t-km air/road difference and 3% waste avoided.")],
                               equity=[item("equity","Share in high-SVI counties",round(vulnerable*100),"%","Projected share served assuming equal intervention success.")]))
    return dict(engine="numpy",elapsedMs=round((perf_counter()-before)*1000,1),members=members,sampleTracks=pos[:36].round(4).tolist(),
                outages=outages,drugRisk=risks,hospitalStockouts=stockouts,impact=impact)
