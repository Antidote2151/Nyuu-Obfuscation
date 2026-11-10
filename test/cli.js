"use strict";

// End-to-end tests of the command line interface: runs bin/nyuu.js as a separate process against the test NNTP
// server and checks the effect of (nearly) every option in help-full.txt - uploaded data, article headers,
// NZB contents, what the server received, console output and exit codes.

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var os = require('os');
var net = require('net');
var http = require('http');
var zlib = require('zlib');
var crypto = require('crypto');
var spawn = require('child_process').spawn;
var y = require('yencode');
var NNTPServer = require('./_nntpsrv');
var cliUtil = require('../cli/util');

var NYUU = path.join(__dirname, '..', 'bin', 'nyuu.js');
var NODE_MAJOR = +process.versions.node.split('.')[0];
var GROUP = 'limbs'; // one of the groups the test server accepts

(NODE_MAJOR >= 12 ? describe : describe.skip)('CLI', function() {
this.timeout(40000);

var tmpRoot, tmpCount = 0, servers = [];
before(function() {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nyuu-cli-'));
});
after(function() {
	if(fs.rmSync) fs.rmSync(tmpRoot, {recursive: true, force: true});
});
afterEach(function() {
	servers.forEach(function(s) {
		s._sockets.forEach(function(c) { c.destroy(); });
		try { s.server.close(); } catch(x) {}
	});
	servers = [];
});

var mkTmp = function() {
	var d = path.join(tmpRoot, 'r' + (++tmpCount));
	fs.mkdirSync(d);
	return d;
};
var mkFile = function(dir, name, size) {
	var data = crypto.randomBytes(size);
	var file = path.join(dir, name);
	if(!fs.existsSync(path.dirname(file))) fs.mkdirSync(path.dirname(file), {recursive: true});
	fs.writeFileSync(file, data);
	return data;
};
var crcHex = function(buf) {
	return y.crc32(buf).toString('hex');
};

// opts: ssl, onConnect(conn) (return false to drop the connection), onRequest(req, data) (this = connection; return true if handled), postDataHook, host
var startServer = function(opts, cb) {
	if(typeof opts == 'function') {
		cb = opts;
		opts = {};
	}
	var s = new NNTPServer({ssl: !!opts.ssl, halfOpen: !!opts.halfOpen});
	s._sockets = [];
	s.conns = [];
	s.onConnect(function(conn) {
		s._sockets.push(conn.conn);
		s.conns.push(conn);
		// record connection details now; they're gone once the client disconnects
		conn.remoteAddress = conn.conn.remoteAddress;
		if(conn.conn.getProtocol) {
			conn.protocol = conn.conn.getProtocol();
			conn.cipher = (conn.conn.getCipher() || {}).name;
			conn.servername = conn.conn.servername;
		}
		conn.conn.removeAllListeners('error');
		conn.conn.on('error', function() {}); // clients being torn down is expected
		if(opts.onConnect) return opts.onConnect(conn);
	});
	if(opts.onRequest) s.onRequest(opts.onRequest);
	if(opts.postDataHook) s.postDataHook = opts.postDataHook;
	s.server.listen(0, opts.host || '127.0.0.1', function() {
		s.port = s.server.address().port;
		cb(s);
	});
	servers.push(s);
};
var startServers = function(n, opts, cb) {
	var list = [];
	(function next() {
		if(list.length == n) return cb.apply(null, list);
		startServer(opts, function(s) {
			list.push(s);
			next();
		});
	})();
};

// a server that accepts connections but never says anything
var startSilentServer = function(cb) {
	var sockets = [];
	var srv = net.createServer(function(c) { sockets.push(c); c.on('error', function() {}); });
	srv.listen(0, '127.0.0.1', function() {
		servers.push({server: srv, _sockets: sockets});
		cb(srv.address().port);
	});
};

var srvArgs = function(s, extra) {
	return ['-h', '127.0.0.1', '-P', s.port, '-g', GROUP].concat(extra || []);
};

// runs Nyuu; opts: cwd, stdin, env, during(child), killAfter
var run = function(args, opts, cb) {
	if(typeof opts == 'function') {
		cb = opts;
		opts = {};
	}
	var cwd = opts.cwd || mkTmp();
	var start = Date.now();
	var child = spawn(process.execPath, [NYUU].concat(args.map(String)), {cwd: cwd, env: opts.env || process.env});
	var out = [], err = [];
	child.stdout.on('data', function(d) { out.push(d); });
	child.stderr.on('data', function(d) { err.push(d); });
	child.stdin.on('error', function() {});
	child.stdin.end(opts.stdin);
	var killTimer = setTimeout(function() { child.kill(); }, opts.killAfter || 30000);
	if(opts.during) opts.during(child);
	child.on('close', function(code) {
		clearTimeout(killTimer);
		var stdout = Buffer.concat(out);
		cb({code: code, stdout: stdout, out: stdout.toString(), err: Buffer.concat(err).toString(), cwd: cwd, time: Date.now() - start});
	});
};
var ok = function(r) {
	assert.equal(r.code, 0, 'exit code ' + r.code + ', stderr:\n' + r.err);
};

// parses an article stored by the test server
var parseArticle = function(post) {
	var msg = post._msg; // binary string
	var l1 = msg.indexOf('\r\n'), l2 = msg.indexOf('\r\n', l1 + 2);
	var ybegin = msg.substring(0, l1), ypart = msg.substring(l1 + 2, l2);
	assert(/^=ybegin /.test(ybegin), 'yEnc begin line: ' + ybegin.substring(0, 80));
	assert(/^=ypart /.test(ypart), 'yEnc part line: ' + ypart.substring(0, 80));
	var endPos = msg.lastIndexOf('\r\n=yend ');
	assert(endPos > 0, 'yEnc end line');
	var props = function(line) {
		var r = {};
		line.replace(/ ([a-z0-9]+)=(\S*)/g, function(m, k, v) { r[k] = v; });
		return r;
	};
	var b = props(ybegin.replace(/ name=.*$/, ''));
	b.name = Buffer.from((ybegin.match(/ name=(.*)$/) || ['', ''])[1], 'binary').toString();
	var raw = Buffer.from(msg.substring(l2 + 2, endPos + 2), 'binary');
	return {
		headers: post,
		ybegin: b,
		ypart: props(ypart),
		yend: props(msg.substring(endPos + 2)),
		lines: msg.substring(l2 + 2, endPos).split('\r\n'),
		data: y.decode(raw, true),
		bytes: Buffer.byteLength(msg, 'binary') + 5 // + "\r\n.\r\n"
	};
};

var unxml = function(s) {
	return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
};
var parseNzb = function(xml) {
	if(Buffer.isBuffer(xml)) xml = xml.toString();
	var r = {meta: {}, files: [], xml: xml};
	xml.replace(/<meta type="([^"]*)">([^<]*)<\/meta>/g, function(m, k, v) {
		k = unxml(k);
		(r.meta[k] = r.meta[k] || []).push(unxml(v));
	});
	xml.replace(/<file poster="([^"]*)" date="(\d+)" subject="([^"]*)">([\s\S]*?)<\/file>/g, function(m, poster, date, subject, body) {
		var f = {poster: unxml(poster), date: +date, subject: unxml(subject), groups: [], segments: []};
		body.replace(/<group>([^<]*)<\/group>/g, function(m, g) { f.groups.push(unxml(g)); });
		body.replace(/<segment bytes="(\d+)" number="(\d+)">([^<]*)<\/segment>/g, function(m, b, n, id) {
			f.segments.push({bytes: +b, number: +n, id: unxml(id)});
		});
		r.files.push(f);
	});
	return r;
};
var readNzb = function(file) {
	return parseNzb(fs.readFileSync(file));
};

