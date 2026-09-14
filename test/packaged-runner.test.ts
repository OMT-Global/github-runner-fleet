import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
test('built CLI carries its canonical metadata and is independent of cwd', () => {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc','-p','tsconfig.json']);
  execFileSync(process.execPath, ['scripts/package-runner-metadata.mjs']);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'runner-artifact-'));
  try {
    fs.cpSync('dist', path.join(temp,'dist'), {recursive:true});
    fs.writeFileSync(path.join(temp,'package.json'), '{"type":"module"}');
    const moduleUrl = pathToFileURL(path.join(temp,'dist/src/lib/runner-version.js')).href;
    const code = `import {readCanonicalRunnerVersion} from ${JSON.stringify(moduleUrl)}; console.log(readCanonicalRunnerVersion());`;
    const run = () => execFileSync(process.execPath, ['--input-type=module','-e',code], {cwd:os.tmpdir(),encoding:'utf8',stdio:['ignore','pipe','pipe']});
    expect(run().trim()).toBe(fs.readFileSync('.runner-version','utf8').trim());
    fs.unlinkSync(path.join(temp,'dist/.runner-version'));
    expect(run).toThrow();
  } finally { fs.rmSync(temp, {recursive:true,force:true}); }
}, 30000);
