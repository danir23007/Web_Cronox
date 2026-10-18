'use strict';
// Runs only as deploy, never root. Execute the incoming preflight before maintenance.
const cp = require('node:child_process'), Module = require('node:module');
if (process.getuid() === 0 || !/^[a-f0-9]{40}$/.test(process.argv[2] || '')) process.exit(1);
process.chdir('/var/www/cronox/Web_Cronox');
const filename = process.cwd() + '/.github/scripts/run-release-preflight.cjs';
const source = cp.execFileSync('/usr/bin/git', ['show', process.argv[2] + ':.github/scripts/run-release-preflight.cjs']);
const runner = new Module(filename, module);
runner.filename = filename;
runner.paths = Module._nodeModulePaths(process.cwd());
runner._compile(source.toString(), filename);
process.exitCode = runner.exports.main(['--repo=' + process.cwd(), '--revision=' + process.argv[2],
  '--env-file=' + process.cwd() + '/cronox-backend/.env']);