// checks that each file in the NZB is completely on the server(s) and decodes to one of the expected inputs
// expected: {name: Buffer}; returns [{file, articles, name}] in NZB order
var verify = function(srvs, nzb, expected) {
	srvs = [].concat(srvs);
	assert.equal(nzb.files.length, Object.keys(expected).length, 'number of files in NZB');
	var seen = {};
	return nzb.files.map(function(f) {
		f.segments.sort(function(a, b) { return a.number - b.number; });
		var arts = f.segments.map(function(seg, i) {
			assert.equal(seg.number, i + 1, 'segment numbering');
			var post = null;
			srvs.forEach(function(s) { post = post || s.postIdMap[seg.id]; });
			assert(post, 'article ' + seg.id + ' missing on server');
			var a = parseArticle(post);
			assert.equal(seg.bytes, a.bytes, 'segment size in NZB');
			assert.equal(a.ybegin.part, String(i + 1), 'yEnc part');
			assert.equal(a.ybegin.total, String(f.segments.length), 'yEnc total');
			assert.equal(a.yend.pcrc32, crcHex(a.data), 'part CRC');
			assert.equal(+a.ypart.end - +a.ypart.begin + 1, a.data.length, 'ypart range');
			return a;
		});
		var data = Buffer.concat(arts.map(function(a) { return a.data; }));
		var names = Object.keys(expected).filter(function(k) { return !seen[k] && expected[k].equals(data); });
		assert.equal(names.length, 1, 'decoded data of "' + f.subject + '" matches an input file');
		seen[names[0]] = true;
		var last = arts[arts.length - 1];
		assert.equal(last.yend.crc32, crcHex(data), 'file CRC');
		assert.equal(arts[0].ybegin.size, String(data.length), 'yEnc size');
		return {file: f, articles: arts, name: names[0]};
	});
};
var allArticles = function(s) {
	return Object.keys(s.postIdMap).map(function(id) { return parseArticle(s.postIdMap[id]); });
};
var httpGet = function(url, cb) {
	http.get(url, function(res) {
		var d = '';
		res.on('data', function(c) { d += c; });
		res.on('end', function() { cb(null, d); });
	}).on('error', cb);
};
var freePort = function(cb) {
	var srv = net.createServer().listen(0, '127.0.0.1', function() {
		var p = srv.address().port;
		srv.close(function() { cb(p); });
	});
};
var msgIdOf = function(raw) {
	return (raw.match(/^Message-ID: *<([^>]*)>/im) || [])[1];
};


describe('basics', function() {
	it('uploads files with correct data, yEnc and NZB', function(done) {
		startServer(function(s) {
			var dir = mkTmp();
			var exp = {'a.bin': mkFile(dir, 'a.bin', 250000), 'b.bin': mkFile(dir, 'b.bin', 102400), 'c.bin': mkFile(dir, 'c.bin', 1)};
			run(srvArgs(s, ['-a', '100K', '-o', 'out.nzb', 'a.bin', 'b.bin', 'c.bin']), {cwd: dir}, function(r) {
				ok(r);
				var nzb = readNzb(path.join(dir, 'out.nzb'));
				var res = verify(s, nzb, exp);
				var counts = {};
				res.forEach(function(x) { counts[x.name] = x.articles.length; });
				assert.deepEqual(counts, {'a.bin': 3, 'b.bin': 1, 'c.bin': 1});
				res.forEach(function(x) {
					// file numbers follow the input order; the order of files in the NZB can differ
					var num = Object.keys(exp).indexOf(x.name) + 1;
					assert.equal(x.file.subject, '[' + num + '/3] - "' + x.name + '" yEnc (1/' + x.articles.length + ') ' + exp[x.name].length);
					assert.equal(x.articles[0].ybegin.name, x.name);
					assert.deepEqual(x.file.groups, [GROUP]);
				});
				assert(/Finished uploading .+ in .+ \(.+\/s\)\. Network upload rate: .+\/s/.test(r.err), r.err);
				done();
			});
		});
	});
	it('exits with 1 on invalid usage', function(done) {
		run(['--no-such-option', 'x'], function(r) {
			assert.equal(r.code, 1);
			run(['-h', '127.0.0.1'], function(r) {
				assert.equal(r.code, 1, 'no input files');
				run(['-h', '127.0.0.1', '-a', 'zzz', 'x'], function(r) {
					assert.equal(r.code, 1, 'bad size value');
					done();
				});
			});
		});
	});
	it('exits with 33 if the server cannot be reached', function(done) {
		freePort(function(port) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 1000);
			run(['-h', '127.0.0.1', '-P', port, '--connect-retries', '0', 'a.bin'], {cwd: dir}, function(r) {
				assert.equal(r.code, 33, r.err);
				assert(/ECONNREFUSED|connect/i.test(r.err), r.err);
				done();
			});
		});
	});
	it('--help, --help-full, --version, --package-info', function(done) {
		var pkg = require('../package.json');
		run(['--help-full'], function(r) {
			ok(r);
			var full = fs.readFileSync(path.join(__dirname, '..', 'help-full.txt'), 'utf8').replace(/\r\n/g, '\n');
			assert.equal(r.err.replace(/\r\n/g, '\n').trim(), full.replace(/^Nyuu(\n)/, 'Nyuu v' + pkg.version + '$1').trim());
			run(['--help'], function(r) {
				ok(r);
				assert(r.err.indexOf('Nyuu v' + pkg.version) == 0);
				assert(r.err.length < full.length);
				run(['--version'], function(r) {
					ok(r);
					assert.equal((r.out + r.err).trim(), pkg.version);
					run(['--package-info'], function(r) {
						ok(r);
						assert(/yencode/.test(r.out + r.err) && /async/.test(r.out + r.err));
						done();
					});
				});
			});
		});
	});
});

