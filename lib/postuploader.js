"use strict";

var async = require('async');
var path = require('path');
var fs = require('fs');
var Uploader = require('./uploader');
var Article = require('./article');
var EventEmitter = require('events').EventEmitter;
var BufferPool, Nyutil;
var bufferSlice = Buffer.prototype.readBigInt64BE ? Buffer.prototype.subarray : Buffer.prototype.slice;

exports.log = null;
exports.setLogger = function(log) {
	exports.log = log;
	Uploader.setLogger(log);
};

exports.upload = function(_files, opts, cb) {
	var files = {}, maxSize = 0;
	var ee = new EventEmitter();
	
	var processDirFile = function(stats, cb) {
		if(stats.isDirectory() && exports.log) {
			exports.log.warn('Skipping directory: ' + stats.file);
			return cb();
		}
		if(stats.isSymbolicLink()) return cb();
		if(!stats.isFile()) return cb(new Error('Unknown file type for file: ' + stats.file));
		if(!stats.size && exports.log) {
			exports.log.warn('Skipping empty file: ' + stats.file);
			return cb();
		}
		files[stats.file] = {name: path.basename(stats.file), size: stats.size, stat: stats};
		maxSize = Math.max(maxSize, stats.size);
		cb();
	};
	
	var stat = opts.skipSymlinks ? fs.lstat : fs.stat;
	async.eachSeries(_files, function(file, cb) {
		if(typeof file == 'string') {
			stat(file, function(err, stats) {
				if(err) return cb(err);
				
				if(stats.isDirectory()) {
					switch(opts.subdirs) {
						case 'keep':
							// recurse thru subdirs
							(Nyutil || (Nyutil = require('./util'))).recurseDir(file, opts.skipSymlinks, processDirFile, cb);
						return;
						case 'include':
							(Nyutil || (Nyutil = require('./util'))).dirStatList(file, opts.skipSymlinks, function(err, list) {
								if(err) return cb(err);
								async.eachSeries(list, processDirFile, cb);
							});
						return;
						case 'skip':
							if(exports.log) exports.log.warn('Skipping directory: ' + file);
						break;
						default:
							return cb(new Error('Invalid subdirectory option: ' + opts.subdirs));
					}
				}
				else if(stats.isFile()) {
					if(stats.size) {
						files[file] = {name: path.basename(file), size: stats.size, stat: stats};
						maxSize = Math.max(maxSize, stats.size);
					} else if(exports.log)
						exports.log.warn('Skipping empty file: ' + file);
				}
				else if(!stats.isSymbolicLink()) {
					return cb(new Error('Unknown file type for file: ' + file));
				}
				cb();
			});
		}
		// TODO: add support for streams etc?
		else
			cb(new Error('Invalid file specification ' + file));
	}, setImmediate.bind(null, function(err) {
		if(err) return cb(err);
		
		if(opts.check.queueCache === null || opts.check.queueCache === undefined)
			opts.check.queueCache = 5;
		
		var up = new Uploader(opts, cb);
		ee.emit('start', files, up);
		
		var pool, readFn;
		if(opts.useBufferPool !== false) {
			if(!BufferPool)
				BufferPool = require('./bufferpool');
			pool = new (BufferPool || (BufferPool = require('./bufferpool')))(maxSize, BufferPool.calcSizeForUpload(up, opts.servers));
			readFn = function(filename, cb) {
				fs.open(filename, 'r', function(err, fd) {
					if(err) return cb(err);
					
					var buf = pool.get();
					fs.read(fd, buf, 0, buf.length, 0, function(err, sz) {
						if(err) return cb(err);
						fs.close(fd, function(err) {
							cb(err, buf, sz);
						});
					});
				});
			};
		} else {
			readFn = fs.readFile.bind(fs);
		}
		
		async.eachSeries(Object.keys(files), function(filename, cb) {
			readFn(filename, function(err, data, sz) {
				if(err || !data.length) {
					return cb(err || new Error('Data could not be read from ' + filename));
				}
				
				var post;
				try {
					if(pool)
						post = Article.fromBuffer(bufferSlice.call(data, 0, sz), opts.articleEncoding);
					else
						post = Article.fromBuffer(data, opts.articleEncoding);
				} catch(x) {
					return cb(x);
				}
				post.keepMessageId = opts.keepMessageId;
				
				post.reload = function(cb) {
					readFn(filename, function(err, data, sz) {
						if(err || !data.length)
							return cb(err || new Error('Data could not be read from ' + filename));
						if(pool)
							post.reloadData(bufferSlice.call(data, 0, sz));
						else
							post.reloadData(data);
						cb();
					});
				};
				
				// override post.inputLen because our 'total size' measurement works differently
				if(pool) {
					post.inputLen = sz;
					post.buf = data;
					post.release = function() {
						if(!post.buf) return;
						pool.put(post.buf);
						post.data = post.buf = null;
					};
				} else {
					post.inputLen = data.length;
				}
				up.addPost(post, cb, function(err) {
					post.release();
					if(post.successful && opts.deleteRawPosts) {
						fs.unlink(filename, function(err) {
							if(err && exports.log)
								exports.log.error('Failed to delete file: ' + filename, err);
						});
					}
				});
			});
			
		}, function(err) {
			if(err) {
				up.cancel(err);
			} else {
				up.finished();
				ee.emit('read_complete');
			}
		});
		
	}));
	return ee;
};
