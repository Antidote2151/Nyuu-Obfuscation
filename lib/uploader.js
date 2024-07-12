"use strict";

var async = require('async');
var Queue = require('./queue');
var NNTP = require('./nntp');
var util = require('./util');
var TimerQueue = require('./timerqueue');
var ThrottleQueue = require('./throttlequeue');
var CacheMgr = require('./cachehelper');
var config = require('../config');
var Timer = require('./timeoutwrap');

function UploaderError(message) {
	var r = Error.call(this, message);
	r.name = 'UploaderError';
	r.message = message;
	return r;
}
UploaderError.prototype = Object.create(Error.prototype, {
	constructor: UploaderError
});

var dumpPost = function(self, post, cb) {
	if(self.opts.dumpPostLoc && post.messageId) {
		// since this is just a debugging function, don't bother doing this properly
		if(post.data)
			require('fs').writeFileSync(self.opts.dumpPostLoc + post.messageId, post.data);
		else {
			post.reload(function(err) {
				if(err) throw err;
				self.articlesReRead++;
				require('fs').writeFile(self.opts.dumpPostLoc + post.messageId, post.data, function(err) {
					if(err) throw err;
					cb();
				});
			});
			return;
		}
	}
	if(cb) cb();
};

// track time usage for network upload speed
// this is just a simple reference counter (as long as there's activity, time is tracked)
function RawSpeedTimeTracker() {}
RawSpeedTimeTracker.prototype = {
	time: 0,
	startTime: 0,
	reqs: 0,
	start: function(now) {
		if(this.reqs == 0)
			this.startTime = now || Date.now();
		this.reqs++;
	},
	end: function(now) {
		this.reqs--;
		if(this.reqs == 0)
			this.time += (now || Date.now()) - this.startTime;
	},
	value: function() {
		var ret = this.time;
		if(this.reqs)
			ret += Date.now() - this.startTime;
		return ret;
	}
};

