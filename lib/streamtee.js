"use strict";

var async = require('async');

function BufferedReadTee(input, outputs) {
	this.input = input;
	this.outputs = outputs;
}
BufferedReadTee.prototype = {
	read: function(size, cb) {
		var self = this;
		this.input.read(size, function(err, buffer) {
			if(err) return cb(err);
			// copy to outputs
			async.each(self.outputs, function(out, cb) {
				out.write(buffer, cb);
			}, function(err) {
				// TODO: improve error handling
				cb(err, buffer);
			});
		});
	},
	close: function(cb) {
		this.input.close(); // TODO: support callback here
		async.each(this.outputs, function(o, cb) {
			o.end(cb);
		}, cb||function(){});
	}
};

module.exports = BufferedReadTee;
