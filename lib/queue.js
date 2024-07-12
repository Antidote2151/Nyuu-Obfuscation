"use strict";

module.exports = function(size, takeStack) {
	this.queue = [];
	this.addQueue = [];
	this.reservedQueue = [];
	this.takeQueue = [];
	this.size = size | 0;
	this.hasFinished = false;
	this.takeFn = takeStack ? 'pop' : 'shift';
};

module.exports.prototype = {
	reserved: 0, // allow space to be reserved on the queue for future additions
	reserve: function() {
		this.reserved++;
	},
	fulfill: function(data, cb) {
		this.reserved--;
		this.add(data, cb, true);
	},
	
	add: function(data, cb, _skipReserve) {
		// if there's something waiting for data, just give it
		var f = this.takeQueue[this.takeFn]();
		if(f !== undefined) {
			f(data);
		} else {
			this.queue.push(data);
		}
		if(cb) {
			if(_skipReserve && this.queue.length > this.size) {
				this.reservedQueue.push(cb);
				return false;
			} else if(!_skipReserve && this.queue.length > (this.size - this.reserved)) {
				this.addQueue.push(cb); // size exceeded, so defer callback
				return false;
			} else
				cb();
		}
		return true;
	},
	take: function(cb) {
		var ret = this.queue.shift();
		if(ret === undefined) {
			if(this.takeQueue) {
				this.takeQueue.push(cb); // waiting for data
				return false;
			} else
				cb(); // already finished
		} else {
			this._shiftAdd();
			cb(ret);
		}
		return true;
	},
	_shiftAdd: function() {
		if(this.queue.length <= this.size && this.reservedQueue.length) {
			this.reservedQueue.shift()();
		} else if(this.queue.length <= this.size - this.reserved) {
			var next = this.addQueue.shift();
			if(next) next(); // signal that more data can be added
		}
	},
	takeSync: function() {
		var ret = this.queue.shift();
		if(ret !== undefined)
			this._shiftAdd();
		return ret;
	},
	finished: function() {
		this.add = function() {
			throw new Error('Cannot add after finished');
		};
		var f;
		while(f = this.takeQueue.shift())
			f();
		this.takeQueue = null;
		this.hasFinished = true;
	},
	
	// for handling error situations and such
	flushAdds: function() {
		var args = arguments;
		var f = function(fn) {
			fn.apply(null, args);
		};
		this.reservedQueue.forEach(f);
		this.reservedQueue = [];
		this.addQueue.forEach(f);
		this.addQueue = [];
	}
};

