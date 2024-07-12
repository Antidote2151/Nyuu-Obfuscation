"use strict";

const { Worker } = require('worker_threads');

const threadSource = '(' + (() => {
	const { parentPort } = require('worker_threads');
	
	const sockets = {};
	
	parentPort.on('message', ([id, fn, ...args]) => {
		if(fn == 'create') {
			if(id in sockets)
				throw new Error('Socket ID used');
			const opts = args[0];
			
			if(opts.onread) {
				opts.onread = {
					buffer: Buffer.allocUnsafe(4096), // don't think it's safe to use a shared array here
					callback: (size, buf) => {
						// TODO: might be a good idea to do string conversion here instead of copying buffer then converting?
						parentPort.postMessage([id, 'data', buf.buffer, buf.byteOffset, size]);
					}
				};
			}
			
			const socket = require(opts.secure ? 'tls':'net').connect(opts.connect);
			// emulate nntp.js stuff
			if(socket.setNoDelay)
				socket.setNoDelay(true);
			if(opts.tcpKeepAlive !== false && socket.setKeepAlive)
				socket.setKeepAlive(true, opts.tcpKeepAlive);
			sockets[id] = socket;
			
			
			const forwardEvent = (event, data) => parentPort.postMessage([id, event, data]);
			['connect','end','timeout','drain'].forEach(e => {
				socket.on(e, data => forwardEvent(e, data));
			});
			if(!opts.onread) {
				socket.on('data', msg => {
					parentPort.postMessage([id, 'data', msg.buffer, msg.byteOffset, msg.byteLength], [msg.buffer]);
				});
			}
			socket.on('error', err => {
				// node won't clone Error objects, so try to do it ourself
				const errCopy = JSON.parse(JSON.stringify(err));
				errCopy.name = err.constructor.name;
				errCopy.message = err.message;
				errCopy.stack = err.stack;
				parentPort.postMessage([id, 'error', errCopy]);
			});
			socket.once('close', hadError => {
				socket.unref();
				delete sockets[id];
				forwardEvent('close', hadError);
			});
		} else if(fn == '_close_thread') {
			parentPort.close();
		} else {
			const socket = sockets[id];
			if(!socket) return; // swallow possible errors if connection no longer exists
			if(fn == 'write' || fn == 'end') {
				if(args[0] instanceof Uint8Array) {
					// straight buffer
					socket[fn](Buffer.from(args[0])); // performs a copy!
					return;
				}
				if(args[0] instanceof ArrayBuffer || args[0] instanceof SharedArrayBuffer) {
					// transferred buffer with offset/length
					socket[fn](Buffer.from(args[0], args[1], args[2]));
					return;
				}
			}
			socket[fn](...args);
			/*if(fn == 'destroy') { // .destroy() always calls 'close' event, so unnecessary
				socket.unref();
				//parentPort.unref();
				delete sockets[id];
			}*/
		}
	});
}).toString() + ')()';

function SocketsThread() {
	// start thread + create connection
	this.worker = new Worker(threadSource, {eval: true});
	
	// attach message listener
	this.worker.on('message', ([id, fn, ...args]) => {
		if(fn == 'error') { // unpack Error object
			const err = new (global[args[0].name] || Error)(args[0].message);
			for(var k in args[0])
				err[k] = args[0][k];
			args[0] = err;
		}
		else if(fn == 'data') { // fix usage of TypedArray
			args[0] = Buffer.from(args[0], args[1], args[2]); // this doesn't copy underlying memory
		}
		this.sockets.get(id).emit(fn, ...args);
		if(fn == 'close') {
			this.sockets.delete(id);
		}
	});
	this.worker.once('error', err => {
		throw err; // propagate errors up
	});
	this.worker.once('exit', () => this.worker = null);
	
	this.sockets = new Map();
}

SocketsThread.prototype = {
	_counter: 0,
	create(stub, opts) {
		const id = this._counter++;
		this.sockets.set(id, stub);
		this.worker.postMessage([id, 'create', opts]);
		return id;
	},
	
	send(id, fn, ...args) {
		this.worker.postMessage([id, fn, ...args]);
		//if(fn == 'destroy')
		//	this.sockets.delete(id);
	},
	sendBuffer(id, fn, buf) {
		this.worker.postMessage([id, fn, buf.buffer, buf.byteOffset, buf.byteLength], [buf.buffer]);
	},
	
	close() {
		// don't do this if there's sockets!?
		this.worker.postMessage([0, '_close_thread']);
	}
}

function SocketStub(thread, opts) {
	const id = thread.create(this, opts);
	this._send = thread.send.bind(thread, id);
	this._sendBuffer = thread.sendBuffer.bind(thread, id);
};

SocketStub.prototype = {
	_doWrite(fn, msg, encoding) {
		if(Buffer.isBuffer(msg)) {
			if(msg.buffer instanceof SharedArrayBuffer) // share buffer with thread
				this._send(fn, msg.buffer, msg.byteOffset, msg.byteLength);
			else { // if not sharing, make a copy and transfer (avoids a double-copy at other end when converting from Uint8Array)
				const buf = Buffer.allocUnsafeSlow(msg.length);
				msg.copy(buf);
				this._sendBuffer(fn, buf);
			}
		} else // strings should be small, so just copy across
			this._send(fn, msg, encoding);
	},
	end(msg, encoding) {
		if(msg)
			this._doWrite('end', msg, encoding);
		else
			this._send('end');
	},
	write(msg, encoding) {
		this._doWrite('write', msg, encoding);
	},
	
	destroy() {
		this._send('destroy');
	},
	resume() {
		this._send('resume');
	},
};

require('util').inherits(SocketStub, require('events').EventEmitter);

let threads;
const findLeastUsedThread = () => {
	let lowestCnt = Number.MAX_VALUE, lowestThread;
	threads.forEach(thread => {
		if(thread && thread.sockets.size < lowestCnt) {
			lowestCnt = thread.sockets.size;
			lowestThread = thread;
		}
	});
	return lowestThread;
};

module.exports = {
	createPool(size) {
		if(threads) throw new Error('Thread pool already created');
		threads = Array(size);
		for(let i=0; i<size; i++) {
			threads[i] = new SocketsThread();
		}
	},
	closePool() {
		// TODO: cleanup sockets?
		threads.forEach(thread => thread && thread.close());
		threads = null;
	},
	
	create(opts, onConnected) {
		const conn = new SocketStub(findLeastUsedThread(), opts);
		if(onConnected) conn.once('connect', onConnected);
		return conn;
	}
};


