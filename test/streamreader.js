"use strict";

var assert = require("assert");
var BufferedStreamReader = require('../lib/streamreader');

var tl = require('./_testlib');
var Readable = require('stream').Readable;
var makeStream = function() {
	var s = new Readable();
	s._read = function() {};
	return s;
};

describe('Buffered Reader', function() {

it('should work', function(done) {
	var s = makeStream();
	var r = new BufferedStreamReader(s, 10);
	assert(!r.EOF);
	
	r.read(5, function(err, data) {
		if(err) throw err;
		assert(Buffer.isBuffer(data));
		
		assert.equal(data.toString(), 'abcde');
		s.push(null);
		
		r.read(5, function(err, data) {
			if(err) throw err;
			assert(Buffer.isBuffer(data));
			
			assert(r.EOF);
			assert.equal(data.toString(), 'f');
			done();
		});
	});
	s.push('abc');
	tl.defer(function() {
		s.push('def');
	});
});

it('should work (2)', function(done) {
	var s = makeStream();
	var r = new BufferedStreamReader(s, 1);
	
	s.push('abcdef');
	s.push(null);
	r.read(5, function(err, data) {
		if(err) throw err;
		
		assert(!r.EOF);
		assert.equal(data.toString(), 'abcde');
		
		r.read(5, function(err, data) {
			if(err) throw err;
			
			assert(r.EOF);
			assert.equal(data.toString(), 'f');
			done();
		});
	});
});

it('should terminate all read calls on end', function(done) {
	var s = makeStream();
	var r = new BufferedStreamReader(s, 10);
	var read1 = false;
	
	r.read(5, function(err, data) {
		if(err) throw err;
		assert(!read1);
		assert(Buffer.isBuffer(data));
		assert.equal(data.length, 0);
		read1 = true;
	});
	r.read(5, function(err, data) {
		if(err) throw err;
		assert(read1);
		assert(Buffer.isBuffer(data));
		assert.equal(data.length, 0);
	});
	s.push(null);
	tl.defer(function() {
		r.read(5, function(err, data) {
			if(err) throw err;
			assert(read1);
			assert(Buffer.isBuffer(data));
			assert.equal(data.length, 0);
			done();
		});
	});
});

it('should handle incomplete read call after end', function(done) {
	var s = makeStream();
	var r = new BufferedStreamReader(s, 10);
	
	r.read(5, function(err, data) {
		if(err) throw err;
		assert.equal(data.toString(), 'abcde');
	});
	s.push('abcdef');
	s.push(null);
	tl.defer(function() {
		r.read(5, function(err, data) {
			if(err) throw err;
			assert.equal(data.toString(), 'f');
			done();
		});
	});
});

it('should mark EOF on end', function(done) {
	var s = makeStream();
	var r = new BufferedStreamReader(s, 10);
	
	s.push(null);
	tl.defer(function() {
		assert(r.EOF);
		done();
	});
});

it('should auto-mark EOF on end after read request', function(done) {
	var s = makeStream();
	var r = new BufferedStreamReader(s, 10);
	
	s.push('abcde');
	s.push(null);
	tl.defer(function() {
		r.read(5, function(err, data) {
			if(err) throw err;
			
			assert.equal(data.toString(), 'abcde');
			assert(r.EOF);
			done();
		});
	});
});

it('should propagate errors to waiting reads', function(done) {
	var s = makeStream();
	var r = new BufferedStreamReader(s, 10);
	
	r.read(4, function(err, data) {
		assert.equal(err, 3);
		assert(!data);
	});
	r.read(4, function(err, data) {
		assert.equal(err, 3);
		assert(!data);
	});
	s.emit('error', 3);
	tl.defer(function() {
		r.read(4, function(err, data) {
			assert.equal(err, 3);
			assert(!data);
			// TODO: check that stream is closed
			done();
		});
	});
});

it('should deal with buffering disabled', function(done) {
	var s = makeStream();
	var r = new BufferedStreamReader(s, 0);
	
	var bigdata = (Buffer.allocUnsafe || Buffer)(65536*4); // should be large enough to exceed any node buffers; has nothing to do with a particular fad term
	s.push(bigdata);
	tl.defer(function() {
		r.read(65536*2, function(err, data) {
			if(err) throw err;
			
			assert(!r.EOF);
			assert.equal(data.length, 65536*2);
			
			s.push(bigdata);
			
			tl.defer(function() {
				r.read(65536*4, function(err, data) {
					if(err) throw err;
					
					assert(!r.EOF);
					assert.equal(data.length, 65536*4);
					
					s.push(null);
					
					r.read(65536*2, function(err, data) {
						if(err) throw err;
						
						tl.defer(function() {
							assert(r.EOF);
							assert.equal(data.length, 65536*2);
							done();
						});
					});
				});
			});
		});
	});
});


// TODO: is there a way to test the pause/resume semantics of the buffer size?
// - should pause if amount of buffered data exceeds limit
// - also need to test case that a read request exceeds the buffer limit

// TODO: test close

});
