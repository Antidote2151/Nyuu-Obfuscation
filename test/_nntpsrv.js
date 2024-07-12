"use strict";

// simple dummy NNTP server
function NNTPServer(opts) {
	// set denyPost
	// set auth user/pass
	opts = opts || {};
	this.opts = opts;
	
	this.posts = {};
	this.postIdMap = {};
	this.groups = ['limbs', 'rifles', 'bloodbath']; // list of available groups
	this.connectHook = function(){};
	
	var cOpts = {};
	if(this.opts.ssl) {
		var readFile = function(f) {
			return require('fs').readFileSync(__dirname + require('path').sep + f)
		};
		cOpts = {
			key: readFile('_ssl.key'),
			cert: readFile('_ssl.crt'),
		};
	}
	
	this.server = require(this.opts.ssl ? 'tls' : 'net').createServer(cOpts, function(c) {
		var conn = new NNTPConnection(this.opts, this, c);
		this.connectHook(conn);
		conn._respond(opts.denyPost ? 201 : 200, 'host test server');
	}.bind(this));
}
NNTPServer.prototype = {
	onPostHook: null,
	storePostData: true,
	
	groupNumPosts: function(grp) {
		if(this.groups.indexOf(grp) < 0)
			return false;
		
		if(grp in this.posts) {
			return this.posts[grp].length;
		} else {
			return 0;
		}
	},
	postById: function(id, grp) {
		if(typeof id != 'number') {
			return this.postIdMap[id];
		}
		if(!(grp in this.posts)) return false;
		return this.posts[grp][id];
	},
	addPost: function(headers, msg) {
		if(!headers.newsgroups) throw new Error('Post missing groups spec');
		var messageId = headers['message-id'];
		if(messageId) {
			if(messageId.substring(0, 1) != '<' || messageId.slice(-1) != '>')
				throw new Error('Received malformed Message-ID: ' + messageId);
			messageId = messageId.substring(1, messageId.length-1);
		}
		if(('message-id' in headers) && (messageId in this.postIdMap))
			return false;
		
		if(!messageId) {
			do {
				// 8 random a-z letters
				messageId = 'xxxxxxxx'.replace(/x/g, function() {
					return String.fromCharCode(97 + Math.random()*26);
				});
			} while(messageId in this.postIdMap);
		}
		
		// prepare post
		var post = {};
		for(var k in headers)
			post[k] = headers[k];
		post.messageId = messageId;
		if(this.storePostData) post._msg = msg;
		post._groupNum = {};
		
		var dropPost = false; // drop the post to simulate it going missing?
		if(this.onPostHook) {
			var f = this.onPostHook;
			this.onPostHook = null;
			dropPost = f(post, headers, msg);
		}
		
		if(!dropPost && post.messageId)
			if(!this.insertPost(post))
				return false;
		return post.messageId;
	},
	insertPost: function(post) {
		// add post to specified groups
		var groups = post.newsgroups.split(',');
		for(var i in groups) {
			var grp = groups[i].trim();
			var grpCount = this.groupNumPosts(grp);
			if(grpCount === false)
				return false;
			post._groupNum[grp] = grpCount;
			if(!(grp in this.posts))
				this.posts[grp] = [];
			this.posts[grp].push(post);
		}
		
		// add thing in ID mapping
		this.postIdMap[post.messageId] = post;
		return true;
	},
	listen: function(port, cb) {
		if(typeof post == 'string') // unix socket
			this.server.listen(port, cb);
		else
			this.server.listen(port, '127.0.0.1', cb);
	},
	address: function() {
		return this.server.address();
	},
	close: function(cb) {
		this.server.close(cb);
	},
	onRequest: function(f) {
		this.opts.requestHook = f;
	},
	onConnect: function(f) {
		this.connectHook = f;
	}
};

