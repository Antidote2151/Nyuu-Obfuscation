"use strict";

module.exports = function(releaseFn, size) {
	this.cache = {};
	this.addQueue = [];
	this.evictable = {};
	this._release = releaseFn;
	this.size = size | 0;
};

module.exports.prototype = {
	_id: 0,
	cacheSize: 0,
	add: function(obj, evictable, cb) {
		var allowContinue = true;
		if(this.cacheSize >= this.size) {
			if(evictable) {
				// well, we don't need to cache...
				this._release(obj);
				if(cb) cb();
				return true;
			} else {
				// see if an item can be evicted to make room
				allowContinue = false;
				for(var id in this.evictable) {
					this.evict(id);
					allowContinue = true;
					break;
				}
			}
		}
		this.cacheSize++;
		this.cache[++this._id] = obj;
		if(evictable) this.evictable[this._id] = true;
		
		if(cb) {
			if(allowContinue) {
				cb(this._id);
			} else {
				this.addQueue.push(cb.bind(null, this._id));
			}
		}
		return allowContinue;
	},
	remove: function(id) {
		if(!(id in this.cache)) return false;
		delete this.cache[id];
		delete this.evictable[id];
		this.cacheSize--;
		
		// allow adds to continue
		while(this.cacheSize <= this.size && this.addQueue.length) {
			this.addQueue.shift()();
		}
	},
	evict: function(id) {
		if(!(id in this.cache)) return false;
		if(!this.evictable[id]) return false;
		this._release(this.cache[id]);
		this.remove(id);
	}
};

