import {it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
it('AI controls non-human allies and transfers faction control without taking human players',()=>{
 const result=spawnSync(process.execPath,['--import','./tests/register-hooks.mjs','tests/allied-ai-probe.mjs'],{encoding:'utf8',timeout:90000});
 assert.equal(result.status,0,result.stdout+result.stderr);
});
