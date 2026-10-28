/**
 * Test environment: must run before any application module is imported, because
 * src/config/env.ts validates the environment at import time.
 *
 * Unit specs never touch the store; integration specs clear and refill the
 * isolated "medicare_test" dataset declared in docker-compose.yml, so the
 * demo dataset is never modified by a test run.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.LOG_PRETTY = 'false';
process.env.FUSEKI_DATASET = process.env.TEST_FUSEKI_DATASET ?? 'medicare_test';
process.env.SQLITE_FILE = process.env.TEST_SQLITE_FILE ?? './data/test.app.db';
process.env.SEED_DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Test-Password-123';
// specs sign in repeatedly and hash many passwords; neither must hit a real limit
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.RATE_LIMIT_MAX = '100000';
process.env.BCRYPT_ROUNDS = '4';
