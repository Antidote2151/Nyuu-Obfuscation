"use strict";

var assert = require("assert");
var fs = require('fs');

var hasWorkers = false;
try { require('worker_threads'); hasWorkers = true; } catch(x) {} // connection threads need NodeJS >= 11.7

(hasWorkers ? describe : describe.skip)('Socket thread', function() {

// threads receive opts.connect as is, so the default port must be filled in there (not only in a local copy)
it('should pass the default port to connection threads', function() {
	var NNTP = require('../lib/nntp');
	[[true, 563], [false, 119]].forEach(function(t) {
		var opts = {connect: {host: '127.0.0.1', port: null}, secure: t[0], useThreads: true};
		new NNTP(opts);
		assert.equal(opts.connect.port, t[1]);
	});
});

// regression: forwarding received data used to transfer (detach) a buffer Node reuses for TLS reads, crashing the thread on the next read
it('should receive multiple TLS reads', function(done) {
	var server = require('tls').createServer({
		key: fs.readFileSync(__dirname + '/_ssl.key'),
		cert: fs.readFileSync(__dirname + '/_ssl.crt')
	}, function(c) {
		c.write('200 hello\r\n');
		c.on('data', function(d) {
			c.write('240 got ' + d.toString().trim() + '\r\n');
		});
	});
	server.listen(0, '127.0.0.1', function() {
		var sockthread = require('../lib/sockthread');
		sockthread.createPool(1);
		var sock = sockthread.create({secure: true, connect: {host: '127.0.0.1', port: server.address().port, rejectUnauthorized: false}});
		var received = '', sent = 0;
		sock.on('error', done);
		sock.on('data', function(d) {
			received += d.toString();
			var lines = received.split('\r\n').length - 1;
			if(lines == 6) {
				assert.equal(received, '200 hello\r\n240 got 1\r\n240 got 2\r\n240 got 3\r\n240 got 4\r\n240 got 5\r\n');
				sock.destroy();
				sockthread.closePool();
				server.close();
				done();
			} else if(lines == sent + 1) // send next request only after previous reply, to get separate reads
				sock.write(Buffer.from((++sent) + '\r\n'));
		});
	});
});

});
