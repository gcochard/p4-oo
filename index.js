/**
 * @fileoverview
 * This is a module loader and dependency injector.
 * It requires all modules required by P4 and then passes them in.
 * It supports easy mocking and testing.
 */
var path = require('path'),
exec = require('child_process').exec,
P4 = require('./lib/p4')(exec,path);
module.exports = P4;
