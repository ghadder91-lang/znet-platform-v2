import {sandboxContext} from '../server/sandbox.mjs';
import {runDeliveryBatch,sandboxSmsAdapter} from '../server/delivery.mjs';
let stopping=false;process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
console.log('Sandbox delivery worker only: no real SMS or wallet calls.');
while(!stopping){try{if(process.env.SANDBOX_ENABLED==='true'){const {db,config}=sandboxContext();await runDeliveryBatch(db,{vaultKey:config.vaultKey,smsAdapter:sandboxSmsAdapter(db)});}}catch{console.error('sandbox_worker_iteration_failed')}
 if(process.argv.includes('--once'))break;
 await new Promise(resolve=>setTimeout(resolve,5000));
}
