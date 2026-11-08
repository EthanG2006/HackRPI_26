from fastapi import APIRouter
from .weather import snapshot

router=APIRouter()

@router.get("/live")
def live():
    return snapshot()
