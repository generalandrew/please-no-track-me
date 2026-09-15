// Node-side taxonomy loader. Kept out of src/engine so the engine stays free of any I/O:
// in the extension the same object is assembled from bundled imports.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const read = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

export function loadData() {
  return {
    vocabularies: read('vocabularies.json'),
    campaigns: read('campaigns.json'),
    grammars: read('grammars.json'),
    trackingParams: read('tracking-params.json'),
    neverTouch: read('never-touch.json'),
    redirectors: read('redirectors.json'),
    stripOnly: read('strip-only.json'),
  };
}
