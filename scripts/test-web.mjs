import { rolldown } from '../web/node_modules/rolldown/dist/index.mjs';
import { resolve } from 'node:path';
const bundle=await rolldown({input:resolve('web/src/verification/regression.test.ts'),platform:'node'});
const {output}=await bundle.generate({format:'esm'});
try { await import('data:text/javascript;base64,'+Buffer.from(output.find(x=>x.type==='chunk').code).toString('base64')); }
finally { await bundle.close(); }
