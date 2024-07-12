"use strict";

var assert = require("assert");
var BufferedStreamWriter = require('../lib/streamwriter');

var tl = require('./_testlib');
var Writable = require('stream').Writable;
var makeStream = function() {
	var s = new Writable();
	s.chunks = [];
	s.cbs = [];
	s._write = function(chunk, enc, cb) {
		this.chunks.push(chunk.toString());
		this.cbs.push(cb);
	};
	s.shift = function() {
		if(!s.chunks.length) return;
		return [s.chunks.shift(), s.cbs.shift()];
	};
	return s;
};

describe('Buffered Writer', function() {

it('should work', function(done) {
	var s = makeStream();
	var w = new BufferedStreamWriter(s, 2);
	
	w.write('abc', function(err) {
		if(err) throw err;
		assert.deepEqual(s.chunks, ['abc']);
		assert.equal(s.cbs.length, 1);
		
		w.write('def', function(err) {
			if(err) throw err;
			assert.deepEqual(s.chunks, ['abc']);
			assert.equal(s.cbs.length, 1);
			
			w.end(function(err) {
				if(err) throw err;
				assert.equal(s.chunks.length, 0);
				assert.equal(s.cbs.length, 0);
				done();
			});
			tl.defer(function() {
				var t = s.shift();
				assert.equal(t[0], 'abc');
				t[1]();
				tl.defer(function() {
					t = s.shift();
					assert.equal(t[0], 'def');
					t[1]();
					// should be at end now
				});
			});
		});
	});
});

it('should work (2)', function(done) {
	var s = makeStream();
	var w = new BufferedStreamWriter(s, 0);
	
	w.write('abc', function(err) {
		if(err) throw err;
		assert.deepEqual(s.chunks, ['abc']);
		assert.equal(s.cbs.length, 1);
		
		w.write('def', function(err) {
			if(err) throw err;
			tl.defer(function() {
				assert.deepEqual(s.chunks, ['def']);
				assert.equal(s.cbs.length, 1);
				
				w.end(function(err) {
					if(err) throw err;
					assert.equal(s.chunks.length, 0);
					assert.equal(s.cbs.length, 0);
					done();
				});
				tl.defer(function() {
					var t = s.shift();
					assert.equal(t[0], 'def');
					t[1]();
					// should be at end now
				});
			});
		});
		tl.defer(function() {
			var t = s.shift();
			assert.equal(t[0], 'abc');
			t[1]();
		});
	});
});

// TODO: test volatile sources

});
