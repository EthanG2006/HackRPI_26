// Storm Lab methods: equations, cited constants, priors, diagnostics and a live check against the record.
import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { FRAGILITY_PRIORS } from '../sim/lab/run';
import type { ParamEntry } from '../types';

const CHAIN: [string, string][] = [
  ['Track & timing', 'Best-track fixes (NOAA HURDAT2) or drawn points, resampled hourly. A stall holds position.'],
  ['Intensity', 'Follows the record or your target over water; over land V(t) = V_b + (R·V₀ − V_b)·e^(−αt) (Kaplan & DeMaria 1995).'],
  ['Wind field', 'Holland (1980) gradient profile with Coriolis; R_max from Willoughby et al. (2006); B from V_max and ΔP; reduced to 10 m; inflow angle; translation asymmetry (Lin & Chavas 2012).'],
  ['Rain', 'R-CLIPER radial rain rate (Tuleya et al. 2007) × shear asymmetry (PHRaM, Lonfat et al. 2007) + upslope rain P = ε·ρ·q_s·(V·∇h) (Smith 1979).'],
  ['Tornadoes', 'Parametric TC-tornado potential: 160–400 km band, right-front quadrant, peaking after landfall (Schultz & Cecil climatology).'],
  ['Ensemble', 'Members perturbed along and across track with AR(1) errors scaled to the NHC 2026 cone (σ = R/√(2 ln 3)); intensity errors from NHC 2021–25 verification; lognormal R_max spread.'],
  ['Plants', 'Bayesian logistic fragility on site wind, basin-adjusted rain, river proximity, flood zone and tornado odds; coefficients drawn from expert priors; lognormal outage durations.'],
  ['Supply', 'Per member: plants offline until restart, then linear ramp-back; national supply = 1 − Σ share × loss + capped surge; hospitals stock out when cumulative deficit exceeds days on hand.'],
];

export default function LabMethod() {
  const r = useApp((s) => s.whatif.result), fixes = useApp((s) => s.whatif.fixes);
  const [params, setParams] = useState<ParamEntry[]>([]);
  useEffect(() => void fetch(`${import.meta.env.BASE_URL}data/model/physics_params.json`).then((x) => (x.ok ? x.json() : [])).then(setParams).catch(() => setParams([])), []);
  const d = r?.diagnostics;

  // Live validation: modelled inland decay vs the observed best track over land.
  let check: { n: number; mae: number; bias: number } | null = null;
  if (r?.series && fixes?.length) {
    const s = r.series, errs: number[] = [];
    for (const f of fixes) {
      const i = s.hours.indexOf(Math.round(f.hour ?? -1));
      if (i < 0 || !s.land[i] || f.vmaxKt === undefined) continue;
      errs.push(s.vmax.p50[i] - f.vmaxKt);
    }
    if (errs.length) check = { n: errs.length, mae: errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length, bias: errs.reduce((a, e) => a + e, 0) / errs.length };
  }

  return (
    <div className="sl-method">
      <ol className="sl-chain">{CHAIN.map(([k, v]) => <li key={k}><b>{k}</b><span>{v}</span></li>)}</ol>

      {check && (
        <div className="sl-card">
          <div className="sl-card-head"><span>Check against the record</span></div>
          <p className="sl-check num">Inland decay vs HURDAT2 over land: MAE {check.mae.toFixed(1)} kt, bias {check.bias >= 0 ? '+' : ''}{check.bias.toFixed(1)} kt ({check.n} fixes).</p>
          <p className="sl-hint">Compares the ensemble median to observed best-track winds after landfall. Rain is not checked here: the model omits predecessor rain events and frontal interaction.</p>
        </div>
      )}

      <div className="sl-card">
        <div className="sl-card-head"><span>Physical constants</span><small>{params.length} cited</small></div>
        <div className="sl-params">
          {params.filter((p) => p.key !== 'wpr_pairs' && p.key !== 'rc_u_def').map((p) => (
            <details key={p.key}>
              <summary><span>{p.label}</span><b className="num">{p.value}<small> {p.unit !== '-' ? p.unit : ''}</small></b>{/UNVERIFIED|SIGN RESTORED/.test(p.note ?? '') && <em title="See note">check</em>}</summary>
              <p>{p.citation}</p>
              {p.note && <p className="sl-note">{p.note}</p>}
            </details>
          ))}
          {!params.length && <p className="sl-hint">Constants file unavailable — the engine is using its built-in literature defaults.</p>}
        </div>
      </div>

      <div className="sl-card">
        <div className="sl-card-head"><span>Plant fragility priors (logit scale)</span></div>
        <table className="sl-table">
          <thead><tr><th>Term</th><th>Mean</th><th>SD</th></tr></thead>
          <tbody>{FRAGILITY_PRIORS.map((p) => <tr key={p.key} title={p.why}><td>{p.key}</td><td className="num">{p.mean}</td><td className="num">{p.sd}</td></tr>)}</tbody>
        </table>
        <p className="sl-hint">Prior-predictive: three documented plant failures (North Cove 2024, Rocky Mount 2023, Puerto Rico 2017) are too few to fit a posterior, so uncertainty in every coefficient is carried into the result.</p>
      </div>

      {d && (
        <div className="sl-card">
          <div className="sl-card-head"><span>Run diagnostics</span></div>
          <dl className="sl-diag num">
            <dt>Seed</dt><dd>{d.seed}</dd>
            <dt>Grid</dt><dd>{d.gridKm} km · {d.gridCells.toLocaleString()} cells</dd>
            <dt>Steps</dt><dd>{d.steps} hourly</dd>
            <dt>Members</dt><dd>{r!.members.toLocaleString()} at sites · {d.fieldMembers} for maps</dd>
            <dt>Terrain</dt><dd>{d.terrain}</dd>
            <dt>Timing</dt><dd>{Object.entries(d.timingsMs).map(([k, v]) => `${k} ${v} ms`).join(' · ')}</dd>
          </dl>
          {d.warnings.map((w) => <p key={w} className="sl-warn">{w}</p>)}
        </div>
      )}
    </div>
  );
}
