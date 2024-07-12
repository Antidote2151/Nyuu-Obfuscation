"use strict";

function BufferPool(size, maxLength, useShared) {
	this.size = size;
	this.pool = [];
	this.maxLength = maxLength || 100; // prevent some crazy spike from overwhelming us - in this case, we just fall back to letting the GC do its thing
	if(maxLength === 0) this.maxLength = 0;
	
	if(useShared) this.get = this._getShared;
}

BufferPool.prototype = {
	get: Buffer.allocUnsafe ? function() {
		var ret = this.pool.pop();
		if(ret) return ret;
		return Buffer.allocUnsafe(this.size);
	} : function() {
		var ret = this.pool.pop();
		if(ret) return ret;
		return new Buffer(this.size);
	},
	_getShared: function() {
		var ret = this.pool.pop();
		if(ret) return ret;
		return Buffer.from(new SharedArrayBuffer(this.size));
	},
	put: function(buffer) {
		if(!this.maxLength || this.pool.length < this.maxLength)
			this.pool.push(buffer);
	},
	drain: function() {
		this.put = function(){};
		this.pool = [];
	}
};

// calculate the default size for upload operations
BufferPool.calcSizeForUpload = function(uploader, conns) {
	var numConnections = 0;
	conns.forEach(function(c) {
		numConnections += c.postConnections;
	});
	var maxPoolSize = uploader.queue.size + uploader.checkCache.size + numConnections*2 +4;
	// TODO: I don't really like these hard-coded heuristics :/
	if(maxPoolSize < 128) maxPoolSize = 128;
	// if we've got an insane number of items, it's probably better to let the GC handle things than manually manage them
	if(maxPoolSize > 256)
		maxPoolSize -= ((maxPoolSize-256) * Math.min(maxPoolSize/2048, 0.5)) | 0;
	if(maxPoolSize > 1024) maxPoolSize = 1024;
	return maxPoolSize;
};

module.exports = BufferPool;
