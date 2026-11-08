import type {Band} from '../types';

export function Trend({band,color='#66dfdf',label='Projected supply over 90 days',height=40}:{band:Band;color?:string;label?:string;height?:number}) {
 const {p10,p50,p90}=band,n=p50.length;
 if(!n)return null;
 const points=(series:number[])=>series.map((v,i)=>[i*180/Math.max(1,n-1),height-2-Math.max(0,Math.min(1,v))*(height-4)].join(','));
 return <svg viewBox={'0 0 180 '+height} preserveAspectRatio="none" className="trend" role="img" aria-label={label}>
  <path d={'M0 '+(height-1)+' H180'} stroke="#30404e" fill="none" strokeDasharray="3 4"/>
  <polygon points={[...points(p90),...points(p10).reverse()].join(' ')} fill={color} opacity=".18"/>
  <polyline points={points(p50).join(' ')} stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" fill="none"/>
 </svg>
}
