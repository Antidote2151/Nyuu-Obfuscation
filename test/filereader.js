"use strict";

var assert = require("assert");
var BufferedFileReader = require('../lib/filereader');
var allocBuffer = (Buffer.allocUnsafe || Buffer);

var tl = require('./_testlib');

describe('Buffered File Reader', function() {

it('test req size = whole file', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 10, allocBuffer(20));
	r.read(10, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '0123456789');
		// r.EOF shouldn't be known at this stage
		r.read(2, function(err, data) {
			if(err) throw err;
			assert(r.EOF);
			assert.equal(data.length, 0);
			r.close(done);
		});
	});
});
it('test req size > whole file', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 15);
	r.read(12, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '0123456789');
		assert(r.EOF);
		r.read(3, function(err, data) {
			if(err) throw err;
			assert.equal(data.length, 0);
			r.close(done);
		});
	});
});
it('test req size < whole file with readahead > whole file', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 5, allocBuffer(15));
	r.read(12, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '0123456789');
		assert(r.EOF);
		r.read(3, function(err, data) {
			if(err) throw err;
			assert.equal(data.length, 0);
			r.close(done);
		});
	});
});
it('test mix of too small and too large reqs', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 4, allocBuffer(8));
	r.read(2, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '01');
		r.read(1, function(err, data) {
			if(err) throw err;
			assert.equal(data.toString(), '6');
		});
	});
	r.read(4, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '2345');
		r.read(10, function(err, data) {
			if(err) throw err;
			assert.equal(data.toString(), '789');
			r.close(done);
		});
	});
});
it('test mix of too small and too large reqs (2)', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 3, allocBuffer(9));
	r.read(2, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '01');
		r.read(1, function(err, data) {
			if(err) throw err;
			assert.equal(data.toString(), '');
		});
	});
	r.read(10, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '23456789');
		r.read(10, function(err, data) {
			if(err) throw err;
			assert.equal(data.toString(), '');
			r.close(done);
		});
	});
});
it('test mix of too small and too large reqs (3)', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 3, allocBuffer(9));
	r.read(6, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '012345');
		r.read(2, function(err, data) {
			if(err) throw err;
			assert.equal(data.toString(), '78');
			r.read(5, function(err, data) {
				if(err) throw err;
				assert.equal(data.toString(), '9');
				assert(r.EOF);
				r.close(done);
			});
		});
	});
	r.read(1, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '6');
	});
});
it('test large read req spanning multiple reqs', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 1);
	r.read(5, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '01234');
		r.read(3, function(err, data) {
			if(err) throw err;
			assert.equal(data.toString(), '567');
			r.close(done);
		});
	});
});

it('test small read reqs within a single buffer', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 6, allocBuffer(12));
	r.read(2, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '01');
	});
	r.read(2, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '23');
	});
	r.read(2, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '45');
	});
	r.read(2, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '67');
	});
	r.read(4, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '89');
		assert(r.EOF);
		done();
	});
});


it('test read requests exceeding request size', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 4, allocBuffer(4));
	assert(!r.EOF);
	
	r.read(5, function(err, data) {
		if(err) throw err;
		assert(Buffer.isBuffer(data));
		
		assert.equal(data.toString(), '01234');
		
		r.read(6, function(err, data) {
			if(err) throw err;
			assert(Buffer.isBuffer(data));
			
			assert(r.EOF);
			assert.equal(data.toString(), '56789');
			done();
		});
	});
});


it('test instant read', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 5, allocBuffer(10));
	tl.defer(function() { // allow read buffers to fill
		r.read(5, function(err, data) {
			if(err) throw err;
			assert.equal(data.toString(), '01234');
			
			r.read(3, function(err, data) {
				if(err) throw err;
				assert(!r.EOF);
				assert.equal(data.toString(), '567');
			});
			r.read(2, function(err, data) {
				if(err) throw err;
				assert.equal(data.toString(), '89');
				tl.defer(function() { // let the stream reader discover that we're at EOF
					assert(r.EOF);
					done();
				});
			});
		});
	});
});

it('should terminate all read calls on end', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 6, allocBuffer(12));
	r.read(10, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '0123456789');
		r.read(12, function(err, data) {
			if(err) throw err;
			assert.equal(data.toString(), '');
			done();
		});
	});
	r.read(2, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '');
	});
	r.read(8, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '');
	});
});
it('should propagate errors to waiting reads', function(done) {
	var r = new BufferedFileReader('./test/invalid_file.txt', 5, allocBuffer(10));
	r.read(2, function(err, data) {
		assert(err);
	});
	r.read(12, function(err, data) {
		assert(err);
		done();
	});
});

it('test close early does not flip out', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 3, allocBuffer(9));
	r.read(2, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '01');
		r.close(done);
	});
});
it('test immediate close does not flip out', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 6, allocBuffer(12));
	r.close(done);
});
it('test read after close', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 3, allocBuffer(9));
	r.read(4, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '0123');
		r.close();
		r.read(2, function(err, data) {
			if(err) throw err;
			assert.equal(data.length, 0);
			done();
		});
	});
});
it('test read after close (2)', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 10, allocBuffer(20));
	r.read(4, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), '0123');
		r.close();
		r.read(6, function(err, data) {
			if(err) throw err;
			assert.equal(data.toString(), '');
			r.read(2, function(err, data) {
				if(err) throw err;
				assert.equal(data.length, 0);
				process.nextTick(done);
			});
		});
		r.read(2, function(err, data) {
			if(err) throw err;
			assert.equal(data.length, 0);
		});
	});
});

// TODO: possible to test cases involving slow disk reads?

it('test readRange', function(done) {
	var r = new BufferedFileReader('./test/10bytes.txt', 10, allocBuffer(20));
	var buf = allocBuffer(4);
	r.readRange(0, buf, function(err, b) {
		assert(!err);
		assert.equal(b.toString(), '0123');
		
		r.readRange(2, buf, function(err, b) {
			assert(!err);
			assert.equal(b.toString(), '2345');
			
			// test reading over edge
			r.readRange(8, buf, function(err, b) {
				assert(!err);
				assert.equal(b.toString(), '89');
				
				// test invalid range
				r.readRange(12, buf, function(err, b) {
					assert(!err);
					assert.equal(b.toString(), '');
					
					done();
				});
				
				
			});
		});
	});
});
});
