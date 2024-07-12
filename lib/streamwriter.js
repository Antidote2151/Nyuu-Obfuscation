"use strict";

var Queue = require('./queue');
var bufferSlice = Buffer.prototype.readBigInt64BE ? Buffer.prototype.subarray : Buffer.prototype.slice;

// if source is volatile, supply a BufferPool to be used for temp storage
function BufferedStreamWriter(stream, queueSize, pool) {
	this.stream = stream;
	this.queue = new Queue(queueSize);
	this.pool = pool;
	
	var onError = this.onError.bind(this);
	stream.once('close', onError);
	stream.once('error', onError);
	this._removeListeners = function() {
		this.stream.removeListener('close', onError);
		this.stream.removeListener('error', onError);
	};
	
	this._write();
}
BufferedStreamWriter.prototype = {
	err: null,
	
	write: function(chunk, cb) {
		if(this.err) return cb(this.err);
		
		var buf;
		if(this.pool) {
			// volatile source, copy to temp buffer
			buf = this.pool.get();
			if(chunk.length > buf.length) throw new Error('Cannot fit chunk into buffer');
			chunk.copy(buf);
			
			buf._targetLength = chunk.length;
		}
		var self = this;
		this.queue.add(buf || chunk, function() {
			cb(self.err);
		});
	},
	end: function(cb) {
		this.queue.finished();
		this._endCb = cb;
	},
	_write: function() {
		var self = this;
		this.queue.take(function(chunk) {
			if(self.err) return;
			if(!chunk) {
				// ended, close stream
				self._closeStream();
				if(self._endCb) self._endCb();
				return;
			}
			var c = chunk;
			if(typeof c._targetLength == 'number') c = bufferSlice.call(c, 0, c._targetLength);
			self.stream.write(c, function(err) {
				if(self.pool) self.pool.put(chunk);
				if(err)
					self.onError(err);
				else
					self._write();
			});
		});
	},
	
	onError: function(err) {
		if(this.err) return;
		this.err = err = err || new Error('Stream closed');
		
		this._closeStream();
		if(!this.queue.hasFinished)
			this.queue.flushAdds(this.err);
		if(this._endCb) this._endCb(err);
	},
	close: function() {
		this._closeStream();
		// end queue??
	},
	_closeStream: function() {
		if(this.stream) {
			this._removeListeners();
			this.stream.end();
			this.stream = null;
		}
	}
};

module.exports = BufferedStreamWriter;
