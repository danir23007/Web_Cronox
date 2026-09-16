'use strict';

const { installTestEnvironment } = require('./test-environment.cjs');

// Jest setupFiles execute before test modules and Nest provider construction.
installTestEnvironment();