describe('upload server options', function() {
	it('-4 (--ipv4)', function(done) {
		startServer(function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			run(['-h', 'localhost', '-P', s.port, '-g', GROUP, '-4', '-o', 'o.nzb', 'a.bin'], {cwd: dir}, function(r) {
				ok(r);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				done();
			});
		});
	});
	it('-6 (--ipv6)', function(done) {
		var hasV6 = Object.keys(os.networkInterfaces()).some(function(k) {
			return os.networkInterfaces()[k].some(function(i) { return i.family == 'IPv6' || i.family === 6; });
		});
		if(!hasV6) return this.skip();
		startServer({host: '::1'}, function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			run(['-h', 'localhost', '-P', s.port, '-g', GROUP, '-6', '-o', 'o.nzb', 'a.bin'], {cwd: dir}, function(r) {
				ok(r);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				done();
			});
		});
	});
	it('--bind-host', function(done) {
		startServer(function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 5000);
			run(srvArgs(s, ['--bind-host', '127.0.0.1', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				assert(s.conns.length > 0);
				s.conns.forEach(function(c) { assert(/127\.0\.0\.1$/.test(c.remoteAddress), c.remoteAddress); });
				done();
			});
		});
	});
	it('--tcp-keep-alive', function(done) {
		startServer(function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			run(srvArgs(s, ['--tcp-keep-alive', '1s', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				done();
			});
		});
	});
	it('-S without --ignore-cert rejects an untrusted certificate', function(done) {
		startServer({ssl: true}, function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 5000);
			run(srvArgs(s, ['-S', '--connect-retries', '0', 'a.bin']), {cwd: dir}, function(r) {
				assert.equal(r.code, 33, r.err);
				assert(/certificate|self.signed/i.test(r.err), r.err);
				assert.equal(Object.keys(s.postIdMap).length, 0);
				done();
			});
		});
	});
	it('-S --ignore-cert', function(done) {
		startServer({ssl: true}, function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 250000)};
			run(srvArgs(s, ['-S', '--ignore-cert', '-a', '100K', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				done();
			});
		});
	});
	it('--ssl-ca and --sni-host', function(done) {
		startServer({ssl: true}, function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			// the test certificate is issued for CN=nyuu
			run(srvArgs(s, ['-S', '--ssl-ca', path.join(__dirname, '_ssl.crt'), '--sni-host', 'nyuu', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				s.conns.forEach(function(c) { assert.equal(c.servername, 'nyuu'); });
				done();
			});
		});
	});
	it('--ssl-method and --ssl-ciphers', function(done) {
		startServer({ssl: true}, function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 5000);
			run(srvArgs(s, ['-S', '--ignore-cert', '--ssl-method', 'TLSv1_2_method', '--ssl-ciphers', 'ECDHE-RSA-AES128-GCM-SHA256', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				assert(s.conns.length > 0);
				s.conns.forEach(function(c) {
					assert.equal(c.protocol, 'TLSv1.2');
					assert.equal(c.cipher, 'ECDHE-RSA-AES128-GCM-SHA256');
				});
				done();
			});
		});
	});
	it('-u and -p', function(done) {
		startServer(function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 5000);
			run(srvArgs(s, ['-u', 'joe', '-p', 's3cret', '-n', '1', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				assert.deepEqual(s.commands.slice(0, 2), ['AUTHINFO USER joe', 'AUTHINFO PASS s3cret']);
				run(srvArgs(s, ['a.bin']), {cwd: dir}, function(r) {
					ok(r);
					assert.equal(s.commands.filter(function(c) { return /^AUTHINFO/.test(c); }).length, 2, 'no login without -u');
					done();
				});
			});
		});
	});
	it('-n (--connections)', function(done) {
		startServer(function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 600000);
			run(srvArgs(s, ['-n', '3', '-a', '100K', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				assert.equal(s.connCount, 3);
				done();
			});
		});
	});
	it('--server adds servers with their own login, TLS and connection count', function(done) {
		startServer(function(s1) {
			startServer({ssl: true}, function(s2) {
				var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 1500000)};
				run(srvArgs(s1, ['-u', 'main', '-p', 'pw1', '-n', '2', '--ignore-cert', '-a', '100K', '--server', 'nntps://second:pw2@127.0.0.1:' + s2.port + '?connections=3', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
					ok(r);
					verify([s1, s2], readNzb(path.join(dir, 'o.nzb')), exp);
					assert.equal(s1.connCount, 2);
					assert.equal(s2.connCount, 3);
					assert(Object.keys(s1.postIdMap).length > 0 && Object.keys(s2.postIdMap).length > 0, 'both servers got posts');
					assert(s1.commands.indexOf('AUTHINFO USER main') >= 0 && s1.commands.indexOf('AUTHINFO USER second') < 0);
					assert(s2.commands.indexOf('AUTHINFO USER second') >= 0 && s2.commands.indexOf('AUTHINFO PASS pw2') >= 0);
					done();
				});
			});
		});
	});
	it('--server without --host is the main server', function(done) {
		startServer(function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			run(['-g', GROUP, '--server', 'nntp://127.0.0.1:' + s.port + '?connections=2', '-o', 'o.nzb', 'a.bin'], {cwd: dir}, function(r) {
				ok(r);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				done();
			});
		});
	});
	it('--server rejects invalid values', function(done) {
		run(['-h', '127.0.0.1', '--server', 'ftp://x', 'a.bin'], function(r) {
			assert.equal(r.code, 1);
			assert(/--server/.test(r.err), r.err);
			done();
		});
	});
	it('--max-upload-rate', function(done) {
		startServer(function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 600000)};
			run(srvArgs(s, ['--max-upload-rate', '200K/s', '-a', '100K', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				assert(r.time > 1500, 'took ' + r.time + 'ms, expected throttling');
				done();
			});
		});
	});
	it('--timeout and --request-retries', function(done) {
		var swallow = function(n) {
			return function(req) {
				if(req == 'POST' && n-- > 0) return true; // never answer
			};
		};
		startServer({onRequest: swallow(1)}, function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			run(srvArgs(s, ['--timeout', '300ms', '--request-retries', '1', '-n', '1', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				assert(/timed out/i.test(r.err), r.err);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				startServer({onRequest: swallow(1)}, function(s) {
					run(srvArgs(s, ['--timeout', '300ms', '--request-retries', '0', '--connect-retries', '0', '-n', '1', 'a.bin']), {cwd: dir}, function(r) {
						assert.equal(r.code, 33, r.err);
						done();
					});
				});
			});
		});
	});
	it('--connect-timeout', function(done) {
		startSilentServer(function(port) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 5000);
			run(['-h', '127.0.0.1', '-P', port, '--connect-timeout', '300ms', '--connect-retries', '0', 'a.bin'], {cwd: dir}, function(r) {
				assert.equal(r.code, 33, r.err);
				assert(r.time < 10000);
				assert(/time/i.test(r.err), r.err);
				done();
			});
		});
	});
	it('--connect-retries and --reconnect-delay', function(done) {
		var dropFirst = function() {
			var n = 0;
			return function(conn) {
				if(n++ == 0) {
					conn.conn.destroy();
					return false;
				}
			};
		};
		startServer({onConnect: dropFirst()}, function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			run(srvArgs(s, ['-n', '1', '--connect-retries', '1', '--reconnect-delay', '500ms', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				assert.equal(s.connCount, 2);
				assert(r.time >= 500);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				startServer({onConnect: dropFirst()}, function(s) {
					run(srvArgs(s, ['-n', '1', '--connect-retries', '0', 'a.bin']), {cwd: dir}, function(r) {
						assert.equal(r.code, 33, r.err);
						done();
					});
				});
			});
		});
	});
	it('--retry-on-bad-resp and --error-teardown', function(done) {
		var badFirst = function() {
			var n = 0;
			return function(req) {
				if(req == 'POST' && n++ == 0) {
					this._respond(999, 'what?');
					return true;
				}
			};
		};
		startServer({onRequest: badFirst()}, function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			run(srvArgs(s, ['-n', '1', '--connect-retries', '0', 'a.bin']), {cwd: dir}, function(r) {
				assert.equal(r.code, 33, 'bad response is fatal by default\n' + r.err);
				startServer({onRequest: badFirst()}, function(s) {
					run(srvArgs(s, ['-n', '1', '--retry-on-bad-resp', '--reconnect-delay', '0', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
						ok(r);
						verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
						startServer({onRequest: badFirst()}, function(s) {
							run(srvArgs(s, ['-n', '1', '--retry-on-bad-resp', '--error-teardown', '--reconnect-delay', '0', '-o', 'o.nzb', '-O', 'a.bin']), {cwd: dir}, function(r) {
								ok(r);
								verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
								done();
							});
						});
					});
				});
			});
		});
	});
	it('--post-retries and --post-retry-delay', function(done) {
		var rejectFirst = function() {
			var n = 0;
			return function() { if(n++ == 0) return 441; };
		};
		startServer({postDataHook: rejectFirst()}, function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			run(srvArgs(s, ['-n', '1', '--post-retries', '1', '--post-retry-delay', '700ms', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				assert(r.time >= 700);
				assert(/441/.test(r.err), r.err);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				startServer({postDataHook: rejectFirst()}, function(s) {
					run(srvArgs(s, ['-n', '1', '--post-retries', '0', 'a.bin']), {cwd: dir}, function(r) {
						assert.equal(r.code, 33, r.err);
						done();
					});
				});
			});
		});
	});
	it('--post-fail-reconnect', function(done) {
		var n = 0;
		startServer({postDataHook: function() { if(n++ == 0) return 441; }}, function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			run(srvArgs(s, ['-n', '1', '--post-fail-reconnect', '--reconnect-delay', '0', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				assert(s.connCount >= 2, 'reconnected');
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				done();
			});
		});
	});
	it('--disconnect-timeout', function(done) {
		startServer({halfOpen: true, onRequest: function(req) { return req == 'QUIT'; }}, function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 5000);
			run(srvArgs(s, ['-n', '1', '--disconnect-timeout', '300ms', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				assert(/Disconnect timed out/.test(r.err), r.err);
				assert(r.time < 4000, 'took ' + r.time + 'ms');
				done();
			});
		});
	});
	it('--keep-alive', function(done) {
		startServer(function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			run(srvArgs(s, ['--keep-alive', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				done();
			});
		});
	});
});

