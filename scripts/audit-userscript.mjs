import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const url = new URL('../dist/forum-translator.user.js', import.meta.url);
const text = await readFile(url, 'utf8');
const report = JSON.parse(await readFile(new URL(`${url.href}.build.json`), 'utf8'));
new vm.Script(text);
if (!text.startsWith('// ==UserScript==')) throw new Error('Missing metadata header');

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = /^\/\/ @version\s+(\S+)$/m.exec(text)?.[1];
if (version !== pkg.version) throw new Error('Userscript version does not match package.json');
const stable = 'https://raw.githubusercontent.com/nukewarrior/forum-translater/main/dist/forum-translator.user.js';
for (const field of ['updateURL', 'downloadURL']) {
  const value = new RegExp('^// @' + field + '\\s+(\\S+)
if (/^\/\/ @match\s+\*|^\/\/ @match\s+https?:\/\/\*/m.test(text)) throw new Error('Unexpected broad match');
if (/\beval\s*\(|\bnew Function\s*\(/.test(text)) throw new Error('Dynamic code execution');
if (report.sha256 !== createHash('sha256').update(text).digest('hex')) throw new Error('Artifact hash mismatch');
if (/sourceMappingURL|\/mnt\/|[A-Z]:\\/.test(text)) throw new Error('Local path or source map in production');
console.log(JSON.stringify({ syntax: 'pass', metadata: 'pass', hash: 'pass', bytes: Buffer.byteLength(text) }));
, 'm').exec(text)?.[1];
  if (value !== stable) throw new Error('Missing stable main userscript ' + field);
}

if (/^\/\/ @match\s+\*|^\/\/ @match\s+https?:\/\/\*/m.test(text)) throw new Error('Unexpected broad match');
if (/\beval\s*\(|\bnew Function\s*\(/.test(text)) throw new Error('Dynamic code execution');
if (report.sha256 !== createHash('sha256').update(text).digest('hex')) throw new Error('Artifact hash mismatch');
if (/sourceMappingURL|\/mnt\/|[A-Z]:\\/.test(text)) throw new Error('Local path or source map in production');
console.log(JSON.stringify({ syntax: 'pass', metadata: 'pass', hash: 'pass', bytes: Buffer.byteLength(text) }));
