/*jslint node: true, vars: true, nomen: true, esversion: 6 */
'use strict';

const Xpl = require("xpl-api");
const commander = require('commander');
const os = require('os');
const fs = require('fs');
const debug = require('debug')('xpl-freeboxos:cli');
const async = require('async');
const Freebox = require('node-freeboxos');

const version = require("./package.json").version;

commander.version(version);
commander.option("-a, --deviceAliases <aliases>", "Devices aliases");
commander.option("-j, --jsonPath <path>", "token JSON path");

Xpl.fillCommander(commander);

const app = {
	app_id: "xpl-freebox",
	app_name: "XPL bridge for Freebox",
	app_version: version,
	device_name: "NodeJs/XPL"
};

commander.command('run').description("Start pooling freebox").action(
	() => {
		console.log("Start");

		commander.deviceAliases = Xpl.loadDeviceAliases(commander.deviceAliases);

		const config = {app: app};

		if (commander.jsonPath) {
			try {
				fs.accessSync(commander.jsonPath);

				config.jsonPath = commander.jsonPath;
			} catch (x) {
			}
		}

		var freebox = new Freebox(config);

		freebox.waitApplicationGranted(1000 * 60 * 2).then((result) => {
			debug("Granted result=", result);

			if (!commander.xplSource) {
				var hostName = os.hostname();
				if (hostName.indexOf('.') > 0) {
					hostName = hostName.substring(0, hostName.indexOf('.'));
				}

				commander.xplSource = "freeboxos." + hostName;
			}

			var xpl = new Xpl(commander);

			xpl.on("error", (error) => {
				console.log("XPL error", error);
			});

			poolFreebox(freebox, xpl);
		});

	});
commander.parse(process.argv);

var currentHosts = {};

/**
 *
 * @param {Freebox} freebox
 * @param {Xpl} xpl
 */
function poolFreebox(freebox, xpl) {
	debug("Pool freebox");

	freebox.lanBrowser().then((result) => {
		result = result.filter((v) => v.primary_name);
		var filtredResult = result.reduce((prev, v) => {
			var lastActivity = v.last_activity ? (new Date(v.last_activity * 1000)) : undefined;

			prev[v.primary_name] = {enabled: v.reachable, lastActivity: lastActivity};
			return prev;
		}, {});

		var oldHosts = currentHosts;
		currentHosts = filtredResult;
		var messages = [];

		for (var k in filtredResult) {
			var cur = filtredResult[k];
			var old = oldHosts[k];
			var hostName = 'host/' + k.replace(/\//g, '_');
			if (!old) {
				// Un nouveau !!!

				messages.push({
					device: hostName + '/reachable',
					current: cur.enabled
				});
				if (cur.lastActivity) {
					messages.push({
						device: hostName + '/lastActivity',
						current: cur.lastActivity.toISOString()
					});
				}
				continue;
			}

			delete oldHosts[k];

			if (cur.enabled === old.enabled && cur.lastActivity === old.lastActivity) {
				continue;
			}

			if (cur.enabled !== old.enabled) {
				messages.push({
					device: hostName + '/reachable',
					current: cur.enabled
				});
			}
			if (cur.lastActivity !== old.lastActivity && cur.lastActivity > 0) {
				messages.push({
					device: hostName + '/lastActivity',
					current: cur.lastActivity.toISOString()
				});
			}
		}

		for (var k in oldHosts) {
			var old = oldHosts[k];
			var hostName = 'host/' + k.replace(/\//g, '_');

			messages.push({
				device: hostName + '/reachable',
				current: false,
				lost: true
			});
		}

		console.log("Send ",messages);

		async.forEachSeries(messages, (message, callback) => {
			xpl.sendXplStat(message, "hosts.basic", callback);

		}, (error) => {
			if (error) {
				console.error(error);
			}
		});

		console.log("f=", filtredResult);

	}).catch((error) => {
		console.error(error);
	})
}

if (commander.headDump) {
	var heapdump = require("heapdump");
	console.log("***** HEAPDUMP enabled **************");
}
