"use strict";

var assert = require("assert");
var TimerQueue = require('../lib/timerqueue');
var tl = require('./_testlib');

describe('Timer Queue', function() {

it('should return queued in order', function(done) {
	var q = new TimerQueue();
	var s = Date.now();
	assert.equal(q.totalQueueSize(), 0);
	assert(q.add(20, 1));
	assert(q.add(40, 2));
	assert.equal(q.totalQueueSize(), 2);
	assert(!q.take(function(n) {
		assert(Date.now() - s >= 19);
		assert.equal(n, 1);
		assert.equal(q.totalQueueSize(), 1);
		assert(!q.take(function(n) {
			assert(Date.now() - s >= 39);
			assert.equal(n, 2);
			assert.equal(q.totalQueueSize(), 0);
			
			done();
		}));
	}));
});

it('should return queued in order (no waiting)', function(done) {
	var q = new TimerQueue();
	var s = Date.now();
	q.add(40, 2);
	q.take(function(n) {
		assert(Date.now() - s >= 19);
		assert.equal(n, 1);
	});
	q.add(20, 1);
	q.take(function(n) {
		assert(Date.now() - s >= 39);
		assert.equal(n, 2);
		
		done();
	});
});

it('should return queued in order (out of order requests)', function(done) {
	var q = new TimerQueue();
	var s = Date.now();
	q.take(function(n) {
		assert(Date.now() - s >= 19);
		assert.equal(n, 1);
		q.add(20, 2);
	});
	q.take(function(n) {
		assert(Date.now() - s >= 39);
		assert.equal(n, 2);
		
		done();
	});
	assert.equal(q.totalQueueSize(), 0);
	q.add(20, 1);
});

it('should handle 0 time', function(done) {
	var q = new TimerQueue();
	q.add(0, 1);
	assert.equal(q.totalQueueSize(), 1);
	q.take(function(n) {
		assert.equal(n, 1);
		done();
	});
});

it('should work with both async/sync takes', function(done) {
	var q = new TimerQueue();
	assert.equal(q.takeSync(), undefined);
	q.add(0, 1);
	assert.equal(q.totalQueueSize(), 1);
	assert.equal(q.takeSync(), 1);
	assert.equal(q.totalQueueSize(), 0);
	
	q.take(function(n) {
		assert.equal(n, 2);
		assert.equal(q.totalQueueSize(), 0);
		q.add(20, 3);
	});
	assert.equal(q.takeSync(), undefined);
	q.add(20, 2);
	setTimeout(function() { // this timer *should* fire after the q.take above
		assert.equal(q.takeSync(), 3);
		assert.equal(q.takeSync(), undefined);
		
		q.add(0, 4);
		assert.equal(q.takeSync(), 4);
		q.take(function(n) {
			assert.equal(n, 5);
			done();
		});
		q.add(20, 5);
		assert.equal(q.takeSync(), undefined);
	}, 100);
});

it('should return empty on finished', function(done) {
	var q = new TimerQueue();
	q.finished();
	assert.equal(q.totalQueueSize(), 0);
	assert(q.take(function(n) {
		assert.equal(n, undefined);
		done();
	}));
	assert.equal(q.takeSync(), undefined);
});

it('should return empty on finished (with items)', function(done) {
	var q = new TimerQueue();
	var s = Date.now();
	q.add(20, 1);
	q.add(40, 2);
	q.take(function(n) {
		assert(Date.now() - s >= 19);
		assert.equal(n, 1);
	});
	q.finished();
	assert.equal(q.totalQueueSize(), 2);
	q.take(function(n) {
		assert(Date.now() - s >= 39);
		assert.equal(n, 2);
	});
	q.take(function(n) {
		assert(Date.now() - s >= 39);
		assert.equal(n, undefined);
	});
	q.take(function(n) {
		assert.equal(n, undefined);
		done();
	});
});

it('should return empty on finished (with items v2)', function(done) {
	var q = new TimerQueue(1);
	var s = Date.now();
	assert(q.add(20, 1));
	assert(q.add(40, 2)); // forced add, so should return true
	assert(!q.take(function(n) {
		assert(Date.now() - s >= 19);
		assert.equal(n, 1);
	}));
	assert(!q.take(function(n) {
		assert(Date.now() - s >= 39);
		assert.equal(n, 2);
	}));
	assert(!q.take(function(n) {
		assert(Date.now() - s >= 39);
		assert.equal(n, undefined);
	}));
	assert(!q.take(function(n) {
		assert.equal(n, undefined);
		done();
	}));
	q.finished();
});

it('should return empty on finished (out of order request)', function(done) {
	var q = new TimerQueue();
	q.take(function(n) {
		assert.equal(n, undefined);
		done();
	});
	q.finished();
});


it('should disable add on finished', function(done) {
	var q = new TimerQueue();
	q.finished();
	assert.throws(q.add.bind(q, 0, 1));
	done();
});

// this is just a ported copy/paste from timer test case
it('should wait when queue size exceeded', function(done) {
	var q = new TimerQueue(2);
	var addDone = 0;
	assert(q.add(0, 1, function(err) {
		if(err) throw err;
		assert(q.add(0, 2, function(err) {
			if(err) throw err;
			assert(!q.add(0, 3, function(err) {
				if(err) throw err;
				addDone = 1;
			}));
			assert(!q.add(0, 4, function(err) {
				if(err) throw err;
				addDone = 2;
			}));
			
			tl.defer(function() {
				assert.equal(addDone, 0);
				assert(q.take(function(n) {
					assert.equal(n, 1);
					tl.defer(function() {
						assert.equal(addDone, 0); // still have 1 too many item in queue, so add(3) shouldn't be done yet
						q.add(0, 5, function(err) {
							if(err) throw err;
							addDone = 3;
						});
						tl.defer(function() {
							assert.equal(addDone, 0);
							q.take(function(n) {
								assert.equal(n, 2);
								assert.equal(addDone, 0);
							});
							q.take(function(n) {
								assert.equal(n, 3);
								tl.defer(function() {
									assert.equal(addDone, 1);
									q.take(function(n) {
										assert.equal(addDone, 2);
										assert.equal(n, 4);
										q.take(function(n) {
											assert.equal(addDone, 3);
											assert.equal(n, 5);
											done();
										});
									});
								});
							});
						});
					});
				}));
			});
		}));
	}));
});

it('test queue overflow', function(done) {
	var q = new TimerQueue(2);
	var addDone = 0;
	q.add(0, 1, function() {
		assert.equal(addDone, 0);
		addDone = 1;
		q.add(500, 4, function() { // added out of order
			assert.equal(addDone, 1);
			addDone = 4;
		});
	});
	q.add(10, 2, function() { addDone = 2; q.add(50, 5, function() { addDone = 5; }); });
	q.add(20, 3, function() { addDone = 3; q.add(100, 6, function() { addDone = 6; }); });
	
	tl.defer(function() {
		assert.equal(addDone, 4); // queue size is 4 at this point
		q.take(function(n) {
			assert.equal(n, 1);
			tl.defer(function() {
				assert.equal(addDone, 4); // q size is 3 (2,3,4)
				q.take(function(n) {
					assert.equal(n, 2);
					assert.equal(addDone, 2); // q size is 3 (3,5,4)
					q.take(function(n) {
						assert.equal(addDone, 3); // q size 3 (5,6,4)
						assert.equal(n, 3);
					});
					q.take(function(n) {
						assert.equal(n, 5);
						tl.defer(function() {
							assert.equal(addDone, 5);
							q.take(function(n) {
								assert.equal(n, 6);
							});
							q.take(function(n) {
								assert.equal(n, 4);
								tl.defer(function() {
									assert.equal(addDone, 6);
									done();
								});
							});
						});
					});
				});
			});
		});
	});
});

// TODO: test flushPending
// TODO: need more test cases

});
