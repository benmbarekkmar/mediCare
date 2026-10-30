/**
 * Runs the Python NLP service commands through the venv interpreter, so the npm
 * scripts work the same on Windows and POSIX shells.
 *
 *   npm run nlp           -> uvicorn app.main:app
 *   npm run nlp:test      -> pytest tests
 *   npm run nlp:evaluate  -> scripts/evaluate.py
 *   npm run nlp:intents   -> scripts/generate_intents.py
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

const SERVICE_DIR = path.resolve(__dirname, '..', 'nlp-service');
const BACKEND_DIR = path.resolve(SERVICE_DIR, '..');

// Keep the Python process on the same Fuseki dataset and service settings as the API.
loadEnv({ path: path.join(BACKEND_DIR, '.env'), override: false });

const COMMANDS: Record<string, string[]> = {
  serve: ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8100'],
  test: ['-m', 'pytest', 'tests', '-q'],
  evaluate: ['scripts/evaluate.py'],
  intents: ['scripts/generate_intents.py'],
};

const venvPython = (): string => {
  const exe = process.platform === 'win32' ? 'python.exe' : 'python';
  const candidate = path.join(SERVICE_DIR, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', exe);
  if (!existsSync(candidate))
    console.error(
      `No virtual environment at ${candidate}.\n` +
        '  cd backend/nlp-service && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt\n' +
        '  .venv/Scripts/python -m spacy download en_core_web_md && .venv/Scripts/python -m spacy download fr_core_news_md',
    );
  return candidate;
};

const [command = 'serve', ...rest] = process.argv.slice(2);
const args = COMMANDS[command];
if (!args) {
  console.error(`Unknown NLP command "${command}". Use one of: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(2);
}

const python = venvPython();
const result = spawnSync(python, [...args, ...rest], { cwd: SERVICE_DIR, stdio: 'inherit', shell: false });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
