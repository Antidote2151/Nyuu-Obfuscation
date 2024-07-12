"use strict";
var Timer = require('./timeoutwrap');

module.exports = function(size, takeStack) {
	this.queue = [];
	this.queuePending = {};
	this.addQueue = [];
	this.takeQueue = [];
	this.size = size | 0;
	this.takeFn = takeStack ? 'pop' : 'shift';
};

// TODO: consider ability to cancel the queue

module.exports.prototype = {
	pendingAdds: 0,
	_pendingId: 0,
	hasFinished: false,
	timerLabel: 'queue',
	add: function(time, data, cb) {
		if(time <= 0) // NOTE: result is undefined for time < 0
			this._add(data);
		else {
			var id = this._pendingId++;
			var t = Timer(this.timerLabel, function() {
				delete this.queuePending[id];
				this.pendingAdds--;
				this._add(data);
				if(this.hasFinished && !this.pendingAdds)
					this._flushTakes();
			}.bind(this), time);
			this.queuePending[id] = {
				data: data,
				timer: t
			};
			this.pendingAdds++;
		}
		if(cb) {
			if(this.queue.length+this.pendingAdds > this.size) {
				this.addQueue.push(cb); // size exceeded, so defer callback
				return false;
			} else
				cb();
		}
		return true;
	},
	_add: function(data) {
		// if there's something waiting for data, just give it
		var f = this.takeQueue[this.takeFn]();
		if(f !== undefined) {
			this._shiftAdd();
			f(data);
		} else {
			this.queue.push(data);
		}
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
		if(this.queue.length+this.pendingAdds <= this.size) {
			// TODO: consider whether a good idea to empty addQueue at this point?
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
		this.hasFinished = true;
		if(!this.pendingAdds)
			this._flushTakes();
	},
	totalQueueSize: function() {
		return this.pendingAdds + this.queue.length;
	},
	isEmpty: function() {
		return !this.pendingAdds && !this.queue.length && !this.addQueue.length;
	},
	_flushTakes: function() {
		var f;
		while(f = this.takeQueue.shift())
			f();
		this.takeQueue = null;
	},
	flushPending: function(cancel) {
		this.pendingAdds = 0;
		for(var id in this.queuePending) {
			var item = this.queuePending[id];
			item.timer.cancel();
			if(cancel)
				this._shiftAdd();
			else
				this._add(item.data);
		}
		this.queuePending = {};
		if(this.hasFinished) this._flushTakes();
	}
};

