"use strict";

var assert = require("assert");
var CacheHelper = require('../lib/cachehelper');

var tl = require('./_testlib');

describe('Cache Helper', function() {

var rNull = function() {};
var rRec = function(o) { this.push(o); };
var assertCache = function(cache, items) {
	var i = 0;
	for(var k in cache.cache) {
		assert.equal(cache.cache[k], items[i++]);
	}
	assert.equal(i, items.length);
	assert.equal(cache.cacheSize, items.length);
};

it('basic functionality', function(done) {
	var c = new CacheHelper(rNull, 10);
	assertCache(c, []);
	c.add(1, true, function(id) {
		assertCache(c, [1]);
		assert(id);
		c.add(2, true, function(id2) {
			assertCache(c, [1, 2]);
			c.remove(id);
			assertCache(c, [2]);
			c.remove(id2);
			assertCache(c, []);
			done();
		});
	});
});

it('should do nothing when removing or evicting non-existent entries', function(done) {
	var c = new CacheHelper(rNull, 10);
	assertCache(c, []);
	c.remove(22);
	assertCache(c, []);
	c.add(1, true, function(id) {
		assertCache(c, [1]);
		c.evict(22);
		c.remove(22);
		assertCache(c, [1]);
		c.remove(id);
		assertCache(c, []);
		c.evict(id);
		assertCache(c, []);
		c.add(2, true);
		c.remove(22);
		assertCache(c, [2]);
		
		done();
	});
});

it('should disallow evicting un-evictables', function(done) {
	var c = new CacheHelper(rNull, 10);
	c.add(1, false, function(id) {
		c.add(2, false);
		assertCache(c, [1, 2]);
		c.evict(id);
		assertCache(c, [1, 2]);
		done();
	});
});

it('should evict appropriately when full, and if possible', function(done) {
	var e = [];
	var c = new CacheHelper(rRec.bind(e), 2);
	c.add(1, true, function(id1) {
		assertCache(c, [1]);
		assert(id1);
		c.add(2, true, function(id2) {
			assertCache(c, [1, 2]);
			assert(id2);
			c.add(3, true, function(id3) { // should be evicted immediately
				assertCache(c, [1, 2]);
				assert.deepEqual(e, [3]);
				assert(!id3);
				
				c.add(4, false, function(id4) { // should evict an existing element (our policy is 1st, so assume that for now)
					assertCache(c, [2, 4]);
					assert.deepEqual(e, [3, 1]);
					assert(id4);
					
					c.add(5, true, function(id5) { // evict immediately
						assertCache(c, [2, 4]);
						assert.deepEqual(e, [3, 1, 5]);
						assert(!id5);
						
						c.add(6, false, function(id6) { // evict '2'
							assertCache(c, [4, 6]);
							assert.deepEqual(e, [3, 1, 5, 2]);
							assert(id6);
							
							c.evict(id6); // does nothing, unevictable
							assertCache(c, [4, 6]);
							assert.deepEqual(e, [3, 1, 5, 2]);
							
							c.remove(id6);
							assertCache(c, [4]);
							assert.deepEqual(e, [3, 1, 5, 2]);
							
							c.add(7, true, function(id7) {
								assertCache(c, [4, 7]);
								assert.deepEqual(e, [3, 1, 5, 2]);
								assert(id7);
								
								c.add(8, false); // evict 7
								assertCache(c, [4, 8]);
								assert.deepEqual(e, [3, 1, 5, 2, 7]);
								
								done();
							});
						});
					});
				});
			});
		});
	});
});
it('should wait when full, and cannot evict', function(done) {
	var c = new CacheHelper(rNull, 2);
	var id1;
	c.add(1, false, function(id) {id1=id;});
	c.add(2, false, function(id2) {
		var t = Date.now();
		c.add(3, false, function(id3) {
			tl.assertTimeWithin(t, 100);
			assertCache(c, [2, 3]);
			assert(id3);
			
			c.remove(id3);
			assertCache(c, [2]);
			
			done();
		});
	});
	setTimeout(function() {
		c.remove(id1);
	}, 100);
});
it('should wait when full, and cannot evict (2)', function(done) {
	var c = new CacheHelper(rNull, 2);
	var id1, id2;
	var t = Date.now();
	c.add(1, false, function(id) {id1=id;});
	c.add(2, false, function(id) {id2=id;});
	c.add(3, false, function(id3) { // this won't be called until 1+2 are removed
		tl.assertTimeWithin(t, 150);
		assertCache(c, [3, 4]);
		c.add(5, false, function(id5) {
			tl.assertTimeWithin(t, 200);
			assertCache(c, [4, 5]);
			
			done();
		});
		setTimeout(function() {
			c.remove(id3);
		}, 50);
	});
	c.add(4, false, function(id4) {
		tl.assertTimeWithin(t, 150);
	});
	setTimeout(function() {
		c.remove(id1);
	}, 75);
	setTimeout(function() {
		c.remove(id2);
	}, 150);
});

});