describe('article options', function() {
	var upload = function(extra, files, cb) {
		startServer(function(s) {
			var dir = mkTmp(), exp = {};
			Object.keys(files).forEach(function(f) { exp[f] = mkFile(dir, f, files[f]); });
			// srvArgs passes -g, and options may only be given once
			var base = extra.indexOf('-g') >= 0 ? ['-h', '127.0.0.1', '-P', s.port] : srvArgs(s);
			run(base.concat(extra, ['-o', 'o.nzb'], Object.keys(files)), {cwd: dir}, function(r) {
				ok(r);
				var nzb = readNzb(path.join(dir, 'o.nzb'));
				cb(verify(s, nzb, exp), nzb, s, r);
			});
		});
	};
	it('-a (--article-size)', function(done) {
		upload(['-a', '100K'], {'a.bin': 250000}, function(res) {
			assert.deepEqual(res[0].articles.map(function(a) { return a.data.length; }), [102400, 102400, 45200]);
			done();
		});
	});
	it('--article-line-size', function(done) {
		upload(['--article-line-size', '64'], {'a.bin': 20000}, function(res) {
			var a = res[0].articles[0];
			assert.equal(a.ybegin.line, '64');
			a.lines.forEach(function(l) { assert(l.length <= 65, 'line length ' + l.length); });
			assert(a.lines.length > 20000 / 65);
			done();
		});
	});
	it('-t (--comment) and --comment2', function(done) {
		upload(['-t', 'Pre', '--comment2', 'Post'], {'a.bin': 1000}, function(res) {
			assert.equal(res[0].articles[0].headers.subject, 'Pre "a.bin" yEnc (1/1) 1000 Post');
			done();
		});
	});
	it('-F (--group-files)', function(done) {
		var files = {'x.part1.rar': 1000, 'x.part2.rar': 1000, 'y.txt': 1000};
		upload([], files, function(res) {
			var subj = {};
			// file counter in the default subject; collections with a single file get none
			var counter = function(x) { return (x.file.subject.match(/^\[\d+\/\d+\]/) || [''])[0]; };
			res.forEach(function(x) { subj[x.name] = counter(x); });
			assert.deepEqual(subj, {'x.part1.rar': '[1/3]', 'x.part2.rar': '[2/3]', 'y.txt': '[3/3]'});
			upload(['-F'], files, function(res) {
				res.forEach(function(x) { subj[x.name] = counter(x); });
				assert.deepEqual(subj, {'x.part1.rar': '[1/2]', 'x.part2.rar': '[2/2]', 'y.txt': ''});
				done();
			});
		});
	});
	it('-s (--subject) with all tokens', function(done) {
		var subj = '{filenum}|{0filenum}|{files}|{filename}|{fnamebase}|{filesize}|{fileksize}|{filemsize}|{fileasize}|{part}|{0part}|{parts}|{size}|{comment}|{comment2}|${rand(6)}|{timestamp}';
		upload(['-s', subj, '-t', 'C1', '--comment2', 'C2', '-a', '100K'], {'a.bin': 1000000}, function(res) {
			var arts = res[0].articles;
			assert.equal(arts.length, 10);
			var p = arts[1].headers.subject.split('|');
			assert.deepEqual(p.slice(0, 15), ['1', '1', '1', 'a.bin', 'a', '1000000', (1000000 / 1024).toFixed(2), (1000000 / 1048576).toFixed(2), cliUtil.friendlySize(1000000), '2', '02', '10', '102400', 'C1', 'C2']);
			assert.equal(p[15].length, 6);
			assert(/^\d{10,}$/.test(p[16]), 'timestamp ' + p[16]);
			assert.notEqual(arts[0].headers.subject.split('|')[15], p[15], 'rand differs per post');
			assert.equal(res[0].file.subject, arts[0].headers.subject, 'NZB uses first subject');
			done();
		});
	});
	it('--filename', function(done) {
		startServer(function(s) {
			var dir = mkTmp(), exp = {'sub/a.bin': mkFile(dir, 'sub/a.bin', 1000)};
			run(srvArgs(s, ['--filename', 'X-{basename}', '-o', 'o.nzb', 'sub/a.bin']), {cwd: dir}, function(r) {
				ok(r);
				var res = verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				assert.equal(res[0].articles[0].ybegin.name, 'X-a.bin');
				assert(/"X-a\.bin"/.test(res[0].file.subject));
				run(srvArgs(s, ['--filename', '{pathname}/{basename}', '-o', 'o.nzb', '-O', 'sub/a.bin']), {cwd: dir}, function(r) {
					ok(r);
					var a = allArticles(s).filter(function(a) { return /a\.bin$/.test(a.ybegin.name) && a.ybegin.name != 'X-a.bin'; });
					assert.equal(a.length, 1);
					assert.equal(a[0].ybegin.name, 'sub/a.bin');
					done();
				});
			});
		});
	});
	it('-f (--from)', function(done) {
		upload(['-f', 'Joe <joe@example.com>'], {'a.bin': 1000}, function(res) {
			assert.equal(res[0].articles[0].headers.from, 'Joe <joe@example.com>');
			assert.equal(res[0].file.poster, 'Joe <joe@example.com>');
			done();
		});
	});
	it('options given twice are rejected', function(done) {
		run(['-h', '127.0.0.1', '-g', 'a', '-g', 'b', 'x'], function(r) {
			assert.equal(r.code, 1);
			assert(/specified more than once/.test(r.err), r.err);
			done();
		});
	});
	it('-g (--groups) with multiple groups', function(done) {
		upload(['-g', 'limbs,rifles'], {'a.bin': 1000}, function(res, nzb, s) {
			assert.equal(res[0].articles[0].headers.newsgroups, 'limbs,rifles');
			assert.deepEqual(res[0].file.groups, ['limbs', 'rifles']);
			assert.equal(s.groupNumPosts('rifles'), 1);
			done();
		});
	});
	it('--date', function(done) {
		upload(['--date', '2020-01-02T03:04:05Z'], {'a.bin': 1000}, function(res) {
			assert.equal(res[0].articles[0].headers.date, 'Thu, 02 Jan 2020 03:04:05 GMT');
			assert.equal(res[0].file.date, 1577934245);
			assert(/1577934245000/.test(res[0].articles[0].headers['message-id']), res[0].articles[0].headers['message-id']);
			done();
		});
	});
	it('--message-id', function(done) {
		upload(['--message-id', '{part}-{parts}-${rand(8)}@cli.test', '-a', '100K'], {'a.bin': 250000}, function(res) {
			res[0].file.segments.forEach(function(seg, i) {
				assert(new RegExp('^' + (i + 1) + '-3-.{8}@cli\\.test$').test(seg.id), seg.id);
			});
			done();
		});
	});
	it('--keep-message-id', function(done) {
		var tryIds = function(extra, cb) {
			var ids = [], n = 0;
			startServer({postDataHook: function(raw) { ids.push(msgIdOf(raw)); if(n++ == 0) return 441; }}, function(s) {
				var dir = mkTmp();
				mkFile(dir, 'a.bin', 1000);
				run(srvArgs(s, extra.concat(['-n', '1', '--post-retries', '1', 'a.bin'])), {cwd: dir}, function(r) {
					ok(r);
					assert.equal(ids.length, 2);
					cb(ids);
				});
			});
		};
		tryIds([], function(ids) {
			assert.notEqual(ids[0], ids[1], 'Message-ID is regenerated on retry');
			tryIds(['--keep-message-id'], function(ids) {
				assert.equal(ids[0], ids[1], 'Message-ID is kept on retry');
				done();
			});
		});
	});
	it('--obfuscate-articles', function(done) {
		var start = Date.now();
		upload(['--obfuscate-articles', '--date', '2020-01-02T03:04:05Z', '-a', '100K'], {'a.bin': 250000}, function(res) {
			var names = res[0].articles.map(function(a) { return a.ybegin.name; });
			names.forEach(function(n) { assert(/^[0-9a-f]{32,64}$/.test(n), 'random hex yEnc name: ' + n); });
			assert.equal(names.length, 3);
			assert.notEqual(names[0], names[1]);
			assert.equal(names[0].length, names[1].length, 'name length is fixed per file');
			res[0].articles.forEach(function(a) {
				var d = Date.parse(a.headers.date);
				assert(d >= start - 6 * 3600 * 1000 - 2000 && d <= Date.now() + 2000, 'random date within the last 6 hours: ' + a.headers.date);
			});
			assert(/"a\.bin"/.test(res[0].articles[0].headers.subject), 'subject is not changed');
			done();
		});
	});
	it('-H (--header) set, unset and with tokens', function(done) {
		upload(['-H', 'X-One: 1', '-H', 'X-Two=2', '-H', 'X-Part={part}/{parts}', '-H', 'From', '-a', '100K'], {'a.bin': 150000}, function(res) {
			res[0].articles.forEach(function(a, i) {
				assert.equal(a.headers['x-one'], '1');
				assert.equal(a.headers['x-two'], '2');
				assert.equal(a.headers['x-part'], (i + 1) + '/2');
				assert(!('from' in a.headers), 'From header removed');
			});
			done();
		});
	});
	it('--yenc-name', function(done) {
		upload(['--yenc-name', '{fnamebase}-{filenum}.dat'], {'a.bin': 1000}, function(res) {
			assert.equal(res[0].articles[0].ybegin.name, 'a-1.dat');
			done();
		});
	});
	it('--article-encoding', function(done) {
		upload(['-s', 'caf\u00e9 {part}'], {'a.bin': 1000}, function(res) {
			assert.equal(res[0].articles[0].headers.subject, Buffer.from('caf\u00e9 1').toString('binary'), 'utf8 by default');
			upload(['-s', 'caf\u00e9 {part}', '--article-encoding', 'latin1'], {'a.bin': 1000}, function(res) {
				assert.equal(res[0].articles[0].headers.subject, 'caf\u00e9 1', 'latin1 bytes');
				done();
			});
		});
	});
});

