import {writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const domain=process.argv[2];if(!domain||!/^(?=.{1,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain)||domain.includes('..'))throw Error('Usage: node scripts/init.mjs platform.example.com');
if(existsSync('.env'))throw Error('.env already exists; refusing to replace encryption key');
writeFileSync('.env',`APP_ORIGIN=https://${domain}\nDOMAIN=${domain}\nVOUCHER_VAULT_KEY=${randomBytes(32).toString('base64')}\nALLOW_REGISTRATION=true\nSANDBOX_ENABLED=true\nMIKROTIK_ENABLED=false\nMIKROTIK_TARGETS_JSON={}\n`,{mode:0o600,flag:'wx'});
console.log('Created .env. Keep an encrypted offline copy: its key is required to recover voucher data.');
