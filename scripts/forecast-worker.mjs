import {database} from '../server/database.mjs';
import {runForecastBatch} from '../server/forecast.mjs';
let stopping=false,wake;
function stop(){stopping=true;wake?.()}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
const db=database();
console.log('Inventory monitor: advisory evaluations only. No card generation or external requests.');
while(!stopping){try{const r=runForecastBatch(db);if(r.evaluated)console.log('Evaluated policies:',r.evaluated)}catch{console.error('forecast_worker_iteration_failed');if(process.argv.includes('--once'))process.exitCode=1}
 if(process.argv.includes('--once')||stopping)break;
 await new Promise(resolve=>{const timer=setTimeout(()=>{wake=undefined;resolve()},60000);wake=()=>{clearTimeout(timer);wake=undefined;resolve()}});
}
db.sql.close();
