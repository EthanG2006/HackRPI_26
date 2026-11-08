"""Read-only planning tools exposed to Claude, plus map commands emitted to the browser."""
import json
from datetime import datetime
from pathlib import Path
from functools import lru_cache

DATA=Path(__file__).resolve().parents[2]/"web"/"public"/"data"
SE={"NC","SC","GA","FL","TN","MS","AL","AR","LA","KY","VA","WV"}


def schema(name,description,properties,required):
    return dict(name=name,description=description,input_schema=dict(type="object",properties=properties,required=required,additionalProperties=False))
STRING={"type":"string"}
TOOLS=[
 schema("fly_to","Move the map to a named place.",{"place":{"type":"string","enum":["southeast","puerto rico","capital region","troy","north cove","gulf coast","united states"]}},["place"]),
 schema("highlight_hospitals","Find and highlight facilities with earliest model stockout days. All stocks and type flags are simulated.",{
   "region":STRING,"pediatric":{"type":"boolean"},"rural":{"type":"boolean"},"highSvi":{"type":"boolean"},
   "drugId":STRING,"limit":{"type":"integer","minimum":1,"maximum":12}},[]),
 schema("query_drug_risk","Read scenario risk and its uncertainty for a drug, optionally restricting hospital geography.",{"drug":STRING,"region":STRING},["drug"]),
 schema("run_storm","Run a hypothetical storm. Requires an explicitly requested storm experiment.",{
   "track":{"type":"array","items":{"type":"array","items":{"type":"number"},"minItems":2,"maxItems":2},"minItems":2,"maxItems":64},
   "category":{"type":"integer","minimum":1,"maximum":5},"forwardSpeedKt":{"type":"number","minimum":1,"maximum":60}},["track","category"]),
 schema("set_allocation_policy","Compare inventory policies in the equity lab.",{"policy":{"type":"string","enum":["market","proportional","rxradar"]}},["policy"]),
 schema("open_hospital","Open a hospital detail panel using its exact catalog id.",{"id":STRING},["id"]),
 schema("generate_briefing","Generate a one-page PDF planning memo. Requires the user's request.",{"hospital_id":STRING},["hospital_id"]),
]

@lru_cache(maxsize=15)
def read(name):
    return json.loads((DATA/name).read_text(encoding="utf-8-sig"))

def execute(name,params,context):
    sid=context.get("scenarioId","helene")
    scenario=read("scenarios/"+sid+".json") if sid in ("helene","maria","rocky-mount") else None
    if scenario and scenario.get("predictionSnapshots") and not context.get("equityOpen"):
        cutoff=context.get("informationTime",scenario["start"])
        snapshots=sorted(scenario["predictionSnapshots"],key=lambda p:p["t"])
        before=[p for p in snapshots if datetime.fromisoformat(p["t"].replace("Z","+00:00"))<=datetime.fromisoformat(cutoff.replace("Z","+00:00"))]
        snapshot=before[-1] if before else snapshots[0]
        scenario={**scenario,**snapshot}
    hospitals=read("hospitals.json")["hospitals"]
    if name=="highlight_hospitals":
        drug=params.get("drugId") or (scenario or {}).get("heroDrugIds",[""])[0]
        stock=(scenario or {}).get("hospitalStockouts",{}).get(drug,{}).get("p50",[])
        region=params.get("region","all").lower()
        selected=[]
        for i,h in enumerate(hospitals):
            if params.get("pediatric") and not h["pediatric"]:continue
            if params.get("rural") and not h["rural"]:continue
            if params.get("highSvi") and h["svi"]<.75:continue
            if region not in ("all","") and not ((region=="southeast" and h["state"] in SE) or region==h["state"].lower() or region in h["city"].lower()):continue
            selected.append(dict(id=h["id"],name=h["name"],state=h["state"],day=stock[i] if len(stock)>i else 999))
        return sorted(selected,key=lambda h:h["day"])[:max(1,min(12,int(params.get("limit",6))))]
    if name=="query_drug_risk":
        query=params["drug"].lower()
        drug=next((d for d in read("drugs.json") if query==d["id"] or query in d["name"].lower() or query in d["shortName"].lower()),None)
        if not drug:return {"error":"Drug not found"}
        risk=next((r for r in (scenario or {}).get("drugRisk",[]) if r["drugId"]==drug["id"]),None)
        return dict(drug=drug,risk=risk)
    if name in ("open_hospital","generate_briefing"):
        hospital=next((h for h in hospitals if h["id"]==params.get("id",params.get("hospital_id"))),None)
        return hospital or {"error":"Hospital not found"}
    if name=="set_allocation_policy" and scenario:
        eq=read("equity/"+sid+".json")
        return {"policy":params["policy"],"metrics":eq["policies"][params["policy"]]["metrics"],"provenance":"SIMULATED"}
    if name=="run_storm":
        return {"status":"Browser ensemble requested. Use the results panel for computed outputs."}
    return {"status":"Map command sent","provenance":"SIMULATED"}
