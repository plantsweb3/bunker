// Builds the public source archive and its manifest.
//
// Publishing starts from an allow-list: only the entries named in ROOTS are
// ever walked, so a file dropped in the checkout (a downloaded recovery kit, a
// wallet keypair, an editor backup) is not published by default. Inside those
// entries, anything that looks like key material stops the build instead of
// being skipped quietly. tests/source-bundle.test.ts checks that the result is
// exactly the set of files tracked by Git.
//
//   node scripts/bundle-source.mjs          writes public/source/*
//   node scripts/bundle-source.mjs --list   prints the file list only
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOTS = [
  '.github', 'app', 'components', 'crates', 'docs', 'fixtures', 'lib', 'programs',
  'public', 'scripts', 'sdk', 'tests', 'tools', 'vendor',
  '.env.example', '.gitignore', '.npmrc', '.nvmrc', '.vercelignore', 'CONTRIBUTING.md',
  'Cargo.lock', 'Cargo.toml', 'LICENSE', 'README.md', 'SECURITY.md', 'THIRD_PARTY.md',
  'components.json', 'eslint.config.mjs', 'next.config.ts', 'package-lock.json',
  'package.json', 'playwright.config.ts', 'postcss.config.mjs', 'proxy.ts',
  'tsconfig.json', 'vercel.json', 'vitest.config.ts',
];
// Build output and tool state: never source, skipped wherever they appear.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.vinext', '.vercel', '.wrangler', '.sites-runtime',
  '.local-validator', '.agents', '.codex', 'target', 'dist', 'coverage', 'test-results',
  'playwright-report',
]);
const SKIP_FILES = [/^\.DS_Store$/, /\.log$/, /\.tmp$/, /\.tmp\./, /\.tsbuildinfo$/];
// Must never be published. Finding one inside a published directory is an error.
const FORBIDDEN = [
  /^\.env(?!\.example$)/, /-keypair\.json$/, /^id\.json$/, /\.pem$/, /\.key$/,
  /\.recovery\.json$/, /^bunker-(?:devnet|test)-.+\.json$/,
];
const files = [];
async function add(path, entry) {
  const name = entry.name;
  if (entry.isSymbolicLink()) throw new Error(`Refusing symlink ${path}`);
  if (entry.isDirectory()) {
    if (SKIP_DIRS.has(name) || path === 'public/source') return;
    for (const e of await readdir(path, { withFileTypes: true })) await add(`${path}/${e.name}`, e);
    return;
  }
  if (!entry.isFile() || SKIP_FILES.some((p) => p.test(name))) return;
  if (FORBIDDEN.some((p) => p.test(name)))
    throw new Error(`Refusing to publish ${path}: it looks like key material. Move it out of the source tree.`);
  files.push(path);
}
for (const e of await readdir('.', { withFileTypes: true }))
  if (ROOTS.includes(e.name)) await add(e.name, e);
if (files.includes('.npmrc') && /_auth|_password|:username|\/\/[^\s]+:/.test(await readFile('.npmrc', 'utf8')))
  throw new Error('Refusing to publish .npmrc: it contains registry credentials.');
files.sort();
if (process.argv.includes('--list')) {
  console.log(files.join('\n'));
} else {
  const manifest = { format: 1, algorithm: 'SHA-256', files: [] };
  for (const path of files)
    manifest.files.push({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  await mkdir('public/source', { recursive: true });
  await writeFile('public/source/source-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  const r = spawnSync('tar', ['-czf', 'public/source/bunker-source.tar.gz', '--no-recursion', '-T', '-'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    input: files.join('\n') + '\n',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (r.status !== 0) throw new Error('Source archive failed');
  console.log(`Source bundle: ${files.length} files; no environment, keys, build outputs or dependencies.`);
}
