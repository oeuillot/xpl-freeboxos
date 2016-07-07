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

			setInterval(() => poolFreebox(freebox, xpl), 1000 * 10);
		});


		p.catch((error) => {
			console.error(error);
		});

	});
commander.parse(process.argv);

/**
 *
 * @param {Freebox} freebox
 * @param {Xpl} xpl
 */
function poolFreebox(freebox, xpl) {
	freebox.lanBrowser().then((result) => {
		console.log(result);

	}).catch((error) => {
		console.error(error);
	})
}

if (commander.headDump) {
	var heapdump = require("heapdump");
	console.log("***** HEAPDUMP enabled **************");
}
