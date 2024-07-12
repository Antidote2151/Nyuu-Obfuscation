var asyncDelay = 100;
var assert = require("assert");
module.exports = {
	emptyFn: function(){},
	throwErr: function(err) {
		if(err) throw err;
	},
	defer: function(f) {
		setTimeout(f, asyncDelay);
	},
	fn1: function(f) {
		var called = false;
		return function() {
			if(called) throw new Error('callback called more than once');
			called = true;
			f.apply(null, arguments);
		};
	},
	assertTimeWithin: function(start, from, to) {
		var taken = Date.now() - start;
		// give 5ms leeway in timing
		if(taken < from-5) assert.equal(taken, from);
		if(to && taken >= to+5) assert.equal(taken, to);
	},
};
