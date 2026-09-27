import { config } from 'dotenv';

// start:dev selects .env.local before Nest imports application modules.
// Deployment commands retain the existing .env / process environment behavior.
config({ path: process.env.CRONOX_ENV_FILE || '.env' });
