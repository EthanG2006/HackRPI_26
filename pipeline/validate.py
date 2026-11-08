"""Validate the data contracts and guard against temporal leakage in generated replay snapshots."""
from .common import PUBLIC, read


def validate():
    ids={s['id'] for s in read(PUBLIC/'sources.json')}
    hospitals=read(PUBLIC/'hospitals.json')['hospitals']
    assert len({h['id'] for h in hospitals})==len(hospitals)
    def sources(value):
        if isinstance(value,dict):
            assert not set(value.get('sourceIds',[]))-ids, value.get('sourceIds')
            for v in value.values():
                sources(v)
        elif isinstance(value,list):
            for v in value:
                sources(v)
    for path in PUBLIC.rglob('*.json'):
        sources(read(path))
    for sid in ['helene','maria','rocky-mount']:
        sc=read(PUBLIC/'scenarios'/f'{sid}.json')
        snapshots=sc['predictionSnapshots']
        assert snapshots[0]['t']==sc['start']
        assert [x['t'] for x in snapshots]==sorted(x['t'] for x in snapshots)
        assert snapshots[0]['impact']['patientsProtected']==0
        assert all(r['hospitalsAtRisk']==0 for r in snapshots[0]['drugRisk'])
        if sc.get('alert'):
            alert=sc['alert']
            assert alert['cutoff']==alert['t']<alert['actualEventT']
            weather=read(PUBLIC/'storms'/f'{sid}.json')
            assert any(h['t']==alert['t'] and h['p']>=alert['threshold'] for h in sc['hazard'])
            assert all(x['impact']['patientsProtected']==0 for x in snapshots if x['t']<alert['t'])
            # Re-evaluating after truncating every forecast to the cutoff must return the same score.
            from .scenarios import historical_hazard
            from copy import deepcopy
            truncated=deepcopy(weather)
            for key in ['rainfall','spc']:
                truncated[key]=[r for r in weather.get(key,[]) if r['issued']<=alert['cutoff']]
            truncated['storm']['advisories']=[r for r in weather['storm']['advisories'] if r['issued']<=alert['cutoff']]
            plant=next(p for p in read(PUBLIC/'plants.json') if p['id']==alert['plantId'])
            assert historical_hazard(truncated,plant)[-1]['p']==alert['prob']
        for snapshot in snapshots:
            for risk in snapshot['drugRisk']:
                assert 0<=risk['ci'][0]<=risk['risk']<=risk['ci'][1]<=1
                band=risk['supplyCurve']
                assert all(len(v)==90 for v in band.values())
                assert all(0<=a<=b<=c<=1 for a,b,c in zip(band['p10'],band['p50'],band['p90']))
            for band in snapshot['hospitalStockouts'].values():
                assert all(len(v)==len(hospitals) for v in band.values())
                assert all(a<=b<=c for a,b,c in zip(band['p10'],band['p50'],band['p90']))
    print('Validated source references, forecast cutoffs, arrays, risk intervals and supply bands.')


if __name__=='__main__':
    validate()
