"""Time-split FDA posting benchmark. Reporting bias and the target definition are part of the model card."""
from collections import defaultdict
import re
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn import metrics
from .common import CURATED, PUBLIC, PROCESSED, read, save

FEATURES=['parenteral','priorYears','previousYear','recentPostings','yearsSincePosting','pastPackagers']
LABELS=['Parenteral presentation','Earlier years with postings','Posting in previous year','Presentations posted in preceding 3 years','Years since last posting','Previously reported NDC labelers']


def family(name):
    s=name.lower().replace('’',"'")
    s=re.sub(r'\b(for|and|in) injection\b',' injection',s)
    return re.sub(r'[^a-z0-9 ]+',' ',s).strip()


def train(drugs):
    snapshot=read(CURATED/'fda-postings.json')
    history=defaultdict(list)
    for row in snapshot['records']:
        if not row['initial_posting_date'] or not row['generic_name'] or row['status']=='To Be Discontinued':
            continue
        year=int(row['initial_posting_date'][-4:])
        history[family(row['generic_name'])].append((year,(row['package_ndc'] or '').split('-')[0]))
    keys=list(sorted(history))
    def features(name,year):
        records=history.get(name,[])
        prior=[(y,lab) for y,lab in records if y<year]
        years={y for y,_ in prior}
        return [int(any(t in name for t in ('inject','intravenous','parenteral'))),len(years),
                int(year-1 in years),sum(y>=year-3 for y,_ in prior),year-max(years) if years else 20,
                len({lab for _,lab in prior if lab})]
    rows=[]
    for year in range(2015,2026):
        for name in keys:
            rows.append([year,name,*features(name,year),int(any(y==year for y,_ in history[name]))])
    frame=pd.DataFrame(rows,columns=['year','family',*FEATURES,'posted'])
    past=frame[frame.year<=2021]
    test=frame[frame.year>=2022]
    def fit(df):
        model=lgb.LGBMClassifier(n_estimators=55,learning_rate=.045,num_leaves=7,min_child_samples=18,reg_lambda=2,verbosity=-1,n_jobs=1,random_state=37)
        model.fit(df[FEATURES],df.posted)
        return model.booster_
    model=fit(past)
    pred=model.predict(test[FEATURES])
    truth=test.posted.to_numpy()
    roc_x,roc_y,_=metrics.roc_curve(truth,pred)
    precision,recall,_=metrics.precision_recall_curve(truth,pred)
    def points(x,y):
        return [dict(x=round(float(a),5),y=round(float(b),5)) for a,b in zip(x,y)]
    calibration=[]
    for subset in np.array_split(np.argsort(pred),6):
        calibration.append(dict(predicted=round(float(pred[subset].mean()),4),observed=round(float(truth[subset].mean()),4),n=len(subset)))
    impacts=model.predict(test[FEATURES],pred_contrib=True)
    mse=metrics.brier_score_loss(truth,pred)
    results=dict(rocAuc=metrics.roc_auc_score(truth,pred),prAuc=metrics.average_precision_score(truth,pred),
                 brier=mse,baseRate=float(truth.mean()))
    limitations=['Target is an FDA shortage-presentation posting in the next calendar year. Families enter this retrospective cohort if they ever appear in the downloaded file.',
                 'Resolved records can disappear from the current snapshot. Unreported shortages and never-listed products are outside the validation cohort.',
                 'Training features use earlier postings only. Public NDC labeler counts describe the current catalog. Historic purchasing volume, NADAC trends, contract prices, and hospital-level outcome labels are unavailable.',
                 'Hospital-type, rurality and region discrimination cannot be estimated from national product labels. Inventory, care delays, and savings are simulations.']
    fairness=[]
    for inj,label in [(1,'Parenteral'),(0,'Other presentations')]:
        mask=test.parenteral.to_numpy()==inj
        fairness.append(dict(group='Dosage form',slice=label,n=int(mask.sum()),brier=float(metrics.brier_score_loss(truth[mask],pred[mask])),
                             rocAuc=float(metrics.roc_auc_score(truth[mask],pred[mask]))))
    for label in ['Children’s / adult','Rural / urban','US region']:
        fairness.append(dict(group='Hospital validation',slice=label,n=0,flag='No observed facility-level outcome labels'))
    report=dict(name='FDA posting risk · LightGBM',version='1.0',trainedAt=snapshot['asOf'],shapUnits='log-odds',
                split='Train 2015–2021. Held out 2022–2025, including all full years. FDA posting families × years.',
                nTrain=len(past),nTest=len(test),metrics={k:round(float(v),5) for k,v in results.items()},
                roc=points(roc_x,roc_y),pr=points(recall,precision),calibration=calibration,
                featureImportance=[dict(feature=f,label=l,meanAbsShap=round(float(abs(impacts[:,i]).mean()),5)) for i,(f,l) in enumerate(zip(FEATURES,LABELS))],
                fairness=fairness,limitations=limitations,provenance='MODEL',sourceIds=['openfda'])
    save(PUBLIC/'model/risk_model.json',report)
    PROCESSED.mkdir(parents=True,exist_ok=True)
    frame.to_parquet(PROCESSED/'drug-year-features.parquet',index=False)
    # Leave every hospital event and weather product out of training; case-specific outputs use only previous years.
    cutoffs={}
    for year in (2017,2023,2024,2026):
        fit_frame=frame[frame.year<year]
        fitted=fit(fit_frame)
        draw=[fit(fit_frame.sample(frac=1,replace=True,random_state=seed)) for seed in range(12)]
        result={}
        for d in drugs:
            # Presentation family names in the FDA file include strength and route.
            token=d['shortName'].lower().split(' ')[0]
            if token in ('0.9%','50%','5%','peritoneal','lactated'):
                fragment={'0.9%':'sodium chloride','50%':'dextrose','5%':'dextrose','peritoneal':'peritoneal dialysis','lactated':'lactated ringer'}[token]
            else:
                fragment=token
            matches=[k for k in keys if re.search(r'\b'+re.escape(fragment)+r'\b',k) and (not d['sterileInjectable'] or any(word in k for word in ('inject','infus','solution','dialysis')))]
            proxy=min(matches,key=len) if matches else family(d['name']+' '+d['form'])
            x=np.array([features(proxy,year)])
            p=float(fitted.predict(x,num_threads=1)[0])
            values=[float(b.predict(x,num_threads=1)[0]) for b in draw]
            lo,hi=np.quantile(values,[.1,.9])
            shap=fitted.predict(x,pred_contrib=True,num_threads=1)[0]
            result[d['id']]=dict(baselineRisk=round(p,4),baselineRiskCI=[round(min(p,lo),4),round(max(p,hi),4)],
                                 shap=[dict(feature=f,label=l,value=round(float(v),4)) for f,l,v in zip(FEATURES,LABELS,shap)],
                                 shapBase=round(float(shap[-1]),4),pastShortages=sum(y<year for y,_ in history.get(proxy,[])),
                                 currentlyShort=any(family(r['generic_name'] or '')==proxy and r['status']=='Current' for r in snapshot['records']),
                                 matchedFDAFamily=proxy if matches else None)
        cutoffs[year]=result
    for d in drugs:
        d.update(cutoffs[2026][d['id']])
    save(PROCESSED/'replay-baselines.json',{str(y):v for y,v in cutoffs.items() if y!=2026})
    print('FDA validation',report['nTrain'],report['nTest'],report['metrics'])
    return cutoffs
