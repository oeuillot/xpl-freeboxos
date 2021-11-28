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

const NO_XPL = process.env.NO_XPL;

const LAST_ACTIVITY_INTERVAL_MS = 1000 * 60;

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

const options = commander.opts();

commander.command('run').description("Start pooling freebox").action(
    () => {
        console.log("Start");

        options.deviceAliases = Xpl.loadDeviceAliases(options.deviceAliases);

        const config = {app: app};

        if (options.jsonPath) {
            try {
                fs.accessSync(options.jsonPath);

                config.jsonPath = options.jsonPath;
                config.jsonAutoSave = true;
            } catch (x) {
            }
        }

        config.registerDelayMs = 1000 * 60 * 2;

        const freebox = new Freebox(config);

        freebox.openSession().then((result) => {
            console.log("Freebox granted, result=", result);


            if (NO_XPL) {
                setInterval(() => poolFreebox(freebox, xpl), 1000 * 5);

            } else {
                if (!options.xplSource) {
                    var hostName = os.hostname();
                    if (hostName.indexOf('.') > 0) {
                        hostName = hostName.substring(0, hostName.indexOf('.'));
                    }

                    options.xplSource = "freeboxos." + hostName;
                }

                var xpl = new Xpl(options);

                xpl.on("error", (error) => {
                    console.log("XPL error", error);
                });


                xpl.on("xpl:xpl-cmnd", processXplMessage.bind(xpl, freebox, options.deviceAliases));

                xpl.bind((error) => {
                    if (error) {
                        console.error(error);
                        return;
                    }

                    setInterval(() => poolFreebox(freebox, xpl), 1000 * 5);
                });
            }
        });

    });
commander.parse(process.argv);

var currentHosts = {};
var intervalHosts = {};
var lastIntervalDate = 0;

var currentFilters = {};
var default_filter_mode;

/**
 *
 * @param {Freebox} freebox
 * @param {Xpl} xpl
 */
function poolFreebox(freebox, xpl) {
    console.log("Pool freebox");

    freebox.getParentalConfig().then((result) => {
        debug('getParentalConfig', 'Parental Config=', result);

        if (default_filter_mode === result.default_filter_mode) {
            return;
        }
        default_filter_mode = result.default_filter_mode;

        const message = {
            device: 'parental-rule/default',
            current: default_filter_mode,
        }
        xpl.sendXplStat(message, "sensor.basic", (error) => {
            if (error) {
                console.error(error);
                return;
            }

            debug("send", "Parental config messages sent !");
        });
    });


    freebox.getParentalFilter().then((result) => {
        debug('getParentalFilter', 'Parental filters=', result);

        const messages = [];
        result.forEach((f) => {
            const {forced, forced_mode, desc} = f;

            const prev = currentFilters[desc];
            if (prev) {
                if (prev.forced === forced && prev.forced_mode === forced_mode) {
                    return;
                }
            }

            currentFilters[desc] = f;

            messages.push({
                device: 'parental-rule/' + desc,
                current: forced ? (forced_mode) : 'planning',
            });
        });

        if (xpl) {
            debug("Send", messages.length, "messages.");

            async.eachSeries(messages, (message, callback) => {
                debug("Send message=", message);

                xpl.sendXplStat(message, "sensor.basic", callback);

            }, (error) => {
                if (error) {
                    console.error(error);
                    return;
                }

                debug("send", messages.length + " messages sent !");
            });
        }
    });

    freebox.lanBrowser().then((result) => {
        result = result.filter((v) => v.primary_name);
        var filtredResult = result.reduce((prev, v) => {
            var lastActivity = v.last_activity ? (new Date(v.last_activity * 1000)) : undefined;
            var lastReachable = v.last_time_reachable ? (new Date(v.last_time_reachable * 1000)) : undefined;

            prev[v.primary_name] = {enabled: v.reachable, lastActivity, lastReachable};
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
                    intervalHosts[hostName] = cur;
                    messages.push({
                        device: hostName + '/lastActivity',
                        current: cur.lastActivity.toISOString()
                    });
                }
                continue;
            }

            delete oldHosts[k];

            if (cur.enabled !== old.enabled) {
                var en = {
                    device: hostName + '/reachable',
                    current: cur.enabled
                };
                if (!cur.enabled && cur.lastReachable) {
                    en.date = cur.lastReachable.toISOString();
                }
                messages.push(en);
                if (intervalHosts[hostName]) {
                    messages.push({
                        device: hostName + '/lastActivity',
                        current: cur.lastActivity.toISOString()
                    });
                    delete intervalHosts[hostName];
                    continue;
                }
            }
            if (cur.lastActivity && (!old.lastActivity || cur.lastActivity.getTime() !== old.lastActivity.getTime())) {
                intervalHosts[hostName] = cur;
            }
        }

        for (var k in oldHosts) {
            var old = oldHosts[k];
            var hostName = 'host/' + k.replace(/\//g, '_');

            var en = {
                device: hostName + '/reachable',
                current: false,
                lost: true
            };
            if (old.lastReachable) {
                en.date = old.lastReachable.toISOString();
            }
            messages.push(en);

            if (intervalHosts[hostName]) {
                messages.push({
                    device: hostName + '/lastActivity',
                    current: old.lastActivity.toISOString()
                });
                delete intervalHosts[hostName];
                continue;
            }
        }

        var now = Date.now();
        if (lastIntervalDate + LAST_ACTIVITY_INTERVAL_MS < now) {
            lastIntervalDate = now;

            for (var k in intervalHosts) {
                messages.push({
                    device: k + '/lastActivity',
                    current: intervalHosts[k].lastActivity.toISOString()
                });
            }
            intervalHosts = {};
        }

        if (xpl) {
            debug("Send", messages.length, "messages.");

            async.eachSeries(messages, (message, callback) => {
                debug("Send message=", message);

                xpl.sendXplStat(message, "sensor.basic", callback);

            }, (error) => {
                if (error) {
                    console.error(error);
                    return;
                }

                debug("send", messages.length + " messages sent !");
            });
        }

    }).catch((error) => {
        console.error(error);
    })
}

function processXplMessage(freebox, deviceAliases, message) {

    debug("processXplMessage", "Receive message", message);

    if (message.bodyName !== "delabarre.command" &&
        message.bodyName !== "x10.basic") {
        return;
    }

    const body = message.body;

    let command = body.command;
    let device = body.device;
    let current = body.current;

    switch (command) {
        case 'status':
            const reg = /^parental-rule\/(.*)$/.exec(device);
            if (reg) {
                let parentalFilter = currentFilters && currentFilters[reg[1]];
                if (parentalFilter === false) {
                    console.error('Invalid parentalId for', reg[1]);
                    return;
                }
                let forcedMode;
                let forced;
                switch (current) {
                    case 'denied':
                    case 'allowed':
                        forced = true;
                        forcedMode = current;
                        break;
                    case 'planning':
                        forced = false;
                        forcedMode = 'allowed';
                        break;
                    default:
                        console.error('Unknown state', current);
                        return;
                }

                freebox.updateParentalFilter(parentalFilter.id, forcedMode, forced, (error) => {
                    if (error) {
                        console.error(error);
                    }
                });
                return;
            }
            console.error('Unknown device');
            return;
    }
}