describe('post check options', function() {
	var checkArgs = ['-k', '1', '--check-delay', '100ms', '--check-retry-delay', '100ms'];
	it('-k checks every article with STAT', function(done) {
		startServer(function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 250000)};
			run(srvArgs(s, checkArgs.concat(['-a', '100K', '-o', 'o.nzb', 'a.bin'])), {cwd: dir}, function(r) {
				ok(r);
				var nzb = readNzb(path.join(dir, 'o.nzb'));
				verify(s, nzb, exp);
				nzb.files[0].segments.forEach(function(seg) {
					assert(s.commands.indexOf('STAT <' + seg.id + '>') >= 0, 'STAT for ' + seg.id);
				});
				done();
			});
		});
	});
	it('--check-tries 0 disables checking', function(done) {
		startServer(function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 5000);
			run(srvArgs(s, checkArgs.concat(['--check-tries', '0', 'a.bin'])), {cwd: dir}, function(r) {
				ok(r);
				assert(!s.commands.some(function(c) { return /^STAT/.test(c); }));
				done();
			});
		});
	});
	it('--check-post-tries re-posts missing articles', function(done) {
		startServer(function(s) {
			s.onPostHook = function() { return true; }; // first post silently goes missing
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			run(srvArgs(s, checkArgs.concat(['--check-tries', '1', '--check-post-tries', '1', '-o', 'o.nzb', 'a.bin'])), {cwd: dir}, function(r) {
				ok(r);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				assert.equal(s.commands.filter(function(c) { return c == 'POST'; }).length, 2);
				startServer(function(s) {
					s.onPostHook = function() { return true; };
					run(srvArgs(s, checkArgs.concat(['--check-tries', '1', '--check-post-tries', '0', 'a.bin'])), {cwd: dir}, function(r) {
						assert.notEqual(r.code, 0, 'missing article is an error');
						done();
					});
				});
			});
		});
	});
	it('--check-queue-size and --check-queue-cache', function(done) {
		startServer(function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 600000)};
			run(srvArgs(s, checkArgs.concat(['--check-queue-size', '1', '--check-queue-cache', '1', '-a', '100K', '-o', 'o.nzb', 'a.bin'])), {cwd: dir}, function(r) {
				ok(r);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				done();
			});
		});
	});
	it('--check-group', function(done) {
		startServer(function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 5000);
			run(srvArgs(s, checkArgs.concat(['--check-group', 'rifles', 'a.bin'])), {cwd: dir}, function(r) {
				ok(r);
				assert(s.commands.indexOf('GROUP rifles') >= 0, s.commands.join(', '));
				done();
			});
		});
	});
	it('--check-host, --check-port and --check-user use a separate server', function(done) {
		startServers(2, {}, function(post, check) {
			check.postIdMap = post.postIdMap; // same article store, like two frontends of one provider
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 5000);
			run(srvArgs(post, checkArgs.concat(['--check-host', '127.0.0.1', '--check-port', check.port, '--check-user', 'checker', '--check-password', 'x', 'a.bin'])), {cwd: dir}, function(r) {
				ok(r);
				assert(check.commands.some(function(c) { return /^STAT/.test(c); }), 'checked on check server');
				assert(!post.commands.some(function(c) { return /^STAT/.test(c); }), 'not checked on post server');
				assert(check.commands.indexOf('AUTHINFO USER checker') >= 0);
				assert(!check.commands.some(function(c) { return c == 'POST'; }));
				done();
			});
		});
	});
});

describe('error handling options', function() {
	var rejectPart = function(part) {
		return function(raw) { if(raw.indexOf('=ybegin part=' + part + ' ') >= 0) return 441; };
	};
	it('-e (--skip-errors) post-reject / all, exit code 32', function(done) {
		startServer({postDataHook: rejectPart(2)}, function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 250000);
			run(srvArgs(s, ['--post-retries', '0', '-a', '100K', '-e', 'post-reject', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				assert.equal(r.code, 32, r.err);
				assert.equal(readNzb(path.join(dir, 'o.nzb')).files[0].segments.length, 3, 'rejected post assumed successful');
				run(srvArgs(s, ['--post-retries', '0', '-a', '100K', '-e', 'all', '-o', 'o.nzb', '-O', 'a.bin']), {cwd: dir}, function(r) {
					assert.equal(r.code, 32, r.err);
					run(srvArgs(s, ['--post-retries', '0', '-a', '100K', 'a.bin']), {cwd: dir}, function(r) {
						assert.equal(r.code, 33, 'not skipped by default');
						done();
					});
				});
			});
		});
	});
	it('-e post-fail skips the post', function(done) {
		startServer({postDataHook: rejectPart(2)}, function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 250000);
			run(srvArgs(s, ['--post-retries', '0', '-a', '100K', '-e', 'post-fail', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				assert.equal(r.code, 32, r.err);
				// the post is skipped, i.e. not on the server; the NZB still lists it (same as upstream Nyuu)
				var nzb = readNzb(path.join(dir, 'o.nzb'));
				var missing = nzb.files[0].segments.filter(function(seg) { return !s.postIdMap[seg.id]; });
				assert.equal(missing.length, 1, 'exactly the failed post is not on the server');
				assert.equal(missing[0].number, 2);
				done();
			});
		});
	});
	it('--post-error-limit', function(done) {
		startServer({postDataHook: function() { return 441; }}, function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 500000);
			run(srvArgs(s, ['--post-retries', '0', '-a', '100K', '-n', '1', '-e', 'post-reject', '--post-error-limit', '2', 'a.bin']), {cwd: dir}, function(r) {
				assert.equal(r.code, 33, r.err);
				assert(s.commands.filter(function(c) { return c == 'POST'; }).length < 5, 'aborted before all posts');
				done();
			});
		});
	});
	it('--use-lazy-connect', function(done) {
		startServer(function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 1000);
			run(srvArgs(s, ['-n', '4', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				var eager = s.connCount;
				startServer(function(s) {
					run(srvArgs(s, ['-n', '4', '--use-lazy-connect', 'a.bin']), {cwd: dir}, function(r) {
						ok(r);
						assert(s.connCount < eager, 'lazy: ' + s.connCount + ', eager: ' + eager);
						done();
					});
				});
			});
		});
	});
	it('--on-post-timeout retry / ignore / strip-hdr', function(done) {
		var silentFirst = function() {
			var n = 0;
			return function() { if(n++ == 0) return 'silent'; };
		};
		var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
		var base = ['-n', '1', '--timeout', '300ms', '--reconnect-delay', '0', '-o', 'o.nzb', '-O'];
		startServer({postDataHook: silentFirst()}, function(s) {
			run(srvArgs(s, base.concat(['--on-post-timeout', 'retry', 'a.bin'])), {cwd: dir}, function(r) {
				ok(r);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				startServer({postDataHook: silentFirst()}, function(s) {
					run(srvArgs(s, base.concat(['--on-post-timeout', 'ignore', 'a.bin'])), {cwd: dir}, function(r) {
						ok(r);
						assert.equal(Object.keys(s.postIdMap).length, 0, 'post assumed successful without retry');
						assert.equal(readNzb(path.join(dir, 'o.nzb')).files[0].segments.length, 1);
						startServer({postDataHook: silentFirst()}, function(s) {
							run(srvArgs(s, base.concat(['-H', 'X-Strip=1', '--on-post-timeout', 'strip-hdr=X-Strip', 'a.bin'])), {cwd: dir}, function(r) {
								ok(r);
								var res = verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
								assert(!('x-strip' in res[0].articles[0].headers), 'header stripped on retry');
								done();
							});
						});
					});
				});
			});
		});
	});
	['IHAVE', 'XREPLIC', 'TAKETHIS'].forEach(function(method) {
		it('--post-method ' + method, function(done) {
			startServer(function(s) {
				var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 250000)};
				run(srvArgs(s, ['--post-method', method, '-a', '100K', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
					ok(r);
					verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
					assert.equal(s.commands.filter(function(c) { return c.split(' ')[0] == method; }).length, 3);
					assert(s.commands.indexOf('POST') < 0);
					done();
				});
			});
		});
	});
	it('--use-ihave', function(done) {
		startServer(function(s) {
			var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 5000)};
			run(srvArgs(s, ['--use-ihave', '-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				var res = verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				assert(s.commands.indexOf('IHAVE <' + res[0].file.segments[0].id + '>') >= 0, s.commands.join(', '));
				done();
			});
		});
	});
});

