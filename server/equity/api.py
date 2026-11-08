from functools import lru_cache
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from .engine import build_inputs, solve

router = APIRouter()

class Request(BaseModel):
    scenarioId: Literal["helene","maria","rocky-mount"]
    drugId: str = Field(max_length=90)
    policy: Literal["market","proportional","rxradar"]
    weight: float = Field(default=.5, ge=0, le=1, alias="lambda")

@lru_cache(maxsize=64)
def allocate(sc, drug, policy, weight):
    return solve(build_inputs(sc, drug), policy, weight)

@router.post("/allocate")
def allocation(req: Request):
    try:
        return allocate(req.scenarioId, req.drugId, req.policy, req.weight)
    except (FileNotFoundError, StopIteration, KeyError) as err:
        raise HTTPException(404, "No allocation input exists for that scenario and drug") from err
