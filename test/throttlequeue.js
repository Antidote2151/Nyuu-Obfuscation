"use strict";

var assert = require("assert");
var ThrottleQueue = require('../lib/throttlequeue');
var tl = require('./_testlib');

describe('Throttle Queue', function() {

it('should not throttle if within burst', function(done) {
	var q = new ThrottleQueue(5, 400);
	var called = [];
	var s = Date.now();
	assert(!q.pass(1, called.push.bind(called, 0)));
	assert(!q.pass(1, called.push.bind(called, 1)));
	assert(!q.pass(1, called.push.bind(called, 2)));
	assert(!q.pass(1, called.push.bind(called, 3)));
	assert(!q.pass(1, function() {
		tl.assertTimeWithin(s, 0, 20);
		assert.equal(called.join(','), '0,1,2,3');
		
		called = [];
		// wait for 2 items to expire, and add again
		setTimeout(function() {
			s = Date.now();
			assert(!q.pass(1, called.push.bind(called, 0)));
			assert(!q.pass(1, function() {
				tl.assertTimeWithin(s, 0, 20);
				assert.equal(called.join(','), '0');
				done();
			}));
		}, 160);
	}));
});

it('should not throttle if within burst (2)', function(done) {
	var q = new ThrottleQueue(5, 400);
	var called = [];
	var s = Date.now();
	assert(!q.pass(3, called.push.bind(called, 0)));
	assert(!q.pass(3, function() {
		tl.assertTimeWithin(s, 0, 20);
		assert.equal(called.join(','), '0');
		
		// wait for 2 items to expire, and add again
		setTimeout(function() {
			s = Date.now();
			assert(!q.pass(1, function() {
				tl.assertTimeWithin(s, 0, 20);
				assert.equal(called.join(','), '0');
				done();
			}));
		}, 160);
	}));
});

it('should not throttle if one add exceeds burst', function(done) {
	var q = new ThrottleQueue(5, 400);
	var s = Date.now();
	assert(!q.pass(3, function() {
		assert(!q.pass(3, function() {
			tl.assertTimeWithin(s, 0, 20);
			// this add should be throttled
			var s2 = Date.now();
			assert(q.pass(1, function() {
				tl.assertTimeWithin(s2, 140, 180);
				done();
			}));
		}));
	}));
});


it('should throttle if exceeds burst', function(done) {
	var q = new ThrottleQueue(5, 100);
	var s = Date.now();
	assert(!q.pass(9, function() {
		tl.assertTimeWithin(s, 0, 20);
		assert(q.pass(5, function() {
			tl.assertTimeWithin(s, 80, 120);
			assert(q.pass(5, function() {
				tl.assertTimeWithin(s, 180, 220);
				done();
			}));
		}));
	}));
});

it('should throttle if exceeds burst (2)', function(done) {
	var q = new ThrottleQueue(5, 200);
	var s = Date.now();
	var called = 0;
	assert(!q.pass(9, function() {
		tl.assertTimeWithin(s, 0, 20);
		called = 1;
		assert(q.pass(6, function() {
			tl.assertTimeWithin(s, 180, 220);
			assert.equal(called, 3);
			called = 4;
			s = Date.now();
		}));
	}));
	assert(q.pass(5, function() {
		tl.assertTimeWithin(s, 180, 220);
		assert.equal(called, 1);
		called = 2;
		s = Date.now();
		assert(q.pass(6, function() {
			tl.assertTimeWithin(s, 220, 260);
			assert.equal(called, 4);
			called = 5;
			s = Date.now();
			assert(q.pass(500, function() {
				tl.assertTimeWithin(s, 220, 260);
				assert.equal(called, 6);
				done();
			}));
		}));
	}));
	assert(q.pass(5, function() {
		tl.assertTimeWithin(s, 180, 220);
		assert.equal(called, 2);
		called = 3;
		s = Date.now();
		assert(q.pass(6, function() {
			tl.assertTimeWithin(s, 220, 260);
			assert.equal(called, 5);
			called = 6;
			s = Date.now();
		}));
	}));
});

it('should throttle when needed, even if under-utilised', function(done) {
	var q = new ThrottleQueue(5, 200);
	var s = Date.now();
	assert(!q.pass(9, function() {
		tl.assertTimeWithin(s, 0, 20);
		assert(q.pass(5, function() {
			// throttle should trigger
			tl.assertTimeWithin(s, 180, 220);
			
			// now wait 2x periods
			setTimeout(function() {
				s = Date.now();
				// channel should now be under-utilised
				assert(!q.pass(1, function() {
					tl.assertTimeWithin(s, 0, 20);
					assert(!q.pass(5, function() {
						tl.assertTimeWithin(s, 0, 20);
						
						s = Date.now();
						// this should throttle, despite overall rate being below target rate
						assert(q.pass(5, function() {
							tl.assertTimeWithin(s, 70, 90);
							done();
						}));
					}));
				}));
			}, 400);
		}));
	}));
});

it('should not throttle if disabled', function(done) {
	var q = new ThrottleQueue(1, 0);
	var called = [];
	var s = Date.now();
	assert(!q.pass(1, called.push.bind(called, 0)));
	assert(!q.pass(1, called.push.bind(called, 1)));
	assert(!q.pass(1, function() {
		tl.assertTimeWithin(s, 0, 20);
		assert.equal(called.join(','), '0,1');
		
		assert(!q.pass(1, function() {
			tl.assertTimeWithin(s, 0, 20);
			done();
		}));
	}));
});


// TODO: add complex mixed case

it('should flush all queued when requested', function(done) {
	var q = new ThrottleQueue(5, 200);
	var s = Date.now();
	var cbCnt = 0;
	assert(!q.pass(9, function(cancelled) {
		tl.assertTimeWithin(s, 0, 20);
		assert(!cancelled);
		cbCnt++;
	}));
	assert(q.pass(5, function(cancelled) {
		assert(cancelled);
		tl.assertTimeWithin(s, 0, 20);
		cbCnt++;
	}));
	assert(q.pass(5, function(cancelled) {
		assert(cancelled);
		tl.assertTimeWithin(s, 0, 20);
		cbCnt++;
	}));
	q.cancel();
	tl.defer(function() {
		assert.equal(cbCnt, 3);
		done();
	});
});

it('should handle basic cancelItem', function(done) {
	var q = new ThrottleQueue(5, 200);
	var s = Date.now();
	var cbCnt = 0;
	assert(!q.pass(9, function(cancelled) {
		tl.assertTimeWithin(s, 0, 20);
		assert(!cancelled);
		cbCnt++;
	}));
	var token = q.pass(5, function(cancelled) {
		assert(cancelled);
		tl.assertTimeWithin(s, 0, 20);
		cbCnt++;
	});
	assert(q.pass(5, function(cancelled) {
		tl.assertTimeWithin(s, 180, 220);
		assert(!cancelled);
		assert.equal(cbCnt, 2);
		done();
	}));
	token.cancel();
});

});