describe('NZB output options', function() {
	var withUpload = function(extra, cb, files) {
		startServer(function(s) {
			var dir = mkTmp(), exp = {};
			files = files || {'a.bin': 5000};
			Object.keys(files).forEach(function(f) { exp[f] = mkFile(dir, f, files[f]); });
			run(srvArgs(s, extra.concat(Object.keys(files))), {cwd: dir}, function(r) {
				cb(r, dir, s, exp);
			});
		});
	};
	it('-o with tokens writes one NZB per file', function(done) {
		withUpload(['-o', '{fnamebase}-{filenum}of{files}.nzb'], function(r, dir, s, exp) {
			ok(r);
			verify(s, readNzb(path.join(dir, 'a-1of2.nzb')), {'a.bin': exp['a.bin']});
			verify(s, readNzb(path.join(dir, 'b-2of2.nzb')), {'b.bin': exp['b.bin']});
			done();
		}, {'a.bin': 5000, 'b.bin': 6000});
	});
	it('-o - and -o fd://1 write to stdout', function(done) {
		withUpload(['-o', '-'], function(r, dir, s, exp) {
			ok(r);
			verify(s, parseNzb(r.stdout), exp);
			withUpload(['-o', 'fd://1'], function(r, dir, s, exp) {
				ok(r);
				verify(s, parseNzb(r.stdout), exp);
				done();
			});
		});
	});
	it('-o proc://', function(done) {
		var cmd = '"' + process.execPath + '" -e "process.stdin.pipe(require(\'fs\').createWriteStream(\'piped.nzb\'))"';
		withUpload(['-o', 'proc://' + cmd], function(r, dir, s, exp) {
			ok(r);
			verify(s, readNzb(path.join(dir, 'piped.nzb')), exp);
			done();
		});
	});
	it('-O (--overwrite)', function(done) {
		var dir = mkTmp();
		mkFile(dir, 'a.bin', 5000);
		fs.writeFileSync(path.join(dir, 'o.nzb'), 'old');
		startServer(function(s) {
			run(srvArgs(s, ['-o', 'o.nzb', 'a.bin']), {cwd: dir}, function(r) {
				assert.notEqual(r.code, 0, 'refuses to overwrite');
				assert.equal(fs.readFileSync(path.join(dir, 'o.nzb'), 'utf8'), 'old');
				run(srvArgs(s, ['-o', 'o.nzb', '-O', 'a.bin']), {cwd: dir}, function(r) {
					ok(r);
					assert.equal(readNzb(path.join(dir, 'o.nzb')).files.length, 1);
					done();
				});
			});
		});
	});
	it('--nzb-del-incomplete', function(done) {
		startServer({postDataHook: function() { return 441; }}, function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 5000);
			var args = ['--post-retries', '0', '--nzb-file-mode', 'stream', '-o', 'o.nzb', '-O', 'a.bin'];
			run(srvArgs(s, args), {cwd: dir}, function(r) {
				assert.equal(r.code, 33);
				assert(fs.existsSync(path.join(dir, 'o.nzb')), 'incomplete NZB kept by default');
				run(srvArgs(s, ['--nzb-del-incomplete'].concat(args)), {cwd: dir}, function(r) {
					assert.equal(r.code, 33);
					assert(!fs.existsSync(path.join(dir, 'o.nzb')), 'incomplete NZB deleted');
					done();
				});
			});
		});
	});
	['stream', 'defer', 'temp'].forEach(function(mode) {
		it('--nzb-file-mode ' + mode, function(done) {
			withUpload(['--nzb-file-mode', mode, '-o', 'o.nzb'], function(r, dir, s, exp) {
				ok(r);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				assert.deepEqual(fs.readdirSync(dir).sort(), ['a.bin', 'o.nzb'], 'no temp files left');
				done();
			});
		});
	});
	it('--minify', function(done) {
		withUpload(['--minify', '-o', 'o.nzb'], function(r, dir, s, exp) {
			ok(r);
			var xml = fs.readFileSync(path.join(dir, 'o.nzb'), 'utf8');
			verify(s, parseNzb(xml), exp);
			assert(xml.split('\n').filter(Boolean).length <= 2, 'minified:\n' + xml);
			done();
		});
	});
	var decompress = {gzip: zlib.gunzipSync, zlib: zlib.inflateSync, deflate: zlib.inflateRawSync, brotli: zlib.brotliDecompressSync};
	Object.keys(decompress).forEach(function(type) {
		it('--nzb-compress ' + type + ' and --nzb-compress-level', function(done) {
			withUpload(['--nzb-compress', type, '--nzb-compress-level', '1', '-o', 'o.nzb'], function(r, dir, s, exp) {
				ok(r);
				var low = fs.readFileSync(path.join(dir, 'o.nzb'));
				verify(s, parseNzb(decompress[type](low)), exp);
				run(srvArgs(s, ['--nzb-compress', type, '--nzb-compress-level', '9', '-o', 'o9.nzb', '-a', '1K', 'a.bin']), {cwd: dir}, function(r) {
					ok(r);
					var high = fs.readFileSync(path.join(dir, 'o9.nzb'));
					assert(parseNzb(decompress[type](high)).files[0].segments.length > 1);
					run(srvArgs(s, ['--nzb-compress', type, '--nzb-compress-level', '1', '-o', 'o1.nzb', '-a', '1K', 'a.bin']), {cwd: dir}, function(r) {
						ok(r);
						assert(fs.statSync(path.join(dir, 'o1.nzb')).size >= high.length, 'higher level compresses at least as well');
						done();
					});
				});
			}, {'a.bin': 50000});
		});
	});
	it('--nzb-title, --nzb-tag, --nzb-category, --nzb-password and -M', function(done) {
		withUpload(['--nzb-title', 'My Title', '--nzb-tag', 'SD', '--nzb-tag', 'x&y', '--nzb-category', 'TV', '--nzb-password', 'pw<1>', '-M', 'custom=val', '-o', 'o.nzb'], function(r, dir) {
			ok(r);
			var meta = readNzb(path.join(dir, 'o.nzb')).meta;
			assert.deepEqual(meta.title, ['My Title']);
			assert.deepEqual(meta.tag, ['SD', 'x&y']);
			assert.deepEqual(meta.category, ['TV']);
			assert.deepEqual(meta.password, ['pw<1>']);
			assert.deepEqual(meta.custom, ['val']);
			done();
		});
	});
	it('--nzb-encoding', function(done) {
		withUpload(['--nzb-encoding', 'latin1', '-o', 'o.nzb'], function(r, dir) {
			ok(r);
			var raw = fs.readFileSync(path.join(dir, 'o.nzb'));
			assert(/^<\?xml version="1.0" encoding="(latin1|iso-8859-1)"/i.test(raw.toString('latin1')), raw.toString('latin1').substring(0, 60));
			assert(raw.indexOf(Buffer.from('caf\u00e9.bin', 'latin1')) > 0, 'file name encoded as latin1');
			done();
		}, {'caf\u00e9.bin': 1000});
	});
	it('--nzb-subject and --nzb-poster', function(done) {
		withUpload(['-f', 'Real <r@r>', '--nzb-subject', '{filename} [{filesize}] {value}', '--nzb-poster', 'P {value}', '-o', 'o.nzb'], function(r, dir, s) {
			ok(r);
			var f = readNzb(path.join(dir, 'o.nzb')).files[0];
			var art = allArticles(s)[0];
			assert.equal(f.subject, 'a.bin [5000] ' + art.headers.subject);
			assert.equal(f.poster, 'P Real <r@r>');
			assert.equal(art.headers.from, 'Real <r@r>', 'article header unchanged');
			done();
		});
	});
});

describe('tuning options keep uploads intact', function() {
	[
		['--disk-req-size', '50K'],
		['--disk-buf-size', '0'],
		['--disk-buf-size', '4'],
		['--nzb-cork'],
		['--post-queue-size', '1'],
		['--post-chunk-size', '10K'],
		['--post-chunk-size', '0'],
		['--no-use-post-pool'],
		['--preload-modules'],
		['--connection-threads', '2'],
		['--connection-threads', '2', '-S', '--ignore-cert', '--server', 'SECOND'],
	].forEach(function(opt) {
		it(opt.join(' ').replace('SECOND', 'nntps://...'), function(done) {
			var ssl = opt.indexOf('-S') >= 0;
			startServers(2, {ssl: ssl}, function(s, s2) {
				var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 1000000), 'b.bin': mkFile(dir, 'b.bin', 1)};
				var args = opt.map(function(a) { return a == 'SECOND' ? 'nntps://u:p@127.0.0.1:' + s2.port + '?connections=2' : a; });
				run(srvArgs(s, args.concat(['-a', '100K', '-n', '3', '-o', 'o.nzb', 'a.bin', 'b.bin'])), {cwd: dir}, function(r) {
					ok(r);
					verify([s, s2], readNzb(path.join(dir, 'o.nzb')), exp);
					done();
				});
			});
		});
	});
});

