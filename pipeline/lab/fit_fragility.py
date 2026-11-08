"""Fit the Storm Lab fragility coefficients to audited pharmaceutical site episodes.

Offline by default. --refresh-site-inputs retrieves and archives public GIS responses.
No shortage labels, synthetic outcomes, or assumed operating controls enter the fit.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

import numpy as np
from scipy.optimize import linprog
from scipy.special import expit

ORDER = ['intercept', 'wind', 'rain', 'rainRiver', 'sfha', 'tornado']
SEED = 20261107
RIVER_URL = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Rivers_and_Streams/FeatureServer/0/query'
FLOOD_URL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query'
HURDAT_URL = 'https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-092326.txt'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def save(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def priors(root):
    text = (root / 'web/src/sim/lab/run.ts').read_text(encoding='utf-8')
    block = text.split('export const FRAGILITY_PRIORS = [', 1)[1].split('] as const', 1)[0]
    rows = re.findall(r"key:\s*'([^']+)',\s*mean:\s*([-\d.]+),\s*sd:\s*([-\d.]+)", block)
    if [r[0] for r in rows] != ORDER:
        raise ValueError('Storm Lab prior/feature contract changed; review the fit before rebuilding.')
    return np.array([float(r[1]) for r in rows]), np.array([float(r[2]) for r in rows])


def refresh_sites(cohort):
    import requests
    out = {'retrieved': datetime.now(timezone.utc).isoformat(), 'sites': {}}
    for site_id, site in cohort['sites'].items():
        common = dict(geometry=f"{site['lon']},{site['lat']}", geometryType='esriGeometryPoint', inSR=4326, f='json')
        queries = {
            'river': (RIVER_URL, dict(common, distance=10000, units='esriSRUnit_Meter', outFields='OBJECTID', returnGeometry='true', outSR=4326)),
            'flood': (FLOOD_URL, dict(common, outFields='FLD_ZONE,SFHA_TF', returnGeometry='false')),
        }
        record = {'lon': site['lon'], 'lat': site['lat']}
        for kind, (url, params) in queries.items():
            response = requests.get(url, params=params, timeout=60)
            response.raise_for_status()
            data = response.json()
            if 'features' not in data or data.get('exceededTransferLimit'):
                raise ValueError(f'{site_id}: incomplete {kind} query: {data.get("error", "transfer limit")}')
            record[kind] = {'url': response.url, 'response': data, 'responseSha256': hashlib.sha256(response.content).hexdigest(),
                            'canonicalSha256': hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}
        out['sites'][site_id] = record
    return out


def geography(site, archived):
    if (site['lon'], site['lat']) != (archived['lon'], archived['lat']):
        raise ValueError('GIS coordinates differ from cohort coordinates')
    best = math.inf
    lon, lat = site['lon'], site['lat']
    kx = 111.32 * math.cos(math.radians(lat))
    for feature in archived['river']['response']['features']:
        for path in feature['geometry']['paths']:
            pts = [((x-lon)*kx, (y-lat)*110.57) for x, y, *_ in path]
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                dx, dy = x2-x1, y2-y1
                length2 = dx*dx + dy*dy
                t = max(0, min(1, -(x1*dx+y1*dy)/length2)) if length2 else 0
                best = min(best, math.hypot(x1+t*dx, y1+t*dy))
    # An empty complete radius query is a measured lower bound, not an assumed nearby river.
    river = min(10.0, best)
    zones = sorted({f['attributes']['FLD_ZONE'] for f in archived['flood']['response']['features']})
    if not zones:
        raise ValueError('No mapped FEMA zone; do not convert missing coverage to zone X')
    return {'riverDistKm': river, 'riverDistanceCapped': best >= 10, 'floodZones': zones,
            'sfha': any(z.startswith(('A', 'V')) for z in zones)}


def fixes_for(root, event):
    source = root / 'data/raw/hurdat2/hurdat2-1851-2025-092326.txt'
    points, active = [], False
    start, end = event['start'], event['end']
    for line in source.read_text(encoding='utf-8').splitlines():
        p = [s.strip() for s in line.split(',')]
        if re.fullmatch(r'AL\d{6}', p[0]):
            active = p[0] == event['stormId']
            continue
        if not active:
            continue
        timestamp = f'{p[0][:4]}-{p[0][4:6]}-{p[0][6:]}T{p[1][:2]}:{p[1][2:]}:00Z'
        if not start <= timestamp <= end:
            continue
        ll = lambda s: float(s[:-1]) * (-1 if s[-1] in 'WS' else 1)
        point = dict(t=timestamp, lon=ll(p[5]), lat=ll(p[4]), vmaxKt=int(p[6]))
        if int(p[7]) > 0:
            point['pcHpa'] = int(p[7])
        quads = [int(s) for s in p[8:12] if int(s) > 0]
        if quads:
            point['r34Km'] = float(np.mean(quads)) * 1.852
        if len(p) > 19 and p[19] and int(p[19]) > 0:
            point['rmwKm'] = int(p[19]) * 1.852
        points.append(point)
    if len(points) < 2:
        raise ValueError('Missing archived storm track')
    t0 = datetime.fromisoformat(points[0]['t'].replace('Z', '+00:00'))
    for point in points:
        point['hour'] = (datetime.fromisoformat(point['t'].replace('Z', '+00:00'))-t0).total_seconds()/3600
        point['origLon'], point['origLat'] = point['lon'], point['lat']
    if points[-1]['hour'] > 240 or any(b['hour'] <= a['hour'] for a, b in zip(points, points[1:])):
        raise ValueError('Track must be ordered, unique, and fit the engine 240 h horizon')
    return points


# Run the production functions in memory, exposing the existing private siteHazards
# without editing run.ts or copying its physics into a second implementation.
NODE = r"""
import fs from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const lab = path.join(input.root, 'web/src/sim/lab');
const urls = {};
for (const name of ['physics','params','terrain','track']) {
  let js = stripTypeScriptTypes(fs.readFileSync(path.join(lab, name+'.ts'), 'utf8'));
  for (const [key,url] of Object.entries(urls)) js = js.replaceAll("'./"+key+"'", JSON.stringify(url));
  urls[name] = 'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
}
const physics = await import(urls.physics), params = await import(urls.params);
const terrainFns = await import(urls.terrain), track = await import(urls.track);
const rawTerrain = JSON.parse(fs.readFileSync(path.join(input.root, 'web/public/data/terrain.json'), 'utf8'));
const eb = Buffer.from(rawTerrain.elevB64, 'base64');
const terrain = {...rawTerrain, elev:Int16Array.from({length:eb.length/2},(_,i)=>eb.readInt16LE(i*2)), land:new Uint8Array(Buffer.from(rawTerrain.landB64,'base64')),source:'terrain.json'};
const phys = params.physFrom(JSON.parse(fs.readFileSync(path.join(input.root,'web/public/data/model/physics_params.json'),'utf8')));
const runText = fs.readFileSync(path.join(lab,'run.ts'),'utf8');
const fragment = runText.slice(runText.indexOf('function siteHazards('),runText.indexOf('function coefSamples('));
if (!fragment.startsWith('function siteHazards(') || fragment.includes('function coefSamples')) throw Error('Engine extraction contract changed');
const hazard = new Function('physics', stripTypeScriptTypes('const {clamp,shearStep,symmetricVmax,windStep,flowStep,rainStep,kmPerDegLon,KM_PER_DEG_LAT,windVec,rainRate,shearFactor,orographicAdd,KT,tornadoPotential}=physics;\n'+fragment)+'\nreturn siteHazards;')(physics);
const rows = [];
for (const event of input.events) {
  const cfg = {...params.DEFAULT_LAB};
  const p = track.buildPath(event.fixes,cfg,12,phys,terrain);
  const tr = track.deriveTrack(p,cfg,phys,terrain);
  const sites = event.sites.map(s=>{const [gx,gy]=terrainFns.gradAt(terrain,s.lon,s.lat);return {...s,gx,gy,relief:terrainFns.reliefAt(terrain,s.lon,s.lat)};});
  const w = new Float32Array(sites.length),r = new Float32Array(sites.length),t = new Float32Array(sites.length);
  hazard(tr,sites,phys,cfg,w,r,t);
  sites.forEach((s,i)=>rows.push({eventId:event.id,plantId:s.id,windKt:w[i],rainIn:r[i],effectiveRainIn:r[i]*Math.min(1.6,1+s.relief/1500),reliefM:s.relief,riverDistKm:s.riverDistKm,sfha:s.sfha,tornadoProbability:1-Math.exp(-t[i]),tornadoIntegratedPotential:t[i]}));
}
process.stdout.write(JSON.stringify({rows,config:params.DEFAULT_LAB,physics:phys}));
"""


def compute_hazards(root, cohort, site_inputs):
    events, tracks = [], {}
    for event in cohort['events']:
        if not event.get('stormId'):
            continue
        fixes = fixes_for(root, event)
        tracks[event['id']] = {'fixes': fixes, 'sourceUrl': HURDAT_URL, 'stormId': event['stormId']}
        ids = sorted({r['plantId'] for r in cohort['observations'] if r['eventId'] == event['id']})
        sites = []
        for sid in ids:
            site = cohort['sites'][sid]
            sites.append(dict(id=sid, **site, **geography(site, site_inputs['sites'][sid])))
        events.append(dict(id=event['id'], fixes=fixes, sites=sites))
    result = subprocess.run(['node', '--no-warnings', '--input-type=module', '-e', NODE],
                            input=json.dumps(dict(root=str(root), events=events)), text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f'Production-engine hazard reconstruction failed:\n{result.stderr[-3000:]}')
    payload = json.loads(result.stdout)
    files = ['run.ts', 'physics.ts', 'params.ts', 'terrain.ts', 'track.ts']
    payload['provenance'] = {
        'kind': 'archived-best-track-engine-reconstruction', 'observedSiteWindOrRain': False,
        'trackSourceUrl': HURDAT_URL, 'trackSha256': sha(root/'data/raw/hurdat2/hurdat2-1851-2025-092326.txt'),
        'engineSha256': {f: sha(root/'web/src/sim/lab'/f) for f in files},
        'terrainSha256': sha(root/'web/public/data/terrain.json'),
        'terrainSourceUrls': ['https://registry.opendata.aws/terrain-tiles/', 'https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-land/'],
        'physicsFileSha256': sha(root/'web/public/data/model/physics_params.json'),
        'soilMultiplier': 1, 'windowRule': 'Fixed calendar windows surrounding landfall, selected before fitting; no outcome-tuned hazard values.',
        'limitations': ['Wind/rain/tornado are modeled from observed archived tracks, not weather station or plant measurements.',
                       'Engine defaults for unobserved shear, soil and missing storm size are structural assumptions, not observations.',
                       'Current FEMA/NHD-derived maps and approximate site points are not historical parcel surveys.',
                       'Retrospective best track must not be presented as a forecast available before the disaster.'],
    }
    payload['tracks'] = tracks
    for row in payload['rows']:
        row['siteInputKey'] = row['plantId']
        row['inputProvenance'] = {k: site_inputs['sites'][row['plantId']][k]['url'] for k in ('river', 'flood')}
    return payload


def features(h):
    raw = np.array([h[k] for k in ('windKt', 'effectiveRainIn', 'riverDistKm', 'tornadoProbability')], float)
    if not np.isfinite(raw).all() or (raw < 0).any() or raw[-1] > 1 or type(h['sfha']) is not bool:
        raise ValueError('Invalid or missing raw hazard; do not impute it for fitting')
    rr = math.log1p(h['effectiveRainIn']/4)
    return [1., max(0., h['windKt']-50)/50, rr, rr*math.exp(-h['riverDistKm']/1.5), rr*int(h['sfha']), h['tornadoProbability']]


def training_rows(cohort, hazards):
    sources = {s['id']: s for s in cohort['sources']}
    if len(sources) != len(cohort['sources']):
        raise ValueError('Duplicate evidence source')
    observed, excluded, seen = [], [], set()
    by_key = {(r['eventId'], r['plantId']): r for r in hazards['rows']}
    for row in cohort['observations']:
        key = row['eventId'], row['plantId']
        if key in seen:
            raise ValueError('Duplicate event/site episode would double-count evidence')
        seen.add(key)
        if not row.get('sourceIds') or any(s not in sources for s in row['sourceIds']):
            raise ValueError('Outcome missing an auditable source')
        if row.get('labelOrigin') != 'primary-company-report':
            raise ValueError('Synthetic, inferred, aggregate, and secondary outcome labels are not allowed')
        if row['disrupted'] is None or not row['fitEligible']:
            excluded.append(dict(row, exclusionReason=row['exclusionReason']))
            continue
        if type(row['disrupted']) is not bool or row['status'] not in ('confirmed_disruption', 'confirmed_operating', 'confirmed_planned_restart'):
            raise ValueError('Ambiguous label cannot enter the likelihood')
        if row['disrupted'] != (row['status'] == 'confirmed_disruption'):
            raise ValueError('Outcome contradicts status definition')
        if key not in by_key:
            raise ValueError('Labeled episode lacks sourced hazards')
        observed.append(dict(row, hazards=by_key[key], x=features(by_key[key])))
    if len({r['disrupted'] for r in observed}) != 2:
        raise ValueError('A positive-only cohort cannot replace the expert fallback')
    return observed, excluded


def log_likelihood(beta, x, y, weights):
    eta = x @ beta
    return float(weights @ (y*eta - np.logaddexp(0, eta)))


def sample_posterior(x, y, mu, sd, seed=SEED, draws=1024, burn=512, weights=None):
    """Four elliptical-slice chains under independent normal coefficient priors."""
    weights = np.ones(len(y)) if weights is None else np.asarray(weights)
    chains = []
    for chain in range(4):
        rng = np.random.default_rng(seed+chain)
        z = rng.normal(size=len(mu))
        ll = log_likelihood(mu+sd*z, x, y, weights)
        kept = []
        for step in range(burn+draws):
            direction = rng.normal(size=len(mu))
            threshold = ll + math.log(max(rng.random(), 1e-300))
            angle = rng.uniform(0, 2*math.pi)
            lo, hi = angle-2*math.pi, angle
            for _ in range(10000):
                proposal = z*math.cos(angle)+direction*math.sin(angle)
                candidate = log_likelihood(mu+sd*proposal, x, y, weights)
                if candidate >= threshold:
                    z, ll = proposal, candidate
                    break
                if angle < 0:
                    lo = angle
                else:
                    hi = angle
                angle = rng.uniform(lo, hi)
            else:
                raise RuntimeError('Slice sampler failed to find an acceptable state')
            if step >= burn:
                kept.append(mu+sd*z)
        chains.append(kept)
    return np.asarray(chains)


def diagnostics(chains):
    # Conventional split R-hat and Geyer initial-positive-pair ESS, not rank-normalized.
    m, n, k = chains.shape
    half = n//2
    split = np.concatenate([chains[:, :half], chains[:, -half:]], axis=0)
    w = split.var(axis=1, ddof=1).mean(axis=0)
    v = (half-1)/half*w + split.mean(axis=1).var(axis=0, ddof=1)
    rhat = np.sqrt(v/w)
    centered = chains-chains.mean(axis=1, keepdims=True)
    fft = np.fft.rfft(centered, n=2*n, axis=1)
    ac = np.fft.irfft(fft*fft.conjugate(), n=2*n, axis=1)[:, :n].mean(axis=0)
    ac /= np.arange(n, 0, -1)[:, None]
    ac /= ac[0]
    ess = []
    for j in range(k):
        total, previous = 0., math.inf
        for t in range(1, n-1, 2):
            pair = float(ac[t, j]+ac[t+1, j])
            if pair < 0:
                break
            pair = min(pair, previous)
            total += pair
            previous = pair
        ess.append(min(m*n, m*n/max(1, 1+2*total)))
    return {'splitRhat': dict(zip(ORDER, rhat.tolist())), 'effectiveSampleSize': dict(zip(ORDER, ess)),
            'maxRhat': float(max(rhat)), 'minESS': float(min(ess)), 'chains': m, 'drawsPerChain': n,
            'method': 'conventional split R-hat and initial-positive-pair autocorrelation ESS; diagnostics do not establish calibration'}


def score(y, p):
    p = np.clip(p, 1e-12, 1-1e-12)
    return {'n': len(y), 'brier': float(np.mean((p-y)**2)),
            'logLoss': float(-np.mean(y*np.log(p)+(1-y)*np.log1p(-p))),
            'observedRate': float(np.mean(y)), 'meanPredicted': float(np.mean(p))}


def validate(rows, mu, sd):
    x = np.asarray([r['x'] for r in rows])
    y = np.asarray([r['disrupted'] for r in rows], float)
    groups = np.asarray([r['eventId'] for r in rows])
    prior = np.random.default_rng(SEED).normal(mu, sd, size=(16384, len(mu)))
    prior_p = expit(x @ prior.T).mean(axis=1)
    predictions, folds = [], []
    for event in sorted(set(groups)):
        held = groups == event
        chains = sample_posterior(x[~held], y[~held], mu, sd, seed=SEED+100, draws=1024)
        samples = chains.reshape(-1, len(mu))
        p = expit(x[held] @ samples.T).mean(axis=1)
        # Jeffreys-smoothed training prevalence, estimated within the fold only.
        baseline = (y[~held].sum()+0.5)/(sum(~held)+1)
        fold = {'heldOutEvent': event, 'trainIds': [r['id'] for r, keep in zip(rows, ~held) if keep],
                'testIds': [r['id'] for r, keep in zip(rows, held) if keep],
                'fit': score(y[held], p), 'prior': score(y[held], prior_p[held]),
                'trainingPrevalenceBaseline': score(y[held], np.full(sum(held), baseline)),
                'diagnostics': diagnostics(chains)}
        folds.append(fold)
        for i, predicted in zip(np.flatnonzero(held), p):
            predictions.append({'id': rows[i]['id'], 'eventId': event, 'plantId': rows[i]['plantId'],
                                'observed': int(y[i]), 'predicted': float(predicted), 'priorPredicted': float(prior_p[i]),
                                'trainingPrevalencePredicted': float(baseline)})
    yy = np.array([r['observed'] for r in predictions])
    pp = np.array([r['predicted'] for r in predictions])
    calibration = []
    for low, high in [(0, .2), (.2, .5), (.5, .8), (.8, 1.000001)]:
        mask = (pp >= low) & (pp < high)
        interval = None
        if mask.any():
            n, rate, z = int(mask.sum()), float(yy[mask].mean()), 1.95996398454
            center = (rate+z*z/(2*n))/(1+z*z/n)
            half = z*math.sqrt(rate*(1-rate)/n+z*z/(4*n*n))/(1+z*z/n)
            interval = [max(0, center-half), min(1, center+half)]
        calibration.append({'low': low, 'high': min(1, high), 'observedRateWilson95': interval,
                            **(score(yy[mask], pp[mask]) if mask.any() else {'n': 0, 'meanPredicted': None, 'observedRate': None})})
    signed = (2*y[:, None]-1)*x
    separation = linprog(np.zeros(x.shape[1]), A_ub=-signed, b_ub=-np.ones(len(y)), bounds=[(None, None)]*x.shape[1], method='highs')
    return {'scheme': 'leave-one-whole-storm-out likelihood diagnostics; fixed priors and feature transforms; no hyperparameter tuning',
            'operationallyCalibrated': False, 'independentValidation': False,
            'priorKnowledgeOverlap': ['helene-2024'],
            'priorKnowledgeCaveat': 'The existing rainRiver prior explicitly cites North Cove/Helene. Removing held-out likelihood rows does not remove this prior event knowledge. These scores are conditional diagnostics, not independent generalization estimates.',
            'folds': folds, 'predictions': predictions,
            'metrics': score(yy, pp), 'priorMetrics': score(yy, np.array([r['priorPredicted'] for r in predictions])),
            'eventMacroMetrics': {k: float(np.mean([f['fit'][k] for f in folds])) for k in ('brier', 'logLoss')},
            'trainingPrevalenceMetrics': score(yy, np.array([r['trainingPrevalencePredicted'] for r in predictions])),
            'calibrationBins': calibration, 'designRank': int(np.linalg.matrix_rank(x)),
            'coefficientCount': x.shape[1], 'eventCount': len(set(groups)),
            'completeSeparation': bool(separation.success),
            'identification': 'Six effects are not empirically established by three storms. Priors make the posterior proper; this is an evidence update, not operational calibration.'}


def build(root, output, refresh=False):
    curated = output/'data/curated'
    cohort_path = curated/'fragility_cohort.json'
    if not cohort_path.exists():
        cohort_path = root/'data/curated/fragility_cohort.json'
    cohort = read(cohort_path)
    cache_path = curated/'fragility_site_inputs.json'
    if refresh:
        save(cache_path, refresh_sites(cohort))
    site_inputs = read(cache_path if cache_path.exists() else root/'data/curated/fragility_site_inputs.json')
    hazards = compute_hazards(root, cohort, site_inputs)
    rows, excluded = training_rows(cohort, hazards)
    mu, sd = priors(root)
    x = np.asarray([r['x'] for r in rows])
    y = np.asarray([r['disrupted'] for r in rows], float)
    chains = sample_posterior(x, y, mu, sd)
    diag = diagnostics(chains)
    if diag['maxRhat'] > 1.05 or diag['minESS'] < 200:
        raise RuntimeError(f'Posterior sampler did not pass convergence checks: {diag}')
    samples = chains.reshape(-1, len(ORDER))
    # The worker consumes a prefix: distribute that prefix across the four chains.
    samples = samples[np.random.default_rng(SEED+77).permutation(len(samples))]
    validation = validate(rows, mu, sd)
    counts = Counter(r['eventId'] for r in rows)
    weights = [1/counts[r['eventId']] for r in rows]
    balanced = sample_posterior(x, y, mu, sd, weights=weights).reshape(-1, len(ORDER))
    weaker = sample_posterior(x, y, mu, 2*sd).reshape(-1, len(ORDER))
    validation['sensitivity'] = {
        'eventBalanced': {'interpretation': 'Power likelihood: each storm has total weight one; not the primary Bernoulli posterior.', 'weights': weights, 'postMean': balanced.mean(axis=0).tolist()},
        'doublePriorSd': {'postMean': weaker.mean(axis=0).tolist()},
        'primaryPostMean': samples.mean(axis=0).tolist(),
    }
    limitations = [
        'Only six pharmaceutical event-site observations from three storms, selected through public reporting. No industrial domain transfer or synthetic labels.',
        'The unobserved population denominator and selective reporting prevent interpreting fitted probabilities as population outage rates.',
        'Four positives and two nonfailures do not establish six independent hazard effects. Strong expert priors dominate poorly supported directions.',
        'Repeated sites, shared companies, and storm-wide utility failures violate independent-site assumptions; leave-one-storm-out scores and event-balanced sensitivity expose part of this limit.',
        'Operating means explicit company confirmation; a planned precautionary shutdown with confirmed restart and no serious impact is a nonfailure for material disruption, not zero downtime.',
        'Site production disruption is distinct from national shortage or patient supply. Amgen is positive despite uninterrupted patient supply.',
        'Wind, rainfall and tornado covariates are retrospective engine reconstructions from HURDAT2, conditional on default shear/soil/structure and coarse topography; not observed site weather.',
        'Current map flood zones/river geometry and approximate site points may differ from historical parcel conditions. Unknown GIS coverage never becomes a non-SFHA control.',
        'Rocky Mount 2023 has a verified outage but no compatible tropical-cyclone tornado covariate. It is excluded; direct EF3 intensity is not the engine tornado probability.',
        'Existing rainRiver prior cites North Cove/Helene: leave-one-storm-out removes likelihood rows but not prior event knowledge. Scores are not independent validation.',
        'No operational calibration claim, validated false-alarm rate, causal hazard coefficient, or recovery-duration fit is supported.',
    ]
    features_out = [dict(feature=k, label=k, priorMean=float(mu[i]), priorSd=float(sd[i]),
                         postMean=float(samples[:, i].mean()), postSd=float(samples[:, i].std(ddof=1)),
                         q05=float(np.quantile(samples[:, i], .05)), q95=float(np.quantile(samples[:, i], .95)),
                         rationale='Published site-outcome likelihood updates the Storm Lab expert normal prior; sparse, selected cohort.') for i, k in enumerate(ORDER)]
    model = dict(name='Evidence-updated pharmaceutical fragility (Bayesian logistic)', modelVersion='fragility-fit-v1',
                 featureOrder=ORDER, samples=np.round(samples, 8).tolist(), features=features_out,
                 nEvents=int(y.sum()), nNonEvents=int(len(y)-y.sum()), nStorms=len(counts), nExcluded=len(excluded),
                 events=[dict(plantId=r['plantId'], event=r['eventId'], date=r['date'], disrupted=r['disrupted'], sourceIds=r['sourceIds']) for r in rows],
                 notes=limitations, provenance='MODEL', evidenceStatus='sparse-evidence-update', operationallyCalibrated=False,
                 training=dict(method='Bernoulli logistic likelihood + independent normal expert priors; elliptical slice MCMC',
                               priorSource='web/src/sim/lab/run.ts#FRAGILITY_PRIORS', seed=SEED, burnInPerChain=512,
                               diagnostics=diag, sampleOrder='seeded shuffle of joint draws from four chains', labelDefinition=cohort['outcomeDefinition'],
                               cohortSha256=sha(cohort_path), hazardsSha256=None),
                 validation=validation,
                 evidenceUrl='/data/model/fragility_evidence.json', validationUrl='/data/model/fragility_validation.json')
    save(curated/'fragility_hazards.json', hazards)
    model['training']['hazardsSha256'] = sha(curated/'fragility_hazards.json')
    evidence = dict(outcomeDefinition=cohort['outcomeDefinition'], sources=cohort['sources'], observations=rows,
                    exclusions=excluded, sites=cohort['sites'], hazardProvenance=hazards['provenance'], notes=limitations)
    public = output/'web/public/data/model'
    save(public/'fragility_model.json', model)
    save(public/'fragility_validation.json', validation)
    save(public/'fragility_evidence.json', evidence)
    print(json.dumps(dict(nFit=len(rows), nPositive=int(y.sum()), nNegative=int(len(y)-y.sum()), nExcluded=len(excluded),
                          metrics=validation['metrics'], priorMetrics=validation['priorMetrics'], diagnostics=diag,
                          designRank=validation['designRank'], separation=validation['completeSeparation'])))
    return model


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--output-root', type=Path)
    parser.add_argument('--refresh-site-inputs', action='store_true')
    args = parser.parse_args()
    build(args.root.resolve(), (args.output_root or args.root).resolve(), args.refresh_site_inputs)