function NNTPConnection(opts, server, conn) {
	this.dataQueue = '';
	this.opts = opts;
	this.server = server;
	this.conn = conn;
	
	conn.on('data', this.onData.bind(this));
	conn.on('error', function(err) {
		console.log('Test server error:', err);
	});
}
NNTPConnection.prototype = {
	authReq: false,
	authed: false,
	group: '',
	postMode: false,
	
	onData: function(chunk) {
		// grab incomming lines
		this.dataQueue += chunk.toString('binary');
		if(this.postMode) {
			return this.onPostData();
		}
		var p;
		while((p = this.dataQueue.indexOf('\r\n')) >= 0) {
			var line = this.dataQueue.substring(0, p);
			this.dataQueue = this.dataQueue.substring(p+2);
			
			var m = line.match(/^([A-Za-z]+) ?/);
			if(!m) throw new Error('Unexpected message format: ' + line);
			this.onRequest(m[1].toUpperCase(), line.substring(m[0].length));
			
			if(this.postMode) {
				return this.onPostData();
			}
		}
	},
	onPostData: function() {
		var p = this.dataQueue.indexOf('\r\n.\r\n');
		if(p >= 0) {
			// post received
			var messageId;
			if(messageId = this.addPost(this.dataQueue.substring(0, p))) {
				this._respond(240, '<' + messageId + '> Article received ok');
			} else {
				this._respond(441, ''); // TODO: fix 
			}
			this.dataQueue = this.dataQueue.substring(p+5);
			this.postMode = false;
			return this.onData('');
		}
	},
	onRequest: function(req, data) {
		if(this.opts.requestHook) {
			if(this.opts.requestHook.call(this, req, data))
				return;
		}
		// TODO: handle special responses (i.e. timeout, junk, disconnect)
		if(this.authReq && req != 'AUTHINFO' && !this.authed) {
			this._respond(480, 'Authentication required');
			return;
		}
		switch(req) {
			case 'AUTHINFO':
				var m;
				if(m = data.match(/^(USER|PASS) (.*)$/i)) {
					// for now, accept any user/pass
					// TODO: proper checking of USER/PASS ordering etc
					if(m[1].toUpperCase() == 'USER') {
						this._respond(381, 'Give AUTHINFO PASS command');
					} else {
						this._respond(281, 'User logged in');
						this.authed = true;
					}
				} else {
					throw new Error('Command not supported');
				}
			break;
			case 'DATE':
				this._respond(111, '20101122013344');
			break;
			case 'STAT':
				var msgId, post;
				if(msgId = data.match(/^<(.*)>$/)) {
					post = this.server.postById(msgId[1]);
				} else {
					if(!this.group) {
						this._respond(412, 'No newsgroup has been selected');
						break;
					}
					post = this.server.postById(data|0, this.group);
				}
				if(post)
					this._respond(223, (post._groupNum[this.group] || 0) + ' <' + post.messageId + '> article retrieved - request text separately');
				else
					this._respond(423, ''); // TODO:
			break;
			case 'GROUP':
				var np = this.server.groupNumPosts(data);
				if(np !== false) {
					// response not entirely accurate, but good enough for our purposes
					this._respond(211, np + ' 1 ' + np + ' ' + data);
					this.group = data;
				} else {
					this._respond(411, 'No such newsgroup');
				}
			break;
			case 'POST':
				if(data) throw new Error('Unexpected POST params');
				this.postMode = true;
				this._respond(340, 'Send article');
			break;
			case 'QUIT':
				this._respond(205, 'bye');
				this.conn.end();
			break;
			default:
				throw new Error('Command not supported');
		}
	},
	addPost: function(data) {
		// split headers
		var sData = data.toString();
		var p = data.indexOf('\r\n\r\n');
		if(p < 0) return false;
		sData = sData.substring(0, p+2);
		data = data.slice(Buffer.byteLength(sData) + 2);
		
		// parse headers
		var h = {};
		var re = /([a-zA-Z0-9\-_]+) *\: *([^\r\n]*)\r\n/;
		sData = sData.replace(new RegExp(re.source, 'g'), function(m) {
			m = m.match(re);
			h[m[1].toLowerCase()] = m[2];
			return '';
		});
		if(sData.length) throw new Error('Unexpected header data received!');
		
		return this.server.addPost(h, data);
	},
	_respond: function(code, msg) {
		this.conn.write(code + ' ' + msg + '\r\n', 'binary');
		// slower, but may pick up more bugs?
		/* this.conn.write(code + ' ');
		this.conn.write(msg, 'binary');
		this.conn.write('\r\n'); */
	}
};

module.exports = NNTPServer;
