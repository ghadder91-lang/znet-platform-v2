import {sandboxContext} from '../server/sandbox.mjs';
const {config}=sandboxContext();console.log('PRIVATE sandbox credentials only — never expose to browsers.');console.log(JSON.stringify({provider:config.id,merchantId:config.merchantId,apiKey:config.apiKey,webhookSecret:config.webhookSecret},null,2));
