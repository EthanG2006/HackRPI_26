import { useEffect, useRef } from 'react';

// A ray-sphere intersection samples day, night and independently drifting cloud maps.
// The identical pre-rendered projection is already on screen before the GPU is ready.
export default function OrbitalGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const gl = canvas.getContext('webgl', {alpha:true, antialias:false, premultipliedAlpha:false, powerPreference:'low-power'});
    if (!gl) return;
    let active = true;
    let frame = 0;
    const shaders: WebGLShader[] = [];
    const textures: WebGLTexture[] = [];
    function shader(type:number, src:string) {
      const item = gl!.createShader(type)!;
      gl!.shaderSource(item, src); gl!.compileShader(item);
      shaders.push(item);
      return item;
    }
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 a; varying vec2 p; void main(){p=a; gl_Position=vec4(a,0.,1.);}'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
      precision highp float;
      varying vec2 p; uniform float t; uniform sampler2D dayTex,nightTex,cloudTex;
      void main(){
        vec2 pos=p/.99; float d=dot(pos,pos);
        if(d>1.) discard;
        float z=sqrt(max(0.,1.-d)); float tilt=radians(32.);
        float latitude=asin(clamp(z*sin(tilt)+pos.y*cos(tilt),-1.,1.));
        float lon=radians(-76.)+atan(pos.x,z*cos(tilt)-pos.y*sin(tilt))+sin(t*.012)*.082;
        vec2 uv=vec2(fract(.5+lon/6.2831853),.5-latitude/3.14159265);
        vec3 surface=texture2D(dayTex,uv).rgb;
        float lamp=texture2D(nightTex,uv).r;
        float cloud=pow(texture2D(cloudTex,vec2(fract(uv.x+t*.00021),uv.y)).r,1.2);
        float light=clamp(.76*pos.x+.56*pos.y+.47*z+.13,0.,1.);
        float lum=dot(surface,vec3(.28,.52,.20));
        vec3 color=(surface*.48+lum*vec3(.32,.61,.80))*(.17+.96*light);
        color=color*(1.-.63*cloud)+cloud*vec3(.62,.77,.87)*(.22+.78*light);
        color+=lamp*vec3(.99,.67,.28)*pow(1.-light,1.15)*.95;
        color+=pow(1.-z,4.3)*vec3(.16,.56,.76)*(.23+.77*light);
        gl_FragColor=vec4(color,clamp((1.-sqrt(d))*480.,0.,1.));
      }`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const buffer=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const a=gl.getAttribLocation(program,'a');
    gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
    function loadTex(url:string, key:string, unit:number) {
      return new Promise<void>((resolve,reject)=>{
        const img=new Image();
        img.onload=()=>{
          if (!active) return;
          const texture=gl!.createTexture()!;
          textures.push(texture);
          gl!.activeTexture(gl!.TEXTURE0+unit); gl!.bindTexture(gl!.TEXTURE_2D,texture);
          gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_MIN_FILTER,gl!.LINEAR);
          gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_MAG_FILTER,gl!.LINEAR);
          gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_WRAP_T,gl!.CLAMP_TO_EDGE);
          gl!.texImage2D(gl!.TEXTURE_2D,0,gl!.RGB,gl!.RGB,gl!.UNSIGNED_BYTE,img);
          gl!.uniform1i(gl!.getUniformLocation(program,key),unit); resolve();
        };
        img.onerror=reject;
        img.src=url;
      });
    }
    const elapsed=gl.getUniformLocation(program,'t');
    const start=performance.now();
    let last=-100;
    function draw(t:number) {
      if (!active) return;
      if (!document.hidden && t-last>45) {
        const size=Math.max(2,Math.min(1040,Math.round(canvas!.clientWidth*devicePixelRatio)));
        if (canvas!.width!==size) canvas!.width=canvas!.height=size;
        gl!.viewport(0,0,size,size); gl!.clear(gl!.COLOR_BUFFER_BIT);
        gl!.uniform1f(elapsed,(t-start)/1000); gl!.drawArrays(gl!.TRIANGLES,0,3);
        canvas!.style.opacity='1'; last=t;
      }
      frame=requestAnimationFrame(draw);
    }
    Promise.all([loadTex('/textures/earth.jpg','dayTex',0),loadTex('/textures/night.webp','nightTex',1),loadTex('/textures/clouds.webp','cloudTex',2)])
      .then(()=>{if(active) frame=requestAnimationFrame(draw);}).catch(()=>{});
    return ()=>{active=false; cancelAnimationFrame(frame); textures.forEach(t=>gl.deleteTexture(t)); gl.deleteBuffer(buffer); gl.deleteProgram(program); shaders.forEach(s=>gl.deleteShader(s));};
  },[]);
  return <div className="orbital-world" role="img" aria-label="Rotating view of the Americas with satellite cloud cover and city lights"><img src="/textures/globe.webp" alt="" fetchPriority="high"/><canvas ref={canvasRef}/></div>;
}
