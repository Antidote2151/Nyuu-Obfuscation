"use strict";

// for handling object keys case-insensitively
exports.getNCaseKey = function(obj, key) {
	key = exports.getNCaseKeyIndex(obj, key);
	if(key) return obj[key];
};
exports.getNCaseKeyIndex = function(obj, key) {
	key = key.toLowerCase();
	for(var k in obj) {
		if(k.toLowerCase() === key)
			return k;
	}
};
exports.setNCaseKey = function(obj, key, val) {
	key = key.toLowerCase();
	for(var k in obj) {
		if(k.toLowerCase() === key)
			obj[k] = val;
	}
};

exports.extend = Object.assign || function(to) {
	for(var i=1; i<arguments.length; i++) {
		var o = arguments[i];
		for(var k in o)
			to[k] = o[k];
	}
	return to;
};

var isObject = function(v) {
	return typeof v == 'object' && !Array.isArray(v) && v !== null;
};
exports.deepMerge = function(dest, src) {
	for(var k in src) {
		if(isObject(src[k])) {
			if(!(k in dest) || !isObject(dest[k]))
				dest[k] = {};
			exports.deepMerge(dest[k], src[k]);
		} else {
			dest[k] = src[k];
		}
	}
};

exports.optSel = function(a, b) {
	return (a !== undefined && a !== null) ? a : b;
};

var fs, async, path;
exports.dirStatList = function(dir, useLstat, cb) {
	fs = fs || require('fs');
	async = async || require('async');
	path = path || require('path');
	
	var stat = useLstat ? fs.lstat : fs.stat;
	
	fs.readdir(dir, function(err, files) {
		if(err) return cb(err);
		async.mapSeries(files, function(filename, cb) {
			var file = path.join(dir, filename);
			stat(file, function(err, stats) {
				stats.file = file;
				cb(err, stats);
			});
		}, cb);
	});
};
exports.recurseDir = function(dir, skipSymlinks, itemCb, cb) {
	async = async || require('async');
	exports.dirStatList(dir, skipSymlinks, function(err, list) {
		if(err) return cb(err);
		async.eachSeries(list, function(stats, cb) {
			if(stats.isDirectory()) {
				exports.recurseDir(stats.file, skipSymlinks, itemCb, cb);
			} else if(stats.isFile()) {
				itemCb(stats, cb);
			} else if(stats.isSymbolicLink()) {
				cb();
			} else {
				cb(new Error('Unknown file type for file: ' + stats.file));
			}
		}, cb);
	});
};

