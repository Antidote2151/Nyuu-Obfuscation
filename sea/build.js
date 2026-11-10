"use strict";
// Builds Nyuu as a Node single executable application (SEA) into sea/out: node sea/build.js
// Needs browserify and a built node_modules/yencode (without native tuning, see .github/workflows/build-dev-linux-sea.yml)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const browserify = require('browserify');

const root = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'out');
const yencodeNode = path.join(root, 'node_modules', 'yencode', 'build', 'Release', 'yencode.node');
const helpJson = path.join(root, 'bin', 'help.json');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(helpJson, JSON.stringify({
	full: fs.readFileSync(path.join(root, 'help-full.txt')).toString(),
	short: fs.readFileSync(path.join(root, 'help.txt')).toString()
}));

const b = browserify([path.join(root, 'bin', 'nyuu.js')], { debug: false, detectGlobals: true, node: true });
b.exclude('worker_threads');
b.exclude('../nexe/node_modules/nexe/package.json'); // optional, inside try/catch
b.exclude(yencodeNode); // loaded from the SEA asset by stub.js
b.bundle((err, src) => {
	fs.unlinkSync(helpJson);
	if(err) throw err;
	const main = path.join(outDir, 'nyuu.js');
	fs.writeFileSync(main, Buffer.concat([fs.readFileSync(path.join(__dirname, 'stub.js')), src]));
	const config = path.join(outDir, 'sea-config.json');
	fs.writeFileSync(config, JSON.stringify({
		main,
		output: path.join(outDir, process.platform == 'win32' ? 'nyuu.exe' : 'nyuu'),
		disableExperimentalSEAWarning: true,
		useCodeCache: true,
		assets: { 'yencode.node': yencodeNode }
	}));
	execFileSync(process.execPath, ['--build-sea', config], { stdio: 'inherit' });
});
