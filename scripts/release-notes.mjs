/**
 * Renders release notes from the changelog in artifacthub-pkg.yml.
 *
 * That file has to carry the changelog anyway - it is what Headlamp's plugin
 * catalog shows - so deriving the GitHub release notes from it keeps one list
 * instead of two that drift apart.
 *
 * Parses the `changes:` block directly rather than pulling in a YAML library:
 * this runs in CI, and the shape it needs is a fixed two-key list.
 */
import fs from 'node:fs';
import process from 'node:process';

const manifestPath = process.argv[2];

if (!manifestPath) {
  console.error('Usage: node scripts/release-notes.mjs <path to artifacthub-pkg.yml>');
  process.exit(1);
}

const manifest = fs.readFileSync(manifestPath, 'utf8').split('\n');
const start = manifest.findIndex(line => line.trimEnd() === 'changes:');

if (start === -1) {
  console.error(`No \`changes:\` block in ${manifestPath}.`);
  process.exit(1);
}

const changes = [];
for (const line of manifest.slice(start + 1)) {
  // A line that starts in column zero ends the block.
  if (line.trim() && !/^\s/.test(line)) {
    break;
  }

  const kind = line.match(/^\s*-\s*kind:\s*(.+?)\s*$/);
  if (kind) {
    changes.push({ kind: kind[1].replace(/^["']|["']$/g, ''), description: '' });
    continue;
  }

  const description = line.match(/^\s*description:\s*(.+?)\s*$/);
  if (description && changes.length > 0) {
    changes[changes.length - 1].description = description[1].replace(/^["']|["']$/g, '');
  }
}

if (changes.length === 0) {
  console.error(`The \`changes:\` block in ${manifestPath} is empty.`);
  process.exit(1);
}

const headings = { added: 'Added', changed: 'Changed', fixed: 'Fixed', removed: 'Removed' };
const order = ['added', 'changed', 'fixed', 'removed'];
const grouped = new Map();

for (const change of changes) {
  const kind = change.kind.toLowerCase();
  if (!grouped.has(kind)) {
    grouped.set(kind, []);
  }
  grouped.get(kind).push(change.description);
}

const sections = [...grouped.keys()].sort((a, b) => {
  const rank = kind => (order.indexOf(kind) === -1 ? order.length : order.indexOf(kind));
  return rank(a) - rank(b);
});

const out = [];
for (const kind of sections) {
  out.push(`### ${headings[kind] ?? kind}`, '');
  for (const description of grouped.get(kind)) {
    out.push(`- ${description}`);
  }
  out.push('');
}

process.stdout.write(out.join('\n'));