function Uploader(opts, cb) {
	this.opts = util.extend({}, config, opts);
	
	var self = this;
	this.opts.servers.forEach(function(c) {
		self.numPostConns += c.postConnections;
		self.numCheckConns += c.checkConnections;
		if(c.ulConnReuse)
			self.numCheckConns += c.postConnections;
	});
	if(!this.opts.check.tries) this.numCheckConns = 0;
	this.queue = new Queue(util.optSel(this.opts.articleQueueBuffer, Math.min(Math.round(this.numPostConns*0.5)+2, 25)), this.opts.useLazyConnect);
	this.checkQueue = new TimerQueue(this.opts.check.queueBuffer, this.opts.useLazyConnect);
	this.checkQueue.timerLabel = 'check-delay';
	this.checkCache = new CacheMgr(function(post) {
		post.releaseData();
	}, util.optSel(this.opts.check.queueCache, Math.min(this.numPostConns*8, 100)));
	this.reloadQueue = new Queue(0);
	
	this.hasFinished = false;
	this.postConnections = [];
	this.checkConnections = [];
	
	this.throttlers = [];
	this.rawSpeedTime = new RawSpeedTimeTracker();
	
	this.skipErrs = {};
	if(this.opts.skipErrors) {
		var valid = {
			'post-timeout': 1,
			'post-reject': 1,
			'post-fail': 1,
			'check-timeout': 1,
			'check-missing': 1,
			'check-fail': 1,
			'connect-fail': 1,
		};
		if(this.opts.skipErrors === true) {
			this.skipErrs = valid;
		} else {
			this.opts.skipErrors.forEach(function(se) {
				if(!valid[se]) throw new Error('Invalid error to skip: ' + se);
				this.skipErrs[se] = 1;
			}.bind(this));
		}
	}
	
	if(!this.opts.dumpPostLoc && this.opts.check.postRetries < 1)
		// cache not needed - so evict data immediately
		this.checkCacheAdd = function(post, evictable, cb) {
			post.release();
			cb(null);
			return true;
		};
	else
		this.checkCacheAdd = this.checkCache.add.bind(this.checkCache);
	
	this.doneCb = cb || function(){};
	this._start();
}
Uploader.prototype = {
	articlesRead: 0,
	articlesReRead: 0,
	articlesPosted: 0,
	articlesRePosted: 0,
	bytesPosted: 0,
	articlesChecked: 0, // number of successfully checked articles
	articlesRechecked: 0, // times an article had to be rechecked
	checkPending: 0,
	checkRePending: 0,
	// the following two may seem a bit redundant, as you can get the figures from connection states, but might help track uploader-level state (since the connection could be different, e.g. in error state)
	checkActive: 0,
	postActive: 0,
	articleErrors: 0,
	totalUploadData: 0,
	rawSpeedTime: null,
	cancelled: false,
	ended: false,
	numPostConns: 0,
	numCheckConns: 0,
	
	addPost: function(post, continueCb, completeCb) {
		this.articlesRead++;
		post.postTries = 0;
		post.errorCount = 0;
		post.successful = false;
		post.doneCb = completeCb;
		this.queue.add(post, continueCb);
	},
	
	_start: function() {
		var self = this;
		var chkOpts = this.opts.check;
		// warning flags
		var inputQueueEmptyWarned = !NNTP.log, checkQueueFillWarned = !NNTP.log; // if no logger set up, pretend that warnings have already been issued so that we don't try to do it again
		var inputQueueEmptyDelay = 0, inputQueueEmptyStart = null;
		var inputQueueEmptyArticleThresh = Math.max(self.numPostConns, self.queue.size)*2;
		
		var concurrentReloads = 1;
		
		async.parallel([
			async.each.bind(async, this.opts.servers, function(server, cb) {
				if(server.throttleRate && server.throttleRate.size && server.throttleRate.time) {
					var uploadThrottler = new ThrottleQueue(server.throttleRate.size, server.throttleRate.time);
					self.throttlers.push(uploadThrottler);
					server.throttle = uploadThrottler.pass.bind(uploadThrottler);
					// check if we should reduce chunk size, because it would take too long to send a chunk
					if(server.uploadChunkSize && server.throttleChunkTime) {
						var newChunkSize = server.throttleRate.size / server.throttleRate.time * server.throttleChunkTime;
						newChunkSize = Math.max(1, Math.ceil(newChunkSize / 4096)) * 4096;
						if(newChunkSize < server.uploadChunkSize)
							server.uploadChunkSize = newChunkSize;
					}
				}
				server.encoding = self.opts.articleEncoding;
				async.parallel([
					async.times.bind(async, server.postConnections, function(i, cb) {
						var c = new NNTP(server, self.rawSpeedTime);
						c.connNum = self.postConnections.length;
						self.postConnections[c.connNum] = c;
						if(server.ulConnReuse && chkOpts.group)
							c.currentGroup = chkOpts.group; // setting this before .connect causes the group to be auto-selected
						
						if(self.opts.useLazyConnect)
							doPost();
						else
							c.connect(function(err) {
								// handle case of connection being closed, due to process completion, before we're able to start
								if(err && err.code == 'cancelled' && self.ended) return cb();
								doPost(err);
							});
						
						function doPost(err) {
							if(err) {
								if(self.cancelled && err.code == 'cancelled') return;
								// TODO: retries? (need to distinguish between connect/post error)
								self._closeConnection('post', c.connNum, function() {
									if(err.code == 'connect_fail') {
										if(self.skipErrs['connect-fail']) {
											if(NNTP.log)
												NNTP.log.error(err);
											// are there any connections left? if not, this is a fatal error
											if(self._activeConnectionCount('post') == 0)
												return cb(new UploaderError('No connections available for uploading. Process terminated'));
											return cb();
										}
										err.skippable = true;
									}
									cb(err);
								});
								return;
							}
							// clear check queue first
							// TODO: in reality, we need to alternate between the two queues, because this will stall if the post action depends the check queue being processed
							var chkPost;
							if(server.ulConnReuse && (chkPost = self.checkQueue.takeSync())) {
								self._checkPost(c, chkPost, doPost);
							} else {
								var got = self.queue.take(function(post) {
									if(!post) {
										// no more data, close down?
										if(server.ulConnReuse) {
											// we still may need to reuse this connection for checking
											// TODO: can't just dedicate the connection for checking if post retrying is enabled
											self._checkLoop(c, cb)();
										} else {
											// no checking needed on this connection, close it down
											self._closeConnection('post', c.connNum, function() {
												cb();
											});
										}
										return;
									}
									if(self.cancelled) return;
									self.postActive++;
									c.post(post, function(err, messageId) {
										self.postActive--;
										var postCompletionCb = doPost;
										if(err) {
											if(self.cancelled && err.code == 'cancelled') return;
											dumpPost(self, post); // post.data guaranteed to be set here
											
											// handle error skipping
											err.skippable = true;
											var isPostFailure = (['connect_fail','connection_ended','not_connected'].indexOf(err.code) == -1);
											if(messageId) {
												if(err.code == 'timeout' && self.skipErrs['post-timeout']) {
													self._markPostError(post, 'Posting timed out');
												} else if((err.code == 'post_denied' || err.code == 'bad_response' || err.code == 'unknown_error') && self.skipErrs['post-reject']) {
													self._markPostError(post, 'Post rejected (' + err.message + ')');
												} else if(self.skipErrs['post-fail'] && isPostFailure) {
													self._markPostError(post, 'Posting failed (' + err.message + ')');
												} else
													postCompletionCb = doPost.bind(null, err);
											} else if(self.skipErrs['post-fail'] && isPostFailure) {
												post.messageId = null; // skipping post where Message-ID is completely invalid
												self._markPostError(post, 'Posting failed (' + err.message + ')');
											} else
												postCompletionCb = doPost.bind(null, err);
										}
										self.articlesPosted++;
										self.bytesPosted += post.inputLen;
										if(self.numCheckConns && messageId && !err) {
											post.chkFailures = 0;
											post.postTries++;
											
											if(!self.checkCacheAdd(post, !!post.reload, function(cacheId) {
												post.cacheId = cacheId;
												self.checkPending++;
												// TODO: careful with holding up the post queue if reusing post connections for checking
												if(!self.checkQueue.add(chkOpts.delay, post, doPost)) {
													if(!checkQueueFillWarned) NNTP.log.info('Check queue is now full - upload speed will be throttled to compensate');
													checkQueueFillWarned = true;
												}
											})) {
												if(!checkQueueFillWarned) NNTP.log.info('Check queue cache is now full - upload speed will be throttled to compensate');
												checkQueueFillWarned = true;
											}
											return;
										} else {
											post.successful = !err;
											self._postComplete(post, err, postCompletionCb);
										}
									});
								});
								if(inputQueueEmptyStart && got) {
									inputQueueEmptyDelay += Date.now() - inputQueueEmptyStart;
									inputQueueEmptyStart = null;
									if(inputQueueEmptyDelay > 1000) { // TODO: would some dynamic threshold be better?
										// TODO: consider offering suggestions on how to resolve the issue
										NNTP.log.info('Upload speed has been throttled due to delays in generating articles to submit');
										inputQueueEmptyWarned = true;
									}
								} else if(!got && !inputQueueEmptyWarned && !self.hasFinished && self.articlesRead > inputQueueEmptyArticleThresh && !inputQueueEmptyStart) {
									inputQueueEmptyStart = Date.now();
								}
							}
						}
					}),
					async.times.bind(async, server.checkConnections, function(i, cb) {
						var c = new NNTP(server);
						c.connNum = self.checkConnections.length;
						self.checkConnections[c.connNum] = c;
						if(chkOpts.group)
							c.currentGroup = chkOpts.group; // setting this before .connect causes the group to be auto-selected
						
						if(self.opts.useLazyConnect)
							self._checkLoop(c, cb)();
						else {
							Timer('check-init', function() {
								c.connect(function(err) {
									if(err && err.code == 'cancelled' && self.ended) return cb();
									self._checkLoop(c, cb)(err);
								});
							}, chkOpts.delay).onCancel = cb;
						}
					})
				], cb);
			}),
			async.times.bind(async, concurrentReloads, function(i, cb) {
				self.reloadQueue.take(function doReload(post) {
					if(!post) return cb();
					
					post.reload(function(err) {
						if(err) return cb(err);
						
						self.articlesReRead++;
						self.queue.fulfill(post, function() {
							self.reloadQueue.take(doReload);
						});
					});
				});
			})
		], this._invokeEnd.bind(this));
	},
	_checkLoop: function(c, cb) {
		var self = this;
		var doCheck = function(err) {
			if(err) {
				if(self.cancelled && err.code == 'cancelled') return;
				if(err.code == 'kill_connection') {
					self._closeConnection('check', c.connNum, function() {
						// are there any connections left? if not, this is a fatal error
						if(self._activeConnectionCount('check') == 0) {
							// TODO: consider disabling post checking
							return cb(new UploaderError('No connections available for checking. Process terminated'));
						}
						cb();
					});
					return;
				}
				return cb(err);
			}
			self.checkQueue.take(function(post) {
				if(!post) { // done, close down
					self._closeConnection('check', c.connNum, function() {
						cb();
					});
					// TODO: assumes that this is a checking connection and not a posting one
					return;
				}
				if(post.chkFailures) {
					self.checkRePending--;
					self.articlesRechecked++;
				} else
					self.checkPending--;
				self._checkPost(c, post, doCheck);
			});
		};
		return doCheck;
	},
	_checkPost: function(conn, post, cb) {
		var self = this;
		if(this.cancelled) return;
		self.checkActive++;
		conn.stat(post.messageId, function(err, info) {
			self.checkActive--;
			if(err && self.cancelled && err.code == 'cancelled') return;
			if(!err && !info) post.chkFailures++;
			(function(cb) {
				if(err || (
					!info && post.chkFailures >= self.opts.check.tries && post.postTries > self.opts.check.postRetries
				)) dumpPost(self, post, cb);
				else cb();
			})(function() {
				if(err) {
					if(err.code == 'timeout' && self.skipErrs['check-timeout']) {
						self._markPostError(post, 'Post check timed out');
					} else if(err.code == 'connect_fail' && self.skipErrs['connect-fail']) {
						if(NNTP.log)
							NNTP.log.error(err);
						var rtnErr = new Error('Internal Error');
						rtnErr.code = 'kill_connection';
						return cb(rtnErr);
					} else if(err.code == 'connection_ended' || err.code == 'not_connected') { // internal error - can't continue
						return cb(err);
					} else if(self.skipErrs['check-fail']) {
						// ignore protocol violations etc
						self._markPostError(post, 'Post check request returned error (' + err.message + ')');
					} else {
						err.skippable = true;
						return cb(err);
					}
				}
				else if(!info) {
					// missing!
					if(post.chkFailures >= self.opts.check.tries) {
						if(post.postTries <= self.opts.check.postRetries) {
							// repost article
							if(NNTP.log) NNTP.log.warn('Post check failed to find posted article ' + post.messageId + '; re-posting... (retry ' + post.postTries + '/' + self.opts.check.postRetries + ')');
							self.articlesPosted--;
							self.articlesRePosted++;
							self.bytesPosted -= post.inputLen;
							if(post.data) {
								// check queue should never wait for the post queue to clear, as it's rather pointless (doesn't save memory); also avoids deadlocking situations if both queues are full
								self.queue.add(post);
							} else {
								self.queue.reserve();
								self.reloadQueue.add(post);
							}
							
							if(post.cacheId) {
								self.checkCache.remove(post.cacheId);
								delete post.cacheId;
							}
							return cb();
						} else {
							// dumpPost() called above
							if(self.skipErrs['check-missing'] || self.skipErrs['check-fail']) {
								self._markPostError(post, 'Post check failed to find post');
								// assume success and continue
							} else {
								var errTmp = new UploaderError('Posted article ' + post.messageId + ' could not be found');
								errTmp.skippable = true;
								return cb(errTmp);
							}
						}
					} else {
						// reschedule check
						if(NNTP.log) NNTP.log.debug('Post check failed to find posted article ' + post.messageId + '; retrying after ' +(self.opts.check.recheckDelay/1000)+ ' second(s)... (attempt ' + post.chkFailures + '/' + self.opts.check.tries + ')');
						self.checkRePending++;
						// note that we do a force add (i.e. don't wait for callback), this is because we don't want to stall the check queue in the event that it grows too big (we do want to stall the post queue though). Also, this is really just putting an item back onto the queue, so it never really increases the overall size (by much)
						self.checkQueue.add(self.opts.check.recheckDelay, post);
						return cb();
					}
				} else {
					// no check errors = mark post as good
					post.successful = true;
					if(NNTP.log) NNTP.log.debug('Post check successful for article ' + post.messageId);
				}
				
				if(post.cacheId) {
					self.checkCache.remove(post.cacheId);
					delete post.cacheId;
				}
				
				// successfully checked, send to next stage
				self._postComplete(post, err, cb);
			});
		});
	},
	_cancelCheckTimers: function() {
		Timer.all().forEach(function(timer) {
			if(timer.label == 'check-init')
				timer.cancel();
		});
	},
	_postComplete: function(post, err, cb) {
		this.articlesChecked++;
		if(post.doneCb) post.doneCb(err);
		
		// if main posting routine has finished, need to check whether we're done posting/checking
		if(this.hasFinished && this.articlesRead <= this.articlesChecked) {
			// check timer could still be running if all articles errored (and hence marked as checked)
			this._cancelCheckTimers();
			
			if(NNTP.log) NNTP.log.debug('All article(s) processed');
			if(!this.checkQueue.isEmpty()) throw new Error('Checking done, but check queue not empty');
			if(this.reloadQueue.queue.length) throw new Error('Checking done, but reload queue not empty');
			if(this.opts.check.postRetries && this.numCheckConns) {
				// if both check and post queues are empty, then we're done
				if(this.queue.queue.length) throw new Error('Checking done, but post queue not empty');
				this.queue.finished();
			}
			if(!this.queue.hasFinished) throw new Error('Checking done, but post queue not finished');
			this.checkQueue.finished();
			this.reloadQueue.finished();
			
			this.ended = true; // need to mark this before closing all connections, as the closing may invoke 'cancelled' errors
			
			// close down all connections
			var closeConn = function(type, conn, cb) {
				if(conn) this._closeConnection(type, conn.connNum, cb);
				else cb();
			};
			async.parallel([
				async.each.bind(null, this.postConnections, closeConn.bind(this, 'post')),
				async.each.bind(null, this.checkConnections, closeConn.bind(this, 'check'))
			], cb);
		} else cb();
	},
	_markPostError: function(post, msg) {
		if(NNTP.log) {
			if(post.messageId)
				NNTP.log.error(msg + ' for article ' + post.messageId + '; continuing regardless');
			else
				NNTP.log.error(msg + '; article skipped');
		}
		if(!post.errorCount) {
			this.articleErrors++;
			if(this.opts.maxPostErrors && this.articleErrors > this.opts.maxPostErrors)
				this._invokeEnd(new UploaderError('Maximum error count reached, upload process aborted'));
		}
		post.errorCount++;
	},
	_invokeEnd: function(err) {
		if(!this.doneCb) return;
		var f = this.doneCb;
		this.doneCb = null;
		if(err)
			this._cancel(function() {
				f(err);
			});
		else
			f();
	},
	_closeConnection: function(type, id, cb) {
		var ar = this[type + 'Connections'];
		if(!ar[id]) return cb();
		ar[id].end(cb ? process.nextTick.bind(process, cb) : null);
		if(type == 'post') {
			this.totalUploadData += ar[id].reqBytesSent;
		}
		ar[id] = null;
	},
	_activeConnectionCount: function(type) {
		var ar = this[type + 'Connections'];
		var c = 0;
		ar.forEach(function(conn) {
			if(conn) c++;
		});
		return c;
	},
	cancel: function(reason) {
		if(this.ended) return;
		this.cancelled = true;
		this._invokeEnd(new UploaderError(reason || 'Process aborted by request'));
	},
	_cancel: function(cb) {
		if(!this.ended) {
			// TODO: mark unchecked articles as complete so that it's written to the NZB
			this.cancelled = true;
			
			this._cancelCheckTimers();
			this.checkQueue.flushPending(true);
			this.throttlers.forEach(function(throttler) {
				throttler.cancel();
			});
			var closeConn = function(conn, cb) {
				if(conn) conn.close(cb);
				else cb();
			};
			async.parallel([
				async.each.bind(async, this.postConnections, closeConn),
				async.each.bind(async, this.checkConnections, closeConn)
			], cb || function(){});
		} else
			if(cb) cb();
		
	},
	finished: function() {
		this.hasFinished = true;
		// if we're doing post retries on check failures, we can't end the post queue yet, as retries may occur
		if(!this.opts.check.postRetries || !this.numCheckConns)
			this.queue.finished();
	},
	
	currentNetworkUploadBytes: function() {
		var bytes = this.totalUploadData;
		this.postConnections.forEach(function(c) {
			if(c) bytes += c.reqBytesSent;
		});
		return bytes;
	},
	currentNetworkUploadTime: function() {
		return Math.max(this.rawSpeedTime.value(), 1);
	}
};

module.exports = Uploader;
Uploader.setLogger = function(log) {
	NNTP.log = log;
};