describe('other options', function() {
	it('--dump-failed-posts, --input-raw-posts and --delete-raw-posts', function(done) {
		startServer({postDataHook: function() { return 441; }}, function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 5000);
			fs.mkdirSync(path.join(dir, 'dump'));
			run(srvArgs(s, ['--post-retries', '0', '-e', 'post-fail', '--dump-failed-posts', 'dump', 'a.bin']), {cwd: dir}, function(r) {
				assert.equal(r.code, 32, r.err);
				var dumped = fs.readdirSync(path.join(dir, 'dump'));
				assert.equal(dumped.length, 1);
				var rawFile = path.join(dir, 'dump', dumped[0]);
				var raw = fs.readFileSync(rawFile, 'binary');
				assert.equal(msgIdOf(raw), dumped[0], 'dump file is named after the Message-ID');
				startServer(function(s2) {
					run(srvArgs(s2, ['--input-raw-posts', '--delete-raw-posts', rawFile]), {cwd: dir}, function(r) {
						ok(r);
						var post = s2.postIdMap[dumped[0]];
						assert(post, 'reposted with the same Message-ID');
						assert.equal(parseArticle(post).ybegin.name, 'a.bin');
						assert(!fs.existsSync(rawFile), 'raw post deleted');
						done();
					});
				});
			});
		});
	});
	it('-E (--token-eval)', function(done) {
		startServer(function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 250000);
			run(srvArgs(s, ['-E', '-s', '${filename}: part ${part-1} of ${parts}', '-a', '100K', 'a.bin']), {cwd: dir}, function(r) {
				ok(r);
				var subjects = allArticles(s).map(function(a) { return a.headers.subject; }).sort();
				assert.deepEqual(subjects, ['a.bin: part 0 of 3', 'a.bin: part 1 of 3', 'a.bin: part 2 of 3']);
				done();
			});
		});
	});
	it('-C (--config) with CLI overrides', function(done) {
		startServer(function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', 1000);
			fs.writeFileSync(path.join(dir, 'conf.json'), JSON.stringify({host: '127.0.0.1', port: s.port, groups: GROUP, subject: 'conf {filename}', from: 'Conf <c@c>', out: 'conf.nzb'}));
			run(['-C', 'conf.json', '-f', 'Cli <c@c>', 'a.bin'], {cwd: dir}, function(r) {
				ok(r);
				var a = allArticles(s)[0];
				assert.equal(a.headers.subject, 'conf a.bin');
				assert.equal(a.headers.from, 'Cli <c@c>', 'command line wins over config');
				assert(fs.existsSync(path.join(dir, 'conf.nzb')));
				done();
			});
		});
	});
	it('-C with the "obfuscation" shortcut', function(done) {
		startServer(function(s) {
			var dir = mkTmp(), exp = {'secret-name.bin': mkFile(dir, 'secret-name.bin', 250000)};
			fs.writeFileSync(path.join(dir, 'conf.json'), JSON.stringify({obfuscation: true}));
			run(srvArgs(s, ['-C', 'conf.json', '-a', '100K', '-o', 'o.nzb', 'secret-name.bin']), {cwd: dir}, function(r) {
				ok(r);
				var res = verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				res[0].articles.forEach(function(a) {
					assert(/^[0-9a-f]{32,64}$/.test(a.ybegin.name), 'obfuscated yEnc name');
					assert(a.headers.subject.indexOf('secret-name') < 0, 'subject hides the file name: ' + a.headers.subject);
					assert(a.headers.from.indexOf('secret-name') < 0);
				});
				assert.notEqual(res[0].articles[0].headers.subject, res[0].articles[1].headers.subject, 'random subject per article');
				done();
			});
		});
	});
});

describe('UI options', function() {
	var uploadWith = function(extra, opts, cb) {
		startServer(opts.server || {}, function(s) {
			var dir = mkTmp();
			mkFile(dir, 'a.bin', opts.size || 5000);
			run(srvArgs(s, extra.concat(['a.bin'])), {cwd: dir, during: opts.during && opts.during.bind(null, s)}, function(r) {
				cb(r, s);
			});
		});
	};
	var rejectOnce = function() {
		var n = 0;
		return {postDataHook: function() { if(n++ == 0) return 441; }};
	};
	it('-l (--log-level), -q and -v', function(done) {
		var args = ['-n', '1', '--post-retries', '1', '--progress', 'none'];
		uploadWith(args.concat(['-l', '0']), {server: rejectOnce()}, function(r) {
			ok(r);
			assert.equal(r.err, '', 'silent');
			uploadWith(args.concat(['-l', '1']), {server: rejectOnce()}, function(r) {
				ok(r);
				assert(!/\[(WARN|INFO)\]/.test(r.err), r.err);
				uploadWith(args.concat(['-q']), {server: rejectOnce()}, function(r) {
					ok(r);
					assert(/\[WARN\]/.test(r.err) && !/\[INFO\]/.test(r.err), r.err);
					uploadWith(args.concat(['-v']), {server: rejectOnce()}, function(r) {
						ok(r);
						assert(/\[DBG \]/.test(r.err) && /\[INFO\]/.test(r.err), 'debug output');
						done();
					});
				});
			});
		});
	});
	it('--colorize', function(done) {
		uploadWith(['--colorize'], {}, function(r) {
			ok(r);
			assert(/\x1b\[\d+m/.test(r.err), 'ANSI colours');
			uploadWith([], {}, function(r) {
				assert(!/\x1b\[/.test(r.err), 'no colours without TTY');
				done();
			});
		});
	});
	it('-T (--log-time)', function(done) {
		uploadWith(['-T'], {}, function(r) {
			ok(r);
			r.err.split('\n').filter(function(l) { return /\[INFO\]/.test(l); }).forEach(function(l) {
				assert(/^\[?\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d/.test(l), 'timestamp: ' + l);
			});
			done();
		});
	});
	it('--progress log:<interval>', function(done) {
		uploadWith(['--progress', 'log:200ms', '--max-upload-rate', '100K/s', '-a', '50K'], {size: 200000}, function(r) {
			ok(r);
			assert(/Article posting progress: \d+ read, \d+ posted/.test(r.err), r.err);
			done();
		});
	});
	['stdout', 'stdoutx', 'stderr', 'stderrx'].forEach(function(type) {
		it('--progress ' + type, function(done) {
			uploadWith(['--progress', type, '--max-upload-rate', '100K/s', '-a', '50K'], {size: 200000}, function(r) {
				ok(r);
				var target = /^stdout/.test(type) ? r.out : r.err;
				assert(/\d+(\.\d+)?%/.test(target), 'progress percentage on ' + type + ':\n' + target);
				done();
			});
		});
	});
	var waitFor = function(fn, cb) {
		var tries = 0;
		(function attempt() {
			fn(function(err, res) {
				if(err && ++tries < 40) return setTimeout(attempt, 100);
				cb(err, res);
			});
		})();
	};
	it('--progress http:<host:port>', function(done) {
		freePort(function(port) {
			var page;
			uploadWith(['--progress', 'http:127.0.0.1:' + port, '--max-upload-rate', '100K/s', '-a', '50K'], {size: 300000, during: function(s) {
				waitFor(function(cb) { httpGet('http://127.0.0.1:' + port + '/', cb); }, function(err, res) { page = err ? String(err) : res; });
			}}, function(r, s) {
				ok(r);
				assert(/Upload Rate \(network\|real\): [\d.]+ \w*B\/s \| [\d.]+ \w*B\/s/.test(page), page);
				assert(page.indexOf('127.0.0.1:' + s.port) >= 0, 'connection list shows host:port');
				assert(/Articles posted: \d+/.test(page));
				done();
			});
		});
	});
	it('--progress tcp:<host:port>', function(done) {
		freePort(function(port) {
			var page;
			uploadWith(['--progress', 'tcp:127.0.0.1:' + port, '--max-upload-rate', '100K/s', '-a', '50K'], {size: 300000, during: function() {
				waitFor(function(cb) {
					var d = '';
					net.connect(port, '127.0.0.1').on('data', function(c) { d += c; }).on('end', function() { cb(null, d); }).on('error', cb);
				}, function(err, res) { page = err ? String(err) : res; });
			}}, function(r) {
				ok(r);
				assert(/Articles posted: \d+/.test(page), page);
				done();
			});
		});
	});
	it('--progress none', function(done) {
		uploadWith(['--progress', 'none', '--max-upload-rate', '100K/s', '-a', '50K'], {size: 200000}, function(r) {
			ok(r);
			assert(!/posting progress|\d+%/.test(r.err + r.out), r.err);
			done();
		});
	});
});

describe('input options', function() {
	var tree = function() {
		var dir = mkTmp();
		var exp = {'d/a.bin': mkFile(dir, 'd/a.bin', 1000), 'd/sub/b.bin': mkFile(dir, 'd/sub/b.bin', 1100), 'd/sub/deep/c.bin': mkFile(dir, 'd/sub/deep/c.bin', 1200)};
		return {dir: dir, exp: exp};
	};
	var pick = function(exp, keys) {
		var r = {};
		keys.forEach(function(k) { r[k] = exp[k]; });
		return r;
	};
	it('-r (--subdirs) include / keep / skip', function(done) {
		var t = tree();
		startServer(function(s) {
			run(srvArgs(s, ['-o', 'inc.nzb', 'd']), {cwd: t.dir}, function(r) {
				ok(r);
				verify(s, readNzb(path.join(t.dir, 'inc.nzb')), pick(t.exp, ['d/a.bin']));
				run(srvArgs(s, ['-r', 'keep', '-o', 'keep.nzb', 'd']), {cwd: t.dir}, function(r) {
					ok(r);
					verify(s, readNzb(path.join(t.dir, 'keep.nzb')), t.exp);
					run(srvArgs(s, ['-r', 'skip', 'd']), {cwd: t.dir}, function(r) {
						assert.notEqual(r.code, 0, 'nothing to upload');
						assert(/Skipping directory/.test(r.err), r.err);
						done();
					});
				});
			});
		});
	});
	it('-L (--skip-symlinks)', function(done) {
		var dir = mkTmp(), exp = {'in/a.bin': mkFile(dir, 'in/a.bin', 1000)};
		try {
			fs.symlinkSync(path.join(dir, 'in', 'a.bin'), path.join(dir, 'in', 'link.bin'));
		} catch(x) {
			return this.skip(); // no permission to create symlinks (e.g. Windows without developer mode)
		}
		startServer(function(s) {
			run(srvArgs(s, ['-o', 'o.nzb', 'in']), {cwd: dir}, function(r) {
				ok(r);
				assert.equal(readNzb(path.join(dir, 'o.nzb')).files.length, 2, 'symlink followed by default');
				run(srvArgs(s, ['-L', '-o', 'o2.nzb', 'in']), {cwd: dir}, function(r) {
					ok(r);
					verify(s, readNzb(path.join(dir, 'o2.nzb')), exp);
					done();
				});
			});
		});
	});
	it('--include-empty', function(done) {
		var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 1000)};
		fs.writeFileSync(path.join(dir, 'empty.bin'), '');
		startServer(function(s) {
			run(srvArgs(s, ['-o', 'o.nzb', 'a.bin', 'empty.bin']), {cwd: dir}, function(r) {
				ok(r);
				assert(/Skipping empty file/.test(r.err), r.err);
				verify(s, readNzb(path.join(dir, 'o.nzb')), exp);
				run(srvArgs(s, ['--include-empty', '-o', 'o2.nzb', 'a.bin', 'empty.bin']), {cwd: dir}, function(r) {
					ok(r);
					var nzb = readNzb(path.join(dir, 'o2.nzb'));
					assert.equal(nzb.files.length, 2);
					var empty = nzb.files.filter(function(f) { return /empty\.bin/.test(f.subject); })[0];
					assert.equal(empty.segments.length, 1);
					assert.equal(parseArticle(s.postIdMap[empty.segments[0].id]).data.length, 0);
					done();
				});
			});
		});
	});
	it('-i / -0 / --input-file-enc / stdin / proc:// / fd://0 input lists', function(done) {
		var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 1000), 'b.bin': mkFile(dir, 'b.bin', 1100)};
		fs.writeFileSync(path.join(dir, 'list.txt'), 'a.bin\nb.bin\n');
		fs.writeFileSync(path.join(dir, 'list0.txt'), 'a.bin\0b.bin');
		fs.writeFileSync(path.join(dir, 'list16.txt'), Buffer.from('a.bin\nb.bin', 'utf16le'));
		var cases = [
			[['-i', 'list.txt']],
			[['-0', 'list0.txt']],
			[['-i', 'list16.txt', '--input-file-enc', 'utf16le']],
			[['-i', '-'], 'a.bin\nb.bin\n'],
			[['-i', 'fd://0'], 'a.bin\nb.bin\n'],
			[['-i', 'proc://"' + process.execPath + '" -e "console.log(\'a.bin\\nb.bin\')"']]
		];
		startServer(function(s) {
			(function next(i) {
				if(i == cases.length) return done();
				run(srvArgs(s, cases[i][0].concat(['-o', 'o' + i + '.nzb'])), {cwd: dir, stdin: cases[i][1]}, function(r) {
					ok(r);
					verify(s, readNzb(path.join(dir, 'o' + i + '.nzb')), exp);
					next(i + 1);
				});
			})(0);
		});
	});
	it('procjson:// input', function(done) {
		var dir = mkTmp();
		var cmd = '"' + process.execPath + '" -e "process.stdout.write(Buffer.alloc(3000, 97))"';
		startServer(function(s) {
			run(srvArgs(s, ['-o', 'o.nzb', 'procjson://' + JSON.stringify(['piped.bin', 3000, cmd]).slice(1, -1)]), {cwd: dir}, function(r) {
				ok(r);
				var res = verify(s, readNzb(path.join(dir, 'o.nzb')), {'piped.bin': Buffer.alloc(3000, 97)});
				assert.equal(res[0].articles[0].ybegin.name, 'piped.bin');
				done();
			});
		});
	});
	it('-I (--copy-input), --copy-include, --copy-exclude, --copy-queue-size', function(done) {
		var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 300000), 'b.bin': mkFile(dir, 'b.bin', 1000)};
		fs.mkdirSync(path.join(dir, 'c1'));
		fs.mkdirSync(path.join(dir, 'c2'));
		startServer(function(s) {
			run(srvArgs(s, ['-I', 'c1/{filename}.copy', '--copy-queue-size', '1', '-a', '100K', 'a.bin', 'b.bin']), {cwd: dir}, function(r) {
				ok(r);
				assert(fs.readFileSync(path.join(dir, 'c1', 'a.bin.copy')).equals(exp['a.bin']));
				assert(fs.readFileSync(path.join(dir, 'c1', 'b.bin.copy')).equals(exp['b.bin']));
				run(srvArgs(s, ['-I', 'c2/{filename}-{size}', '--copy-include', '^a', '--copy-exclude', 'zzz', 'a.bin', 'b.bin']), {cwd: dir}, function(r) {
					ok(r);
					assert.deepEqual(fs.readdirSync(path.join(dir, 'c2')), ['a.bin-300000']);
					run(srvArgs(s, ['-I', 'c2/x-{filename}', '--copy-exclude', '^a', 'a.bin', 'b.bin']), {cwd: dir}, function(r) {
						ok(r);
						assert.deepEqual(fs.readdirSync(path.join(dir, 'c2')).sort(), ['a.bin-300000', 'x-b.bin']);
						done();
					});
				});
			});
		});
	});
});

