import type { Drug, EquityFile, Hospital, PolicyId, PolicyResult, ScenarioId } from '../types';

export interface AllocationInputs {
  scenarioId: ScenarioId;
  hospitals: Hospital[];
  drug: Drug;
  opening?: number[];
  fraction: number;
}
const days = 14;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);

export function simulateEquity(input: AllocationInputs): EquityFile {
  const { hospitals, drug } = input;
  const fraction = clamp(input.fraction, .2, 1);
  const demand = hospitals.map(h => Math.max(1, h.beds * drug.dailyUsePer100Beds / 100));
  const opening = hospitals.map((h,i) => Math.max(0, input.opening?.[i] ??
    2 + Math.min(5, Math.log1p(h.beds)/1.4) - 1.4 * +h.rural - .8 * +(h.svi >= .75)));
  const power = hospitals.map(h => Math.log1p(h.systemSize ?? 1) + Math.log1p(Math.max(1,h.beds)) - +h.rural);
  const benefit = hospitals.map((h,i) => 1 + .12*+h.pediatric + .08*+h.safetyNet + .12*clamp(power[i]/10,0,1));
  const orderIndex = hospitals.map((_,i) => i).sort((a,b) => power[b]-power[a]);
  const available = sum(demand)*fraction;
  function run(policy: PolicyId, weight: number): PolicyResult {
    const stocks = opening.map((daysOnHand,i) => daysOnHand*demand[i]);
    const needs = stocks.map((v,i) => Math.max(0, days*demand[i]-v));
    let arrivals = demand.map(d => d*fraction);
    if (policy === 'rxradar') {
      // This bounded one-resource LP has an exact greedy solution: assign feasible floors,
      // then fill the highest marginal benefit per unit until the shared capacity binds.
      const utility = hospitals.map((h,i) => benefit[i] + weight*(.4*+(h.svi>=.75)+.30*+h.rural+.18*+h.safetyNet+.15*+h.pediatric)
        + 1e-6*(1-i/Math.max(1,hospitals.length-1)));
      const net = hospitals.map((h,i) => clamp(days*demand[i]*weight*(.32+.68*+(h.svi>=.75 || h.rural || h.safetyNet || h.pediatric))-stocks[i],0,needs[i]));
      const budget = Math.min(available*days, sum(needs));
      const scale = Math.min(1, budget / (sum(net) || 1));
      for (let i=0;i<net.length;i++) net[i] *= scale;
      let remaining = Math.max(0, budget-sum(net));
      for (const i of [...orderIndex].sort((a,b) => utility[b]-utility[a])) {
        const grant = Math.min(remaining, needs[i]-net[i]);
        net[i] += grant; remaining -= grant;
        if (remaining <= 0) break;
      }
      arrivals = net.map(v => v/days);
    }
    const stockoutDay = stocks.map(() => 999), served = stocks.map(() => 0), backlog = stocks.map(() => 0);
    const daily: NonNullable<PolicyResult['daily']> = [];
    let purchased=0, missed=0;
    for (let day=1; day<=days;day++) {
      let remaining=available, orderSum=0, high=0, total=0;
      for (const i of orderIndex) {
        const h = hospitals[i], normal = demand[i];
        let delivered = arrivals[i], order = delivered;
        if (policy === 'market') {
          const strength = clamp((power[i]-2)/7,0,1);
          order = clamp(normal*(1+(1-fraction)*2*strength)+.55*backlog[i],0,Math.max(0,normal*(days-day+1+3*strength)-stocks[i]));
          delivered = Math.min(remaining,order); remaining -= delivered; backlog[i] = order-delivered;
        }
        purchased += delivered; orderSum += order; stocks[i] += delivered;
        const used = Math.min(normal,stocks[i]);
        stocks[i] -= used; served[i] += used; missed += normal-used;
        if (normal-used>1e-5 && stockoutDay[i]===999) stockoutDay[i]=day;
        if (stockoutDay[i]<=day) { total++; if (h.svi>=.75) high++; }
      }
      daily.push({day,stockedOut:total,highSviStockedOut:high,ordersVsDemand:orderSum/(available/fraction)});
    }
    const coverage=served.map((v,i) => clamp(v/(days*demand[i]),0,1)), n=coverage.length;
    const sorted=[...coverage].sort((a,b) => a-b);
    const gini=sorted.reduce((acc,v,i) => acc+(2*(i+1)-n-1)*v,0)/Math.max(1e-8,n*sum(sorted));
    const averages = [(h: Hospital)=>h.svi>=.75,(h: Hospital)=>h.rural,(h: Hospital)=>h.safetyNet,(h: Hospital)=>h.pediatric]
      .map(filter => coverage.filter((_,i)=>filter(hospitals[i]))).filter(group=>group.length).map(group=>sum(group)/group.length);
    return { coverage, stockoutDay, daily, metrics: {
      pctStockedOut: daily[days-1].stockedOut/n, highSviStockouts: daily[days-1].highSviStockedOut,
      ruralStockouts: stockoutDay.filter((d,i)=>d<999 && hospitals[i].rural).length,
      patientsDelayed: Math.round(missed*.25), totalCostUsd: Math.round(purchased*drug.contractPricePerUnit + missed*.25*48),
      gini, efficiency: sum(served.map((v,i)=>v*benefit[i])) / sum(demand.map((v,i)=>days*v*benefit[i])),
      equity: averages.length ? Math.min(...averages) : sum(coverage)/n
    }};
  }
  const frontier = [0,.25,.5,.75,1].map(lambda => ({lambda, ...run('rxradar', lambda)}));
  return { scenarioId:input.scenarioId, drugId:drug.id, horizonDays:days, supplyFraction:fraction,
    policies:{ market:run('market',0), proportional:run('proportional',0), rxradar:frontier[2]}, frontier,
    notes:['All facilities receive simultaneous notice. Orders under fair allocation are capped at their net need.'], provenance:'SIMULATED' };
}
