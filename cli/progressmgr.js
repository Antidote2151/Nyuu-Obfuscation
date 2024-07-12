"use strict";

var cliUtil = require('./util');
var toPercent = function(n) {
	return (Math.round(n*10000)/100).toFixed(2) + '%';
};

var procman = require('./procman');
var timerMgr = require('../lib/timeoutwrap');

var writeState = function(uploader, startTime, conn, debug) {
	var now = Date.now();
	
	// TODO: JSON output etc
	conn.write([
		'Time: ' + (new Date(now)),
		'Start time: ' + (new Date(startTime)),
		''
	].concat(module.exports.progressReport(now)).concat([
		'',
		'Post queue size: ' + uploader.queue.queue.length + ' (' + toPercent(Math.min(uploader.queue.queue.length/uploader.queue.size, 1)) + ' full)' + (uploader.queue.hasFinished ? ' - finished' : ''),
		'Check queue size: ' + uploader.checkQueue.queue.length + ' + ' + uploader.checkQueue.pendingAdds + ' delayed' + ' (' + toPercent(Math.min((uploader.checkQueue.queue.length+uploader.checkQueue.pendingAdds)/uploader.checkQueue.size, 1)) + ' full)' + (uploader.checkQueue.hasFinished ? ' - finished' : ''),
		'Re-read queue size: ' + uploader.reloadQueue.queue.length,
		'',
		'Article activity: ' + uploader.postActive + ' posting, ' + uploader.checkActive + ' checking',
		'Articles awaiting check: ' + uploader.checkPending + ' + ' + uploader.checkRePending + ' awaiting re-check',
		'', ''
	]).join('\r\n'));
	
	var dumpConnections = function(conns) {
		var i = 0;
		conns.forEach(function(c) {
			conn.write('Connection #' + (++i) + '\r\n');
			if(c) {
				var host;
				if(c.opts.connect.path)
					host = 'unix:' + c.opts.connect.path;
				else
					host = c.opts.connect.host + ':' + c.opts.connect.port;
				var timeStats = c.timeStats(now);
				conn.write([
					'  Host: ' + host,
					'  State: ' + c.getCurrentActivity() + (c.lastActivity ? ' for ' + ((now - c.lastActivity)/1000) + 's' : ''),
					'  Transfer: ' + cliUtil.friendlySize(c.bytesRecv) + ' down / ' + cliUtil.friendlySize(c.bytesSent) + ' up',
					'  Requests: ' + c.numRequestsDetail(),
					'  Connects: ' + c.numConnects,
					'  Time Idle: ' + (timeStats.idle / 1000) + 's (' + toPercent(timeStats.connected ?timeStats.idle/timeStats.connected : 0) + ')',
					'  Errors: ' + c.numErrorsDetail(),
					'', ''
				].join('\r\n'));
			} else {
				conn.write('  State: finished\r\n\r\n')
			}
		});
	};
	if(uploader.postConnections.length) {
		conn.write('===== Post Connections\' Status =====\r\n');
		dumpConnections(uploader.postConnections);
	}
	if(uploader.checkConnections.length) {
		conn.write('===== Check Connections\' Status =====\r\n');
		dumpConnections(uploader.checkConnections);
	}
	
	if(debug) {
		conn.write('===== Active Timers =====\r\n');
		var timers = timerMgr.all();
		if(timers.length) {
			conn.write(cliUtil.repeatChar(' ', 20) + '| Remaining / Delay (ms)\r\n');
			timers.forEach(function(timer) {
				conn.write(cliUtil.rpad(timer.label, 20, ' ') + '| ' + cliUtil.lpad(''+(now-timer.start), 9, ' ') + '  ' + cliUtil.lpad(''+timer.delay, 9, ' ') + '\r\n');
			});
			conn.write('\r\n');
		} else {
			conn.write('[none]\r\n\r\n');
		}
		
		// TODO: consider listing managed processes, opened NZB files, buffer pool state, file reader state
		
		conn.write('===== Other =====\r\n');
		conn.write('Check cache size: ' + uploader.checkCache.cacheSize + ' (' + toPercent(Math.min(uploader.checkCache.cacheSize/uploader.checkCache.size, 1)) + ' full)\r\n');
		var handles = cliUtil.activeHandleCounts();
		if(handles)
			conn.write('Active Handles: ' + cliUtil.activeHandlesStr(handles[0]) + '\r\n');
		conn.write('\r\n');
	}
	
	conn.write('===== Process Resource Usage =====\r\n');
	var resourceUsage = null;
	if(process.resourceUsage)
		resourceUsage = process.resourceUsage();
	if(process.cpuUsage) {
		var usage = resourceUsage ?
			{user: resourceUsage.userCPUTime, system: resourceUsage.systemCPUTime} :
			process.cpuUsage();
		var processTime100us = Math.max((now - startTime) / 10, 1);
		var percUser = Math.round(usage.user / processTime100us) / 100;
		var percSys = Math.round(usage.system / processTime100us) / 100;
		usage.user = Math.round(usage.user/10000) / 100;
		usage.system = Math.round(usage.system/10000) / 100;
		conn.write('CPU usage: ' + usage.user + 's user (' + percUser + '%) + ' + usage.system + 's system (' + percSys + '%)\r\n');
	}
	var memUsage = process.memoryUsage();
	var muStr = [];
	for(var k in memUsage) {
		muStr.push(cliUtil.friendlySize(memUsage[k]) + ' ' + k);
	}
	conn.write('Current memory usage: ' + muStr.join(', ') + '\r\n');
	
	if(resourceUsage) {
		conn.write('Peak memory RSS: ' + cliUtil.friendlySize(resourceUsage.maxRSS * 1024) + '\r\n');
		conn.write('Filesystem block ops: ' + resourceUsage.fsRead + ' read + ' + resourceUsage.fsWrite + ' write\r\n');
	}
};

