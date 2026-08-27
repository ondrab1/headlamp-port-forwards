/**
 * Renders README.md into the copy that ArtifactHub shows for one release.
 *
 * ArtifactHub reads the documentation of a package version from a README.md
 * sitting next to that version's artifacthub-pkg.yml - there is no field
 * pointing at one elsewhere in the repository, and a symlink does not work
 * either, because the tracker reads regular files only. So every folder under
 * releases/ needs its own copy, and this is what writes it. The catalog page
 * had no documentation at all between the move to releases/ and this script.
 *
 * The copy is not identical. Relative links resolve against artifacthub.io
 * there, so the screenshots and the licence link would be broken images and
 * dead links; they are rewritten to absolute URLs pinned to the release tag, so
 * a version's page keeps showing the screenshots that version shipped with.
 * And the sections addressed to whoever works on the plugin are dropped: a
 * catalog page is read by someone deciding whether to install it, for whom a
 * release runbook is noise. They stay on GitHub, where they are the point.
 */
import fs from 'node:fs';
import process from 'node:process';

// Level-two headings whose section - subheadings and all - is left out of the
// catalog copy. check-catalog.sh greps the rendered files for the same names.
const maintainerSections = ['Contributing', 'Releasing'];

const [tag, source = 'README.md'] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY || 'ondrab1/headlamp-port-forwards';

if (!tag) {
  console.error('Usage: node scripts/catalog-readme.mjs <tag> [README path, or - for stdin]');
  process.exit(1);
}

const markdown = fs.readFileSync(source === '-' ? 0 : source, 'utf8');

// Rendered by GitHub, not served as a file: an image has to come from raw,
// everything else reads better as the page around it.
const isImage = target => /\.(png|jpe?g|gif|svg|webp)$/i.test(target.split(/[?#]/)[0]);

function absolute(target) {
  // Already absolute, an in-page anchor, or a protocol-relative URL.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) {
    return target;
  }

  const path = target.replace(/^\.\//, '');
  return isImage(path)
    ? `https://raw.githubusercontent.com/${repo}/${tag}/${path}`
    : `https://github.com/${repo}/blob/${tag}/${path}`;
}

// A dropped section runs from its own heading to the next level-two one, which
// is what carries its `###` subheadings out with it. A name matching nothing is
// not an error - the READMEs of the older releases predate one section or the
// other - so what a rename would break, the runbook landing on the catalog page
// anyway, is what check-catalog.sh greps for.
const kept = [];
let skipping = false;

for (const line of markdown.split('\n')) {
  const heading = line.match(/^##\s+(.+?)\s*$/);
  if (heading) {
    skipping = maintainerSections.includes(heading[1]);
  }
  if (!skipping) {
    kept.push(line);
  }
}

const rendered = kept
  .join('\n')
  // Markdown links and images: [text](target) and ![alt](target).
  .replace(/(!?\[[^\]]*\]\()([^)\s]+)/g, (_, prefix, target) => prefix + absolute(target))
  // The header block is HTML, so its src= and href= need the same treatment.
  .replace(/\b(src|href)=(["'])([^"']+)\2/g, (_, attr, quote, target) =>
    `${attr}=${quote}${absolute(target)}${quote}`
  );

process.stdout.write(rendered);