describe('production option set', function() {
	// answer POST after a delay, so the upload runs long enough to query the progress page
	var slowPost = function(req) {
		if(req != 'POST') return;
		var conn = this;
		setTimeout(function() {
			conn.postMode = true;
			conn.postCmd = 'POST';
			conn._respond(340, 'Send article');
		}, 1000);
		return true;
	};
	it('matches what the uploading app uses', function(done) {
		startServer({ssl: true, onRequest: slowPost}, function(s1) {
			startServer({ssl: true, onRequest: slowPost}, function(s2) {
				freePort(function(httpPort) {
					var dir = mkTmp(), exp = {'a.bin': mkFile(dir, 'a.bin', 2000000), 'b.bin': mkFile(dir, 'b.bin', 700000)};
					var page;
					run(['-h', '127.0.0.1', '-P', s1.port, '-S', '--ignore-cert', '-u', 'USER', '-p', 'PASS', '-n', '4', '--server', 'nntps://u2:p2@127.0.0.1:' + s2.port + '?connections=4',
						'--connection-threads', '2', '-a', '700K', '--progress', 'http:127.0.0.1:' + httpPort, '--progress', 'log:200ms', '--groups', GROUP, '-o', 'out.nzb', '-O',
						'-f', 'Poster <p@p>', '--message-id', '${rand(24)}@nyuu', '--subject', '{filename}', '--nzb-subject', '{filename}', '--nzb-poster', 'Poster <p@p>',
						'--obfuscate-articles', '--connect-retries', '5', '--post-retries', '10', '--post-retry-delay', '1', '--retry-on-bad-resp', '--nzb-del-incomplete',
						'--nzb-file-mode', 'defer', '-r', 'keep', '--post-chunk-size', '0', '--max-upload-rate', '0', 'a.bin', 'b.bin'], {cwd: dir, during: function() {
						var tries = 0;
						(function attempt() {
							httpGet('http://127.0.0.1:' + httpPort + '/', function(err, res) {
								if(err && ++tries < 50) return setTimeout(attempt, 50);
								page = res || String(err);
							});
						})();
					}}, function(r) {
						ok(r);
						var res = verify([s1, s2], readNzb(path.join(dir, 'out.nzb')), exp);
						res.forEach(function(x) {
							assert.equal(x.file.subject, x.name);
							assert.equal(x.file.poster, 'Poster <p@p>');
							x.articles.forEach(function(a) {
								assert(/^[0-9a-f]{32,64}$/.test(a.ybegin.name));
								assert(/^<.{24}@nyuu>$/.test(a.headers['message-id']), a.headers['message-id']);
							});
						});
						assert(/^\[INFO\] Finished uploading [\d.]+ \w*B in [\d:.]+ \([\d.]+ \w*B\/s\)\. Network upload rate: [\d.]+ \w*B\/s$/m.test(r.err), r.err);
						assert(/Upload Rate \(network\|real\): [\d.]+ \w*B\/s \| [\d.]+ \w*B\/s/.test(page), String(page));
						done();
					});
				});
			});
		});
	});
});

});
