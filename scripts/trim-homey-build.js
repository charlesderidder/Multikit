'use strict';

const { rm } = require('fs/promises');
const { join } = require('path');

const buildOnlyTypescript = join(__dirname, '..', '.homeybuild', 'node_modules', 'typescript');

rm(buildOnlyTypescript, { recursive: true, force: true }).catch((error) => {
  process.stderr.write(`Could not remove TypeScript from the Homey build: ${error}\n`);
  process.exitCode = 1;
});
