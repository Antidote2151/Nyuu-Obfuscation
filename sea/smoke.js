// Smoke test for a built binary: uploads a random file to the dummy NNTP server and checks every yEnc part's CRC.
// Usage: node sea/smoke.js <path to nyuu binary>
"use strict";
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { execFile } = require('child_process');
const assert = require('assert');
const NNTPServer = require('../test/_nntpsrv');

const exe = path.resolve(process.argv[2]);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyuu-smoke-'));
const file = path.join(dir, 'data.bin');
const nzb = path.join(dir, 'out.nzb');
const data = require('crypto').randomBytes(1500000);
fs.writeFileSync(file, data);

const server = new NNTPServer({});
server.listen(0, () => {
	const port = String(server.server.address().port);
	execFile(exe, ['-h', '127.0.0.1', '-P', port, '-g', 'limbs', '-a', '500K', '-o', nzb, '--progress', 'none', file], (err, stdout, stderr) => {
		server.close();
		if(err) { console.error(stderr); throw err; }
		const posts = Object.values(server.postIdMap);
		assert.equal(posts.length, 3);
		for(const p of posts) {
			const m = p._msg.toString('latin1').match(/=ypart begin=(\d+) end=(\d+)[\s\S]*=yend .*pcrc32=([0-9a-f]{8})/i);
			assert(m, 'no yEnc part found');
			assert.equal(m[3].toLowerCase(), zlib.crc32(data.subarray(+m[1] - 1, +m[2])).toString(16).padStart(8, '0'));
		}
		assert(fs.statSync(nzb).size > 0);
		fs.rmSync(dir, { recursive: true });
		console.log('smoke test OK: ' + posts.length + ' parts uploaded, CRCs match');
	});
});
