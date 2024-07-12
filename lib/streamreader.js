"use strict";

var emptyBuffer = (Buffer.alloc || Buffer)(0);
var bufferSlice = Buffer.prototype.readBigInt64BE ? Buffer.prototype.subarray : Buffer.prototype.slice;

function BufferedStreamReader(stream, bufferSize) {
	this.stream = stream;
	this.bufferSize = bufferSize;
	this.bufferQueue = [];
	this.readQueue = [];
	
	if(!this.bufferSize && this.bufferSize !== 0)
		this.bufferSize = 65536; // default to 64K
	
	var onData = this.onData.bind(this),
	    onEnd = this.onEnd.bind(this),
	    onError = this.onError.bind(this);
	stream.on('data', onData);
	stream.once('end', onEnd);
	stream.once('close', onError);
	stream.once('error', onError);
	this._removeListeners = function() {
		this.stream.removeListener('data', onData);
		this.stream.removeListener('end', onEnd);
		this.stream.removeListener('close', onError);
		this.stream.removeListener('error', onError);
	};
}
BufferedStreamReader.prototype = {
	_eof: false,
	EOF: false,
	bufferedLen: 0,
	err: null,
	
	onData: function(chunk) {
		this.bufferQueue.push(chunk);
		this.bufferedLen += chunk.length;
		
		// if awaiting stuff, push to read
		while(this.readQueue.length && this.readQueue[0][0] <= this.bufferedLen) {
			var req = this.readQueue.shift();
			this._readout.apply(this, req);
		}
		
		var nextReadLen = this.readQueue.length ? this.readQueue[0][0] : 0;
		if(this.bufferedLen >= Math.max(this.bufferSize, nextReadLen))
			this.stream.pause();
		else
			this.stream.resume();
	},
	onEnd: function() {
		this._eof = true;
		// push out all remaining read requests
		var q = this.readQueue;
		this.readQueue = [];
		this._closeStream();
		q.forEach(function(req) {
			this._readout.apply(this, req);
		}.bind(this));
		
		// mark EOF if no buffered data remains
		if(this.bufferedLen == 0)
			this.EOF = true;
	},
	onError: function(err) {
		this.err = err = err || new Error('Stream closed');
		var q = this.readQueue;
		this.close();
		if(q) {
			q.forEach(function(req) {
				req[1](err);
			});
		}
	},
	read: function(size, cb) {
		if(this.err) return cb(this.err);
		if(this.EOF) return cb(null, emptyBuffer);
		var rqLen = this.readQueue.length;
		if(!rqLen && (this.bufferedLen >= size || this._eof)) {
			this._readout(size, cb);
			if(!this._eof && this.bufferedLen < this.bufferSize)
				this.stream.resume();
		} else {
			this.readQueue.push([size, cb]);
			if(!rqLen)
				this.stream.resume();
		}
	},
	close: function() {
		this._closeStream();
		this.bufferQueue = null;
		this.readQueue = null;
	},
	_closeStream: function() {
		if(this.stream) {
			this._removeListeners();
			this.stream = null;
		}
	},
	
	// read out size bytes from buffer and send to cb
	_readout: function(size, cb) {
		if(this.EOF) return cb(null, emptyBuffer);
		
		var l = 0;
		for(var i=0; i<this.bufferQueue.length; i++) {
			var buf = this.bufferQueue[i];
			var newL = l + buf.length;
			if(newL >= size) {
				// we're done, stop here
				var bufs;
				if(newL == size) {
					// chunk sizes just happens to match exactly
					bufs = this.bufferQueue.splice(0, i+1);
				} else {
					// need to split up the last chunk
					bufs = i ? this.bufferQueue.splice(0, i) : [];
					bufs.push(bufferSlice.call(this.bufferQueue[0], 0, size - l));
					this.bufferQueue[0] = bufferSlice.call(this.bufferQueue[0], size - l);
				}
				this.bufferedLen -= size;
				if(this._eof && this.bufferedLen == 0)
					this.EOF = true;
				cb(null, bufs.length == 1 ? bufs[0] : Buffer.concat(bufs, size));
				return;
			} else {
				l = newL;
			}
		}
		if(this._eof) {
			this.EOF = true;
			// put through all remaining data
			if(this.bufferedLen) {
				var bufs = this.bufferQueue;
				this.bufferQueue = [];
				this.bufferedLen = 0;
				cb(null, bufs.length == 1 ? bufs[0] : Buffer.concat(bufs, l));
			} else
				cb(null, emptyBuffer);
		} else {
			throw new Error('Insufficient data to cover request!');
		}
	}
};

module.exports = BufferedStreamReader;
