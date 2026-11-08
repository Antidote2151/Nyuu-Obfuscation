// Builds Nyuu as a Node single executable application (SEA), using the Node binary running this script.
// Usage (Node >= 26): npm install --ignore-scripts && (cd sea && npm install) && node sea/build.js
"use strict";
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const browserify = require('browserify');

const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'out');
const exe = path.join(out, process.platform == 'win32' ? 'nyuu.exe' : 'nyuu');
const yencNode = path.join(root, 'node_modules/yencode/build/Release/yencode.node');
const helpJson = path.join(root, 'bin/help.json');

if(+process.versions.node.split('.')[0] < 26)
	throw new Error('Node >= 26 required, running ' + process.version);

// (re)build yencode for this Node; it defaults to -march=native, disable that so the binary runs on other CPUs
const yencGyp = path.join(root, 'node_modules/yencode/binding.gyp');
fs.writeFileSync(yencGyp, fs.readFileSync(yencGyp, 'utf8').replace('"enable_native_tuning%": 1', '"enable_native_tuning%": 0'));
execFileSync('npm', ['rebuild', 'yencode', '--foreground-scripts'], { cwd: root, stdio: 'inherit', shell: process.platform == 'win32' });

// loads the native yencode addon from the SEA asset; dlopen needs a real file, so cache it in tmp keyed by content hash
const prelude = `(function() {
	const sea = require('node:sea'), fs = require('node:fs'), path = require('node:path');
	const raw = new Uint8Array(sea.getRawAsset('yencode.node'));
	const file = path.join(require('node:os').tmpdir(), 'nyuu-yencode-' + require('node:crypto').createHash('sha256').update(raw).digest('hex').slice(0, 16) + '.node');
	if(!fs.existsSync(file)) {
		const tmp = file + '.' + process.pid;
		fs.writeFileSync(tmp, raw);
		try { fs.renameSync(tmp, file); } catch(x) { fs.rmSync(tmp, {force: true}); if(!fs.existsSync(file)) throw x; }
	}
	const yenc = { exports: {} };
	process.dlopen(yenc, file);
	const req = require;
	require = id => /yencode\\.node$/.test(id) ? yenc.exports : req(id);
})();
`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);

// embed help text (bin/nyuu.js prefers help.json over reading the .txt files)
fs.writeFileSync(helpJson, JSON.stringify({
	full: fs.readFileSync(path.join(root, 'help-full.txt')).toString(),
	short: fs.readFileSync(path.join(root, 'help.txt')).toString()
}));

const b = browserify([path.join(root, 'bin/nyuu.js')], { detectGlobals: true, node: true });
b.exclude(yencNode);
b.exclude('worker_threads');
b.exclude(path.join(root, 'nexe/node_modules/nexe/package.json'));

b.bundle((err, src) => {
	fs.rmSync(helpJson);
	if(err) throw err;
	const main = path.join(out, 'nyuu.js');
	fs.writeFileSync(main, prelude + src);

	const config = path.join(out, 'sea-config.json');
	fs.writeFileSync(config, JSON.stringify({
		main,
		output: exe,
		disableExperimentalSEAWarning: true,
		useCodeCache: true,
		assets: { 'yencode.node': yencNode }
	}));
	execFileSync(process.execPath, ['--build-sea', config], { stdio: 'inherit' });
	if(process.platform == 'darwin') // unsigned binaries don't run on Apple Silicon; ad-hoc sign
		execFileSync('codesign', ['--sign', '-', exe], { stdio: 'inherit' });

	// smoke test; the prelude loads yencode on startup, so this also checks the addon
	console.log(execFileSync(exe, ['--version']).toString().trim());
	console.log('built ' + exe);
});
