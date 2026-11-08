"""Server-side Anthropic streaming. Keys never enter the browser bundle."""
import asyncio
import json
import os
from typing import Literal
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from .tools import TOOLS, execute

router=APIRouter()
MODEL=os.environ.get("ANTHROPIC_MODEL","claude-sonnet-5-5")
SYSTEM="""You are Rx Radar's aggregate hospital-supply planning copilot.
Use the supplied local scenario data. All risk probabilities, hospital inventory, ordering behavior,
supply links and impact savings are MODEL ESTIMATES or SIMULATED. Cite source IDs in square brackets.
Public records can establish a location or historic storm, but never validate the simulated stocks.
999 stockout days means no stockout within 90 days. Dates count from scenario day0.
Always state uncertainty and simulation status alongside numeric projections.
Never invent facts, dates, citations or supplier links. Admit unavailable records.
You must refuse patient-level rationing or triage decisions, directing clinical judgment to the
hospital's established allocation framework. You can offer aggregate fair-share inventory planning.
Recommend actions for pharmacist review. You cannot approve actions or place orders.
Use tools to move the map or open relevant panels when asked. Do not run storms or generate files
without the user's request. Report simulated results only after receiving a tool result.
Respond briefly using plain text. The interface renders citations separately.
"""

class Message(BaseModel):
    role:Literal["user","assistant"]
    content:str=Field(max_length=6000)

class Request(BaseModel):
    messages:list[Message]=Field(min_length=1,max_length=20)
    context:dict=Field(default_factory=dict)

def event(kind,**data):
    return "data: "+json.dumps({"type":kind,**data},separators=(",",":"))+"\n\n"

@router.post("/copilot")
async def copilot(req:Request):
    async def stream():
        if not os.environ.get("ANTHROPIC_API_KEY"):
            yield event("fallback",reason="API key is not configured")
            return
        try:
            import anthropic
            client=anthropic.AsyncAnthropic(timeout=20,max_retries=0)
            messages=[m.model_dump() for m in req.messages]
            context=json.dumps(req.context,separators=(",",":"))[:70000]
            yield event("mode",mode="live",model=MODEL)
            for _ in range(4):
                async with client.messages.stream(model=MODEL,max_tokens=850,system=SYSTEM+"\nLocal context\n"+context,
                                                   messages=messages,tools=TOOLS) as response:
                    async for text in response.text_stream:
                        yield event("token",text=text)
                    final=await response.get_final_message()
                blocks=[b.model_dump(exclude_none=True) for b in final.content]
                messages.append({"role":"assistant","content":blocks})
                results=[]
                for block in final.content:
                    if block.type!="tool_use":continue
                    try:
                        result=execute(block.name,block.input,req.context)
                        yield event("tool",name=block.name,input=block.input)
                    except (KeyError,ValueError,FileNotFoundError,TypeError) as err:
                        result={"error":str(err),"available":False}
                    results.append({"type":"tool_result","tool_use_id":block.id,"content":json.dumps(result,separators=(",",":"))})
                if not results:break
                messages.append({"role":"user","content":results})
            yield event("citations",sourceIds=[s["id"] for s in req.context.get("sources",[]) if s.get("id") in ("hifld","assumptions","nhc-gis")])
            yield event("done")
        except asyncio.CancelledError:
            raise
        except Exception:
            # Avoid putting authentication errors or upstream headers into a demo transcript.
            yield event("fallback",reason="Live service unavailable")
        finally:
            if "client" in locals():
                await client.close()
    return StreamingResponse(stream(),media_type="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})
