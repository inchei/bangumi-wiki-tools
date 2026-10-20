import * as esbuild from 'esbuild';
import fs from 'fs';

const header = fs.readFileSync('header.js', 'utf8').trim();
const css = fs.readFileSync('src/styles.css', 'utf8').trim();

const result = await esbuild.build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'iife',
  write: false,
  platform: 'browser',
  target: 'es2022',
  charset: 'utf8',
});

const js = result.outputFiles[0].text;

fs.mkdirSync('dist', { recursive: true });

const cssInjection = `
const styleEl = document.createElement('style');
styleEl.textContent = \`${css}\`;
document.head.appendChild(styleEl);
`;

const output = `${header}

(function () {
  'use strict';
  ${cssInjection}
${js}
})();
`;

fs.writeFileSync('dist/wikiEpStaffRelate.user.js', output);
console.log(`Built dist/wikiEpStaffRelate.user.js (${output.length} bytes)`);
