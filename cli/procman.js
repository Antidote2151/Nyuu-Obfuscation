"use strict";

var spawn = require('child_process').spawn;

function ProcessManager() {
	this.procs = {};
}

ProcessManager.prototype = {
	running: 0,
	_onEndHook: null,
	start: function(cmd, opts) {
		var proc;
		if(process.platform === 'win32') {
			opts.windowsVerbatimArguments = true;
			opts.windowsHide = true;
			proc = spawn(process.env.comspec || 'cmd.exe', ['/s', '/c', '"' + cmd + '"'], opts);
		} else {
			proc = spawn('/bin/sh', ['-c', cmd], opts);
		}
		this.procs[proc.pid] = proc;
		this.running++;
		
		var onExit = this._onExit.bind(this, proc.pid);
		proc.once('exit', onExit);
		proc.once('error', onExit);
		return proc;
	},
	
	_onExit: function(pid, codeOrErr) {
		if(!(pid in this.procs)) return; // according to NodeJS docs, 'exit' and 'error' may both be called
		delete this.procs[pid];
		this.running--;
		if(this.running < 1 && this._onEndHook) {
			this._onEndHook();
			this._onEndHook = null;
		}
	},
	
	closeAll: function() {
		for(var pid in this.procs) {
			var proc = this.procs[pid];
			for(var fid in proc.stdio)
				if(proc.stdio[fid])
					proc.stdio[fid].destroy();
		}
	},
	killAll: function(sig) {
		for(var pid in this.procs)
			this.procs[pid].kill(sig);
	},
	
	// Limitation: can only assign one hook!
	onEnd: function(f) {
		this._onEndHook = f;
	}
};

module.exports = ProcessManager;
