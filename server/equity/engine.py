"""Inventory-agent simulation and a capacity-constrained allocation linear program."""
from __future__ import annotations

import json
from pathlib import Path
from functools import lru_cache
import numpy as np
from scipy.optimize import linprog

DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
HORIZON = 14


@lru_cache(maxsize=12)
def read(path):
    return json.loads((DATA / path).read_text(encoding="utf-8-sig"))


def build_inputs(scenario_id, drug_id):
    sc = read(f"scenarios/{scenario_id}.json")
    drug = next(d for d in read("drugs.json") if d["id"] == drug_id)
    risk = next(r for r in sc["drugRisk"] if r["drugId"] == drug_id)
    hospital = read("hospitals.json")["hospitals"]
    beds = np.array([max(1, h["beds"]) for h in hospital])
    demand = np.maximum(1, beds * drug["dailyUsePer100Beds"] / 100)
    high, rural, safety, child = [np.array(vals, dtype=bool) for vals in zip(*[
        (h["svi"] >= .75, h["rural"], h["safetyNet"], h["pediatric"]) for h in hospital])]
    power = np.array([np.log1p(h.get("systemSize", 1)) for h in hospital]) + np.log1p(beds) - rural
    # Emergency distributor releases cover a fraction of demand. Purchased buffer days and
    # delivery efficiency are synthetic planning assumptions shared by all three policies.
    initial = np.array(sc.get("inventoryDoh", {}).get(drug_id, []))
    if len(initial) != len(hospital):
        initial = 2 + np.minimum(5, np.log1p(beds) / 1.4) - 1.4 * rural - high * .8
    fraction = float(np.clip(min(risk["supplyCurve"]["p50"][:HORIZON]), .2, 1))
    return dict(demand=demand, opening=np.maximum(0, initial), fraction=fraction,
                price=drug["contractPricePerUnit"], power=power, high=high, rural=rural,
                protected=(high | rural | safety | child), safety=safety, child=child)


def solve(inp, policy="rxradar", weight=.5):
    demand, opening, frac = inp["demand"], inp["opening"], inp["fraction"]
    high, rural, child, safety = (inp[k] for k in ("high", "rural", "child", "safety"))
    stock = opening * demand
    total_demand = demand.sum()
    available = frac * total_demand
    needs = np.maximum(0, demand * HORIZON - stock)
    benefit = 1 + .12 * child + .08 * safety + .12 * np.clip(inp["power"] / 10, 0, 1)
    if policy == "rxradar":
        # x_i is a facility's 14-day shipment. No hospital may order more than net need.
        # Floors protect a facility's days of cover after accounting for its own buffer.
        floor_days = HORIZON * weight * (.32 + .68 * inp["protected"])
        lower = np.minimum(needs, np.maximum(0, demand * floor_days - stock))
        budget = min(available * HORIZON, needs.sum())
        if lower.sum() > budget:
            lower *= budget / lower.sum()
        # A single supply constraint plus individual lower/upper bounds is a bounded
        # continuous knapsack LP. Ascending facility index provides deterministic tie breaks.
        utility = benefit + weight * (.4*high + .30*rural + .18*safety + .15*child)
        utility += np.linspace(1e-6, 0, len(demand))
        result = linprog(-utility, A_ub=np.ones((1, len(demand))), b_ub=[budget],
                         bounds=np.column_stack((lower, needs)), method="highs", options={"presolve": False})
        if not result.success:
            raise ValueError(result.message)
        shipments = np.maximum(0, result.x) / HORIZON
    elif policy == "proportional":
        shipments = demand * frac
    index = np.argsort(-inp["power"], kind="stable")
    stockout = np.full(len(demand), 999)
    served_total = np.zeros(len(demand))
    purchased = 0.
    delayed = np.zeros(len(demand))
    daily = []
    unmet = np.zeros(len(demand))
    for day in range(1, HORIZON + 1):
        if policy == "market":
            # A stock-scarcity signal and yesterday's incomplete fill amplify today's orders.
            power_norm = np.clip((inp["power"] - 2) / 7, 0, 1)
            order = demand * (1 + (1-frac)*2*power_norm) + unmet * .55
            order = np.minimum(order, np.maximum(0, demand * (HORIZON-day+1+3*power_norm) - stock))
            sorted_orders = order[index]
            remaining = available - (np.cumsum(sorted_orders) - sorted_orders)
            arrivals = np.empty_like(demand)
            arrivals[index] = np.minimum(sorted_orders, np.maximum(0, remaining))
            unmet = np.maximum(0, order-arrivals)
        else:
            order = shipments
            arrivals = shipments
        purchased += arrivals.sum()
        stock += arrivals
        served = np.minimum(stock, demand)
        stock -= served
        served_total += served
        shortage = demand - served > 1e-5
        stockout[(stockout == 999) & shortage] = day
        delayed += (demand-served) * .25
        daily.append(dict(day=day, stockedOut=int((stockout <= day).sum()),
                          highSviStockedOut=int(((stockout <= day) & high).sum()),
                          ordersVsDemand=round(float(order.sum() / total_demand), 3)))
    coverage = np.clip(served_total/(HORIZON*demand), 0, 1)
    n = len(coverage)
    ordered = np.sort(coverage)
    gini = float(np.sum((2*np.arange(1,n+1)-n-1)*ordered) / max(1e-8, n*ordered.sum()))
    metrics = dict(pctStockedOut=float(np.mean(stockout < 999)), highSviStockouts=int(((stockout<999)&high).sum()),
                   ruralStockouts=int(((stockout<999)&rural).sum()), patientsDelayed=round(float(delayed.sum())),
                   gini=gini, totalCostUsd=round(float(purchased*inp["price"]+delayed.sum()*48)),
                   efficiency=float(np.average(coverage, weights=demand*benefit)),
                   equity=float(min([float(coverage[g].mean()) for g in [high,rural,child,safety] if g.any()] or [coverage.mean()])))
    return dict(metrics=metrics, coverage=coverage.round(3).tolist(), stockoutDay=stockout.tolist(), daily=daily)


def build_all():
    read.cache_clear()
    target = DATA / "equity"
    target.mkdir(exist_ok=True, parents=True)
    for path in sorted((DATA / "scenarios").glob("*.json")):
        sc = read(f"scenarios/{path.name}")
        if not sc.get("heroDrugIds"):
            continue
        drug = sc["heroDrugIds"][0]
        inp = build_inputs(sc["id"], drug)
        frontier = []
        for val in [0,.25,.5,.75,1]:
            result = solve(inp, "rxradar", val)
            frontier.append({"lambda": val, **result})
        policies = {p:solve(inp,p) for p in ("market", "proportional")}
        policies["rxradar"] = {k:v for k,v in frontier[2].items() if k != "lambda"}
        model = dict(scenarioId=sc["id"], drugId=drug, horizonDays=HORIZON,
                     supplyFraction=round(inp["fraction"],4), policies=policies, frontier=frontier,
                     notes=["All agents receive the alert together. Fair orders are capped at modeled net need.",
                            "A delayed encounter represents four unfilled units. Each delayed encounter adds $48 in modeled administrative costs."],
                     provenance="SIMULATED")
        (target/path.name).write_text(json.dumps(model, separators=(",",":")), encoding="utf-8")


if __name__ == "__main__":
    build_all()

