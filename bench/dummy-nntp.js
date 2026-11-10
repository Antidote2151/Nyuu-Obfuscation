"use strict";
// Dummy NNTP(S) server for measuring Nyuu's own upper throughput bound without a real provider.
// Accepts any AUTHINFO, answers POST with 340 and every article with 240; data is discarded.
// Usage: node bench/dummy-nntp.js [port=5563] [processes=8] [--plain]
const cluster = require('cluster');
const fs = require('fs');
const path = require('path');

const port = +process.argv[2] || 5563;
const procs = +process.argv[3] || 8;
const plain = process.argv.includes('--plain');

if (cluster.isPrimary) {
	cluster.schedulingPolicy = cluster.SCHED_RR; // Windows defaults to OS distribution, which piles connections onto few processes
	for (let i = 0; i < procs; i++) cluster.fork();
	console.log(`dummy NNTP${plain ? '' : 'S'} on 127.0.0.1:${port}, ${procs} processes`);
	return;
}

const ARTICLE_END = Buffer.from('\r\n.\r\n');
const onConn = sock => {
	let posting = false, cmd = '', tail = Buffer.alloc(0);
	sock.on('error', () => {});
	sock.write('200 dummy ready\r\n');
	sock.on('data', chunk => {
		while (chunk.length) {
			if (posting) {
				// search for terminator, including across chunk boundaries via the last 4 bytes of the previous chunk
				const probe = tail.length ? Buffer.concat([tail, chunk.subarray(0, 4)]) : null;
				let end = probe ? probe.indexOf(ARTICLE_END) : -1;
				if (end >= 0) end = end + 5 - tail.length;
				else {
					end = chunk.indexOf(ARTICLE_END);
					if (end >= 0) end += 5;
				}
				if (end < 0) {
					tail = Buffer.from(chunk.subarray(Math.max(0, chunk.length - 4)));
					return;
				}
				posting = false;
				tail = Buffer.alloc(0);
				sock.write('240 article received\r\n');
				chunk = chunk.subarray(end);
				continue;
			}
			const nl = chunk.indexOf('\n');
			if (nl < 0) { cmd += chunk.toString('latin1'); return; }
			const line = (cmd + chunk.toString('latin1', 0, nl)).trim();
			cmd = '';
			chunk = chunk.subarray(nl + 1);
			const verb = line.split(' ', 2).join(' ').toUpperCase();
			if (verb === 'AUTHINFO USER') sock.write('381 more\r\n');
			else if (verb === 'AUTHINFO PASS') sock.write('281 ok\r\n');
			else if (verb.startsWith('POST')) { posting = true; sock.write('340 send\r\n'); }
			else if (verb.startsWith('QUIT')) sock.end('205 bye\r\n');
			else if (verb.startsWith('DATE')) sock.write('111 20260101000000\r\n');
			else if (verb.startsWith('GROUP')) sock.write('211 0 0 0 ' + line.slice(6) + '\r\n');
			else if (line) sock.write('500 unknown\r\n');
		}
	});
};

const certDir = path.join(__dirname, '..', 'test');
const server = plain ? require('net').createServer(onConn) : require('tls').createServer({
	key: fs.readFileSync(path.join(certDir, '_ssl.key')),
	cert: fs.readFileSync(path.join(certDir, '_ssl.crt')),
}, onConn);
server.listen(port, '127.0.0.1');
