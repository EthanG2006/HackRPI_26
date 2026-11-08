import type { Camera, LngLat, PolygonCoords, MultiPolygonCoords, RasterFrame } from '../types';

export type XY = [number,number];
export type MapCamera = Pick<Camera,'latitude'|'longitude'|'zoom'>;
export interface Viewport {width:number; height:number; camera:MapCamera; scale:number; cx:number; cy:number;}
export const mercX=(lon:number)=>(lon+180)/360;
export function mercY(lat:number) {
  const r=Math.max(-85,Math.min(85,lat))*Math.PI/180;
  return (1-Math.log(Math.tan(Math.PI/4+r/2))/Math.PI)/2;
}
export const invY=(y:number)=>Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI;
export function viewport(camera:MapCamera,width:number,height:number):Viewport{
  return {camera,width,height,scale:512*2**camera.zoom,cx:mercX(camera.longitude),cy:mercY(camera.latitude)};
}
export function project(view:Viewport,lon:number,lat:number):XY{
  return [(mercX(lon)-view.cx)*view.scale+view.width/2,(mercY(lat)-view.cy)*view.scale+view.height/2];
}
export function unproject(view:Viewport,x:number,y:number):LngLat{
  return [((x-view.width/2)/view.scale+view.cx)*360-180,invY((y-view.height/2)/view.scale+view.cy)];
}
export function inView(view:Viewport,pos:XY,pad=20) {
  return pos[0]>=-pad&&pos[0]<=view.width+pad&&pos[1]>=-pad&&pos[1]<=view.height+pad;
}
export function polys(p:PolygonCoords|MultiPolygonCoords):PolygonCoords[]{
  if(!p?.length||!p[0].length)return [];
  return typeof p[0][0][0]==='number'?[p as PolygonCoords]:p as MultiPolygonCoords;
}
export function path(ctx:CanvasRenderingContext2D,v:Viewport,line:LngLat[],close=false) {
  for(let i=0;i<line.length;i++){const [x,y]=project(v,...line[i]);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
  if(close)ctx.closePath();
}
export function polygon(ctx:CanvasRenderingContext2D,v:Viewport,p:PolygonCoords|MultiPolygonCoords,fill:string,stroke:string,width=1){
  ctx.beginPath();for(const poly of polys(p)) for(const ring of poly) path(ctx,v,ring,true);
  ctx.fillStyle=fill;ctx.fill('evenodd');ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();
}
export function latest<T>(rows:T[]|undefined,getTime:(r:T)=>string,t:number):T|undefined{
  let best:T|undefined,at=-Infinity;
  for(const r of rows??[]){const time=Date.parse(getTime(r));if(time<=t&&time>at){at=time;best=r;}}
  return best;
}
export function frameAt(frames:RasterFrame[]|undefined,t:number,maxAgeHours:number){
  const f=latest(frames,x=>x.t,t);
  return f&&t-Date.parse(f.t)<=maxAgeHours*3600000?f:undefined;
}