var progressReport = function(uploader, totalPieces, totalSize, startTime, now) {
	now = now || Date.now();
	return [
		'Total articles: ' + totalPieces + ' (' + cliUtil.friendlySize(totalSize) + ')',
		'Articles read: ' + uploader.articlesRead + ' (' + toPercent(uploader.articlesRead/totalPieces) + ')' + (uploader.articlesReRead ? ' (+' + uploader.articlesReRead + ' re-read)':''),
		'Articles posted: ' + uploader.articlesPosted + ' (' + toPercent(uploader.articlesPosted/totalPieces) + ')' + (uploader.articlesRePosted ? ' (+' + uploader.articlesRePosted + ' re-posted)':''),
		uploader.numCheckConns ? 'Articles checked: ' + uploader.articlesChecked + ' (' + toPercent(uploader.articlesChecked/totalPieces) + ')' + (uploader.articlesRechecked ? ' (+'+uploader.articlesRechecked+' re-checked)':'') : false,
		'Errors skipped: ' + module.exports.errorCount + ' across ' + uploader.articleErrors + ' article(s)',
		'Upload Rate (network|real): ' + cliUtil.friendlySize(uploader.currentNetworkUploadBytes()/uploader.currentNetworkUploadTime()*1000) + '/s | ' + cliUtil.friendlySize(uploader.bytesPosted/(now-startTime)*1000) + '/s',
	].filter(function(e){return e;});
};

