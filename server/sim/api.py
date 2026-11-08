from typing import Annotated
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from .engine import simulate

router=APIRouter()
Lon=Annotated[float, Field(ge=-180,le=180)]
Lat=Annotated[float, Field(ge=-90,le=90)]

class Storm(BaseModel):
    track:list[tuple[Lon,Lat]]=Field(min_length=2,max_length=128)
    category:int=Field(ge=1,le=5)
    forwardSpeedKt:float=Field(ge=1,le=60)
    members:int=Field(default=1000,ge=100,le=2000)

@router.post("/whatif")
def whatif(req:Storm):
    try:
        result=simulate(req.track,req.category,req.forwardSpeedKt,req.members)
        return JSONResponse(result)
    except FileNotFoundError as err:
        raise HTTPException(503,"Public catalog has not been generated") from err
