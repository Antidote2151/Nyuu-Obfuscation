(function() {
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
	require = id => /yencode\.node$/.test(id) ? yenc.exports : req(id);
})();
