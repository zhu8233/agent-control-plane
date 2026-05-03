import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const schemaDir = join(root, 'packages', 'protocol', 'schemas');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schemaFiles = readdirSync(schemaDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

for (const name of schemaFiles) {
  const schema = JSON.parse(readFileSync(join(schemaDir, name), 'utf8'));
  try {
    ajv.compile(schema);
    console.log('ok schema compile', name);
  } catch (e) {
    console.error('fail schema compile', name, e);
    process.exit(1);
  }
}

/** @type {Array<[string, string]>} */
const examples = [
  [
    join(root, 'examples', 'synthetic-task.json'),
    'https://agent-control-plane.local/schemas/acp-task.schema.json',
  ],
  [
    join(root, 'examples', 'synthetic-agent-profile.json'),
    'https://agent-control-plane.local/schemas/acp-agent-profile.schema.json',
  ],
  [
    join(root, 'examples', 'synthetic-team-plan.json'),
    'https://agent-control-plane.local/schemas/acp-team-plan.schema.json',
  ],
  [
    join(root, 'examples', 'synthetic-assignment.json'),
    'https://agent-control-plane.local/schemas/acp-assignment.schema.json',
  ],
  [
    join(root, 'examples', 'synthetic-evidence.json'),
    'https://agent-control-plane.local/schemas/acp-evidence.schema.json',
  ],
];

for (const [filePath, schemaId] of examples) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    console.error('missing compiled schema', schemaId);
    process.exit(1);
  }
  const ok = validate(data);
  if (!ok) {
    console.error('fail example', filePath, validate.errors);
    process.exit(1);
  }
  console.log('ok example', filePath);
}
