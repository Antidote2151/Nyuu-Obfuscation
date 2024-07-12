"use strict";

var allocBuffer = Buffer.allocUnsafe || Buffer;
var bufferSlice = Buffer.prototype.readBigInt64BE ? Buffer.prototype.subarray : Buffer.prototype.slice;
var emptyBuffer = allocBuffer(0);
var emptyFn = function(){};
var fs = require('fs');

function BufferedFileReader(file, reqSize, readBuffer) {
	this.fd = null;
	var self = this;
	this.file = file;
	fs.open(file, 'r', function(err, fd) {
		if(err) return self.onError(err);
		self.fd = fd;
		self._read();
	});
	this.reqSize = reqSize || 65536; // default to 64K
	if(readBuffer) {
		// re-use supplied read buffer
		this.buffer = readBuffer;
		if(!readBuffer.length || readBuffer.length % this.reqSize)
			throw new Error('Invalid read buffer supplied');
	} else {
		this.buffer = allocBuffer(this.reqSize);
	}
	this.readQueue = [];
}
BufferedFileReader.prototype = {
	bufferedLen: 0,
	readBufPos: 0,
	outBufPos: 0,
	isReading: false,
	nextRead: null,
	nextReadPos: 0,
	_eof: false,
	EOF: false,
	err: null,
	
	_read: function() {
		if(this.isReading || this._eof || this.fd === null) return;
		var self = this;
		/* TODO: if we can read directly into dest buffer, may as well take that optimisation
		if(this.nextRead && this.nextRead.length - this.nextReadPos > this.reqSize) {
			// may as well read directly into the target buffer
			if(this.bufferedLen) throw new Error('Internal buffer accounting error');
			this.isReading = true;
			fs.read(this.fd, this.nextRead, this.nextReadPos, this.reqSize, undefined, function(err, bytes) {
				if(err) return self.onError(err);
				if(!bytes) { // TODO: handle this
					self.isReading = false;
					self.onEnd();
					return;
				}
				self.nextReadPos += bytes;
				// the 'completed' condition is handled below
				self.isReading = false;
				self._read();
			});
			return;
		}
		*/
		if(this.buffer.length - this.bufferedLen >= this.reqSize) {
			this.isReading = true;
			fs.read(this.fd, this.buffer, this.readBufPos, this.reqSize, undefined, function(err, bytes) {
				if(err || self.fd === null) return self.onError(err);
				self.isReading = false;
				if(!bytes) {
					self.onEnd();
					return;
				}
				
				self.bufferedLen += bytes;
				self._incrWrap('readBufPos', bytes);
				if(bytes < self.reqSize) // a smaller than expected read = end reached
					self._eof = true; // need to mark _eof earlier to prevent optimistic reads from going through
				
				// if we've got to service a large read, do it now
				if(self.nextRead) {
					var len = Math.min(self.nextRead.length - self.nextReadPos, self.bufferedLen);
					if(len) {
						if(self.outBufPos % self.reqSize) throw new Error('Internal buffer accounting error');
						self._copyToNextBuf(len);
					}
					if(self.nextReadPos >= self.nextRead.length) {
						// first, schedule a read-ahead
						self._read();
						// this request has been serviced now
						var req = self.readQueue.shift();
						var buf = self.nextRead;
						self.nextRead = null;
						req[1](null, buf);
					}
				}
				
				// optimistically schedule a read-ahead if possible
				self._read();
				
				// if awaiting stuff, push to read
				while(self.readQueue.length && self.readQueue[0][0] <= self.bufferedLen) {
					var req = self.readQueue.shift();
					req[1](null, self._readout(req[0]));
				}
				
				// check if the next read is too large to deal with existing buffers
				if(!self.nextRead && self.readQueue.length)
					self._allocLargeRead(self.readQueue[0][0]);
				if(!self._eof)
					self._read();
				else
					self.onEnd();
			});
		}
	},
	_incrWrap: function(key, amt) {
		this[key] += amt;
		if(this[key] >= this.buffer.length) {
			this[key] -= this.buffer.length;
		}
	},
	_copyToNextBuf: function(amt) {
		this.buffer.copy(this.nextRead, this.nextReadPos, this.outBufPos, this.outBufPos + amt);
		this.bufferedLen -= amt;
		this._incrWrap('outBufPos', amt);
		this.nextReadPos += amt;
	},
	_allocLargeRead: function(amt) {
		if(this.nextRead) throw new Error('Attempted to allocate multiple temp buffers');
		// can this read be ever served? if so, bail
		if(amt <= this.buffer.length - (this.outBufPos % this.reqSize))
			return;
		
		// allocate a Buffer for servicing this read request
		this.nextRead = allocBuffer(amt);
		this.nextReadPos = 0;
		// copy existing buffered info
		if(this.bufferedLen) {
			this._copyToNextBuf(Math.min(this.buffer.length - this.outBufPos, this.bufferedLen));
			
			// handle wrap around case
			if(this.bufferedLen) {
				if(this.outBufPos) throw new Error('Internal buffer accounting error');
				this._copyToNextBuf(this.bufferedLen);
			}
		}
	},
	
	onEnd: function() {
		this._eof = true;
		// push out all remaining read requests
		var q = this.readQueue;
		this.readQueue = [];
		if(this.fd !== null) fs.close(this.fd, emptyFn);
		this.fd = null;
		if(this.nextRead) {
			if(this.bufferedLen) throw new Error('Internal buffer accounting error');
			this.EOF = true;
			var req = q.shift();
			var buf = this.nextRead;
			this.nextRead = null;
			req[1](null, bufferSlice.call(buf, 0, this.nextReadPos));
		}
		q.forEach(function(req) {
			req[1](null, this._readout(req[0]));
		}.bind(this));
		
		// mark EOF if no buffered data remains
		if(this.bufferedLen == 0)
			this.EOF = true;
	},
	onError: function(err) {
		this.err = err = err || new Error('Stream closed');
		var q = this.readQueue;
		this._close();
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
			cb(null, this._readout(size));
		} else {
			this.readQueue.push([size, cb]);
			if(!rqLen) this._allocLargeRead(size);
		}
		this._read();
	},
	// TODO: callback for close event?
	// TODO: support close request whilst reading
	_close: function(cb) {
		if(this.fd !== null) fs.close(this.fd, cb || emptyFn);
		this.fd = null;
		this.buffer = null;
		//this.readQueue = null; // is read later on
		this.nextRead = null;
		this.bufferedLen = 0;
		this.EOF = true;
		
		if(this.fd === null && cb) cb();
	},
	close: function(cb) {
		this.onEnd();
		this._close(cb);
	},
	
	// read out size bytes from buffer and send to cb
	_readout: function(size) {
		if(this.EOF) return emptyBuffer;
		
		if(size > this.bufferedLen) {
			if(this._eof) 
				size = this.bufferedLen;
			else
				throw new Error('Insufficient data to cover request!');
		}
		var dest;
		if(this.outBufPos + size > this.buffer.length) {
			// request wraps around, need to copy buffers
			// align buffer size with read amounts to avoid this penalty
			dest = allocBuffer(size);
			var len1 = this.buffer.length - this.outBufPos;
			this.buffer.copy(dest, 0, this.outBufPos, this.buffer.length);
			this.buffer.copy(dest, len1, 0, size - len1);
		} else {
			dest = bufferSlice.call(this.buffer, this.outBufPos, this.outBufPos + size);
		}
		
		this._incrWrap('outBufPos', size);
		this.bufferedLen -= size;
		
		if(this._eof && !this.bufferedLen)
			this.EOF = true;
		return dest;
	},
	
	// this function isn't really a part of this class as it will work regardless of the file being open or not
	readRange: function(offset, buf, cb) {
		// TODO: avoid re-opening if possible
		fs.open(this.file, 'r', function(err, fd) {
			if(err) return cb(err);
			fs.read(fd, buf, 0, buf.length, offset, function(err, bytesRead) {
				if(err) return cb(err);
				fs.close(fd, function() {
					cb(null, bufferSlice.call(buf, 0, bytesRead));
				});
			});
		});
	}
};

module.exports = BufferedFileReader;