module.exports = {
	getProcessIndicator: null,
	progressReport: null,
	errorCount: 0,
	start: function(config, uploader, logger, totalPieces, totalSize, startTime, articleSize) {
		module.exports.progressReport = progressReport.bind(null, uploader, totalPieces, totalSize, startTime);
		config.forEach(function(prg) {
			switch(prg.type) {
				case 'log':
					var logInterval = setInterval(function() {
						logger.info('Article posting progress: ' + uploader.articlesRead + ' read, ' + uploader.articlesPosted + ' posted' + (uploader.numCheckConns ? ', ' + uploader.articlesChecked + ' checked' : ''));
					}, prg.interval);
					process.on('finished', function() {
						clearInterval(logInterval);
					});
				break;
				case 'stderrx':
				case 'stdoutx':
				case 'stderr':
				case 'stdout':
					if(module.exports.getProcessIndicator) break; // no need to double output =P
					var mainPostingDone = false;
					var ProgressRecorder = require('../cli/progrec');
					var byteSamples = new ProgressRecorder(180);
					var progressSamples = new ProgressRecorder(180);
					byteSamples.add(0);
					progressSamples.add(0);
					module.exports.getProcessIndicator = function() {
						var chkPerc = uploader.articlesChecked / totalPieces,
							pstPerc = uploader.articlesPosted / totalPieces,
							totPerc = toPercent((chkPerc+pstPerc)/2);
						
						// calculate speed over last 4s
						var speed = uploader.bytesPosted; // for first sample, just use current overall progress
						var completed = (uploader.articlesChecked + uploader.articlesPosted)/2;
						var advancement = completed;
						if(byteSamples.count() >= 2) {
							speed = byteSamples.average(4, 4*articleSize);
							advancement = progressSamples.average(10, 20);
						}
						
						// TODO: consider adding check delay somewhere?
						var eta = (totalPieces - completed) / advancement;
						eta = Math.round(eta)*1000;
						if(!isNaN(eta) && isFinite(eta) && eta > 0)
							eta = cliUtil.friendlyTime(eta, true);
						else
							eta = '-';
						
						if(prg.type == 'stderr' || prg.type == 'stdout') {
							var LINE_WIDTH = 35;
							var barSize = Math.floor(chkPerc*LINE_WIDTH);
							var line = cliUtil.repeatChar('=', barSize) + cliUtil.repeatChar('-', Math.floor(pstPerc * LINE_WIDTH) - barSize);
							var suffix = '';
							if(mainPostingDone) {
								if(uploader.articlesPosted < totalPieces)
									suffix = ' reposting ' + (totalPieces - uploader.articlesPosted) + ' article(s)';
								else if(uploader.checkPending || uploader.checkRePending)
									suffix = ' awaiting check on ' + (uploader.checkPending + uploader.checkRePending) + ' article(s)';
							} else if(uploader.bytesPosted)
								suffix = ' ' + cliUtil.friendlySize(speed) + '/s, ETA ' + eta;
							return '\x1b[0G\x1B[0K ' + cliUtil.lpad(totPerc, 6) + '  [' + cliUtil.rpad(line, LINE_WIDTH) + ']' + suffix;
						} else {
							// extended display
							var ret = '';
							if(mainPostingDone) {
								ret = 'Checked: ' + uploader.articlesChecked + ' ('+toPercent(chkPerc) + ')';
								if(uploader.checkPending || uploader.checkRePending) {
									if(uploader.checkPending)
										ret += ', ' + uploader.checkPending + (uploader.checkRePending ? '+'+uploader.checkRePending:'') + ' pending';
									else
										ret += ', ' + uploader.checkRePending + ' pending re-check';
								}
								if(uploader.articlesPosted < totalPieces)
									ret += ', ' + (totalPieces - uploader.articlesPosted) + ' to re-post';
							} else {
								var posted = '' + uploader.articlesChecked;
								if(uploader.articlesChecked != uploader.articlesPosted)
									posted += '+' + (uploader.articlesPosted - uploader.articlesChecked);
								ret = 'Posted: ' + posted + '/' + totalPieces + ' (' + totPerc + ') @ ' + cliUtil.friendlySize(speed) + '/s (network: ' + cliUtil.friendlySize(uploader.currentNetworkUploadBytes()/uploader.currentNetworkUploadTime()*1000) + '/s) ETA ' + eta;
								if(ret.length > 80)
									// if too long, strip the network post speed
									ret = ret.replace(/ \(network\: [0-9.]+ [A-Zi]+\/s\)/, ',');
							}
							return '\x1b[0G\x1B[0K' + ret;
						}
					};
					var prgTarget = prg.type.substring(0, 6);
					var seInterval = setInterval(function() {
						byteSamples.add(uploader.bytesPosted);
						progressSamples.add((uploader.articlesChecked + uploader.articlesPosted)/2);
						if(uploader.articlesPosted == totalPieces && uploader.numCheckConns)
							mainPostingDone = true; // we've moved into a 'primarily checking' phase
						process[prgTarget].write(module.exports.getProcessIndicator());
					}, 1000);
					process.on('finished', function() {
						clearInterval(seInterval);
						// force final progress to be written; this will usually be cleared and hence be unnecessary, but can be useful if someone's parsing the output
						process[prgTarget].write(module.exports.getProcessIndicator());
					});
				break;
				case 'tcp':
				case 'http':
					module.exports.startSrv(prg, uploader, logger, startTime);
				break;
			}
		});
	},
	startSrv: function(config, uploader, logger, startTime) {
		var server;
		if(config.type == 'http') {
			var url = require('url');
			server = require('http').createServer(function(req, resp) {
				var path = url.parse(req.url).pathname.replace(/\/$/, '');
				var m;
				if(m = path.match(/^\/(post|check)queue\/?$/)) {
					// dump post/check queue
					var isCheckQueue = (m[1] == 'check');
					resp.writeHead(200, {
						'Content-Type': 'text/plain'
					});
					var dumpPost = function(post) {
						var subj = post.getHeader('subject');
						if(subj === null) subj = '[unknown, post evicted from cache]';
						resp.write([
							'Message-ID: ' + post.messageId,
							'Subject: ' + subj,
							'Body length: ' + post.postLen,
							'Post attempts: ' + post.postTries,
							''
						].join('\r\n'));
						if(isCheckQueue)
							resp.write('Check attempts: ' + post.chkFailures + '\r\n');
					};
					uploader[isCheckQueue ? 'checkQueue' : 'queue'].queue.forEach(function(post) {
						dumpPost(post);
						resp.write('\r\n');
					});
					if(isCheckQueue && uploader.checkQueue.pendingAdds) {
						resp.write('\r\n===== Delayed checks =====\r\n');
						for(var k in uploader.checkQueue.queuePending) {
							dumpPost(uploader.checkQueue.queuePending[k].data);
							resp.write('\r\n');
						}
					}
					resp.end();
				} else if(m = path.match(/^\/(check)queue\/([^/]+)\/?$/)) {
					// search queue for target post
					var q = uploader.checkQueue.queue;
					var post;
					for(var k in q) {
						if(q[k].messageId == m[2]) {
							post = q[k];
							break;
						}
					}
					if(!post) {
						// check deferred queue too
						var q = uploader.checkQueue.queuePending;
						for(var k in q) {
							if(q[k].data.messageId == m[2]) {
								post = q[k].data;
								break;
							}
						}
					}
					if(post) {
						if(post.data) {
							// dump post from check queue
							resp.writeHead(200, {
								'Content-Type': 'message/rfc977' // our made up MIME type; follows similarly to SMTP mail
							});
							resp.write(post.data);
						} else {
							resp.writeHead(500, {
								'Content-Type': 'text/plain'
							});
							resp.write('Specified post exists, but cannot be retrieved as it has been evicted from cache');
						}
					} else {
						resp.writeHead(404, {
							'Content-Type': 'text/plain'
						});
						resp.write('Specified post not found in queue');
					}
					resp.end();
				} else if(!path || path == '/' || path == '/debug') {
					// dump overall status
					resp.writeHead(200, {
						'Content-Type': 'text/plain'
					});
					writeState(uploader, startTime, resp, path == '/debug');
					resp.end();
				} else {
					resp.writeHead(404, {
						'Content-Type': 'text/plain'
					});
					resp.end('Invalid URL');
				}
				req.socket.unref();
			});
		} else {
			server = require('net').createServer(function(conn) {
				writeState(uploader, startTime, conn);
				conn.end();
				conn.unref();
			});
		}
		server.on('error', function(err) {
			logger.warn('StatusServer ' + err.toString());
		});
		server.once('listening', process.on.bind(process, 'finished', function() {
			server.close();
		}));
		if(config.socket) {
			server.listen(config.socket, function() {
				logger.info('Status ' + config.type.toUpperCase() + ' server listening at ' + config.socket);
			});
		} else {
			server.listen(config.port, config.host, function() {
				var addr = server.address();
				if(addr.family == 'IPv6')
					addr = '[' + addr.address + ']:' + addr.port;
				else
					addr = addr.address + ':' + addr.port;
				logger.info('Status ' + config.type.toUpperCase() + ' server listening on ' + addr);
			});
		}
	}
};
