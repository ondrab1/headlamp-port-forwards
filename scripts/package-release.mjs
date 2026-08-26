/**
 * Packages the plugin for release.
 *
 * `headlamp-plugin package` names the folder inside the tarball after the
 * directory it runs in, while Headlamp loads a plugin from a folder named after
 * the package. Those differ here - the repository is `headlamp-port-forwards`,
 * the package is `persistent-port-forwards` - so a tarball built in place would
 * install alongside a development build instead of replacing it, leaving two
 * copies of the plugin loaded at once.
 *
 * Staging the build under the package name first makes the tarball match what
 * `npm start` installs.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const pluginName = pkg.name.split('/').pop();
const staging = path.join(root, '.release', pluginName);
const tarball = path.join(root, `${pluginName}-${pkg.version}.tar.gz`);

if (!fs.existsSync(path.join(root, 'dist', 'main.js'))) {
  console.error('dist/main.js is missing. Run `npm run build` first.');
  process.exit(1);
}

fs.rmSync(path.join(root, '.release'), { recursive: true, force: true });
fs.rmSync(tarball, { force: true });
fs.mkdirSync(staging, { recursive: true });

fs.cpSync(path.join(root, 'dist'), path.join(staging, 'dist'), { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(staging, 'package.json'));

execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['headlamp-plugin', 'package', staging, root],
  { stdio: 'inherit' }
);

fs.rmSync(path.join(root, '.release'), { recursive: true, force: true });

console.log(`\nFolder inside the tarball: ${pluginName}/  (matches what npm start installs)`);
console.log(
  'The release workflow records this checksum; a local build only needs it for a manual install.'
);
