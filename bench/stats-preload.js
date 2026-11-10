"use strict";
// Preload (node -r ./bench/stats-preload.js bin/nyuu.js ...) printing CPU usage per thread and
// main event loop utilisation to stderr at exit. Workers inherit --require, so each thread reports itself.
const { isMainThread, threadId } = require('worker_threads');
const { performance } = require('perf_hooks');
const fs = require('fs');

const t0 = process.hrtime.bigint();
const cpu0 = process.threadCpuUsage();
const elu0 = performance.eventLoopUtilization();

process.on('exit', () => {
	const wall = Number(process.hrtime.bigint() - t0) / 1e3; // µs
	const c = process.threadCpuUsage(cpu0);
	const elu = performance.eventLoopUtilization(elu0).utilization;
	const pct = v => (v / wall * 100).toFixed(1) + '%';
	let line = `[stats] ${isMainThread ? 'main' : 'worker#' + threadId}: cpu ${pct(c.user + c.system)} (usr ${pct(c.user)} sys ${pct(c.system)}) elu ${(elu * 100).toFixed(1)}% wall ${(wall / 1e6).toFixed(2)}s`;
	if (isMainThread) {
		const p = process.cpuUsage();
		line += ` | process total cpu ${pct(p.user + p.system)}`;
	}
	fs.writeSync(2, line + '\n');
});
