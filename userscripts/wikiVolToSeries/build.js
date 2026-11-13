import * as esbuild from 'esbuild';
import fs from 'fs';

const header = fs.readFileSync('header.js', 'utf8').trim();

const result = await esbuild.build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'iife',
  write: false,
  target: 'es2022',
  charset: 'utf8',
  alias: { '@common': '../userscript-common' },
});

const js = result.outputFiles[0].text;

fs.mkdirSync('dist', { recursive: true });

const output = `${header}
${js}
`;
fs.writeFileSync('dist/wikiVolToSeries.user.js', output);
console.log(`Built dist/wikiVolToSeries.user.js (${output.length} bytes)`);
