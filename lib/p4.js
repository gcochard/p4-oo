/*jslint node:true*/
'use strict';
/**
 * This is a bootstrapper for dependency
 * injection. It is used so we can require or
 * mock the modules outside of this file and
 * pass them in at runtime. This makes testing
 * MUCH simpler as we can mock objects in
 * tests and pass them in.
 *
 * @param {object} exec - child_process.exec
 * @param {object} path - The path module.
 * @returns {object} P4 - The P4 module constructor.
 */
module.exports = function(exec,path){

    /**
     * @callback
     */

    /**
     * Takes output from p4 fstat and parses it to an object.
     * @param {string} stats - The output
     * @returns {object} the stats object, may be instanceof Array
     */
    function parseStats(stats) {
        var statsArr = [];
        stats = stats.split('\n\n');
        var validStat = stats.every(function(stat){
            var statsObj = {}, idx;
            if(stat === '' || stats === '\n'){
                // Return true to continue the loop
                return true;
            }
            var valid = stat.split('\n').every(function(line){
                var level = 0
                , key = ''
                , value = ''
                , obj = [];
                // Line has 3 dots and a space at the beginning, pull that off and determine the "indentation" level
                do{
                    line = line.slice(4);
                    level++;
                } while(line.indexOf('... ') === 0);
                obj = line.split(' ');
                obj[1] = obj.slice(1).join(' ');
                key = obj[0];
                value = obj[1];
                if(!key){
                    // Continue the loop, ignore it
                    return true;
                }
                if(value === ''){
                    value = true;
                }
                if(level === 1){
                    statsObj[key] = value;
                } else if(level === 2){
                    if(!statsObj.other){
                        statsObj.other = [];
                    }
                    if(key === 'otherOpen'){
                        // We are at the end of the others
                        if(statsObj.other.length !== Number(value)){
                            // Return false here because the input is invalid
                            return false;
                        }
                        return true;
                    }
                    // Get the array index of the key
                    idx = key.match(/other[a-zA-Z]+(\d+)$/)[1];
                    // Now remove `other` from the beginning and the idx from the end
                    key = key.slice(5,-idx.length);
                    if(!statsObj.other[idx]){
                        // Extend the array one more
                        statsObj.other.push({});
                    }
                    if(statsObj.other.length !== Number(idx)+1){
                        // Invalid output, not ordered properly!
                        return false;
                    }
                    statsObj.other[idx][key] = value;
                } else {
                    // level is not 1 or 2, weird output
                    return false;
                }
                // Continue
                return true;
            });
            if(valid){
                statsArr.push(statsObj);
            }
            // Continue if last was valid
            return valid;
        });
        if(!validStat){
            return new Error('Invalid fstat output!');
        }
        if(statsArr.length === 1){
            return statsArr[0];
        }
        return statsArr;
    }

    /**
     * @constructor
     */
    function P4(){
        if(!(this instanceof P4)){
            return new P4();
        }
        //------------
        // Default cwd up one dir so we don't try to exec p4.js
        // on windows. This fixes issue #3
        //-------------
        this.cwd = path.resolve(__dirname,'..');
        this.options = {};
    }

    /**
     * This function changes the cwd property
     * and behaves much like unix cd. It resolves
     * the new path based on the current CWD, and
     * handles absolute paths too.
     * Supports chaining.
     *
     * @param {string} dir - The directory to cd
     * @returns {object} this
     */
    P4.prototype.cd = function(dir){
        this.cwd = path.resolve(this.cwd,dir);
        // Allow chaining by returning this
        // i.e. p4.cd('dir').edit('file')
        // or p4.cd('path').cd('to').cd('dir')
        return this;
    };

    /**
     * Set options for the exec context.
     * Supports all options supported by child_process.exec.
     * Supports chaining.
     *
     * @param {object} opts - The options object
     * @returns {object} this
     */
    P4.prototype.setOpts = function(opts){
        var self = this;
        Object.keys(opts).forEach(function(key){
            if(key === 'cwd'){
                // Don't allow changing cwd via setOpts...
                return;
            }
            self.options[key] = opts[key];
        });
        return this;
    };

    /**
     * Run a command, used internally but public.
     * @param {string} command - The command to run
     * @param {array|string} args - The arguments for the command
     * @param {function} done - The done callback
     * @param {boolean} recursive - Whether this is calling itself recursively after login
     * @returns {object} the child process object
     */
    P4.prototype.runCommand = function(command, args, done, recursive) {
        var self = this;
        if(typeof args === 'function') {
            done = args;
            args = '';
        }
        if(args instanceof Array) {
            args = args.join(' ');
        }

        var options = this.options;

        options.cwd = this.cwd;
        // Default env to process.env if unset. Fixes issue #3
        options.env = this.options.env || process.env;
        options.env.PWD = this.cwd;
        // try/catch because exec is both sync and async
        // see https://github.com/joyent/node/issues/8573 and https://github.com/iojs/io.js/issues/1321
        try{
            return exec('p4 ' + command + ' ' + (args || ''), this.options, function(ex_err, stdOut, stdErr) {
                if(ex_err) {
                    return done(ex_err);
                }
                if('Perforce password (P4PASSWD) invalid or unset.' === stdErr && !recursive){
                    return self.login(self.username,self.password,function(err,stdout,stderr){
                        if(err){
                            return done(err,stdout,stderr);
                        }
                        // Retry same command
                        return self.runCommand(command,args,done,true);
                    });
                }
                // When we run p4 fstat *, it will say no such file(s) on dirs
                // fix this by reducing the error string and omitting matching lines
                // when calling join() on an empty array, it returns an empty string which is *falsy*
                stdErr = stdErr.split('\n').reduce(function(pval,line){
                    if(!/no such file/.test(line)){
                        // Only include if it doesn't match our test
                        pval.push(line);
                    }
                    return pval;
                },[]).join('\n');
                // This could more easily be done with this:
                // stdErr = _.reject(stdErr.split('\n'),function(line){return /no such file/.test(line)}).join('\n')
                // but learning reduce is a _good thing_ (TM) and the algorithm is arguably more descriptive and
                // self-documenting when using reduce
                if(stdErr) {
                    return done(new Error(stdErr));
                }

                return done(null, stdOut);
            });
        } catch(e){
            return done(e);
        }
    };

    /**
     * Runs an arbitrary shell command.
     * @warning DOES NOT SHELL ESCAPE ANYTHING
     * @param {string} command - The command to run
     * @param {array|string} args - The arguments to pass
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.runShellCommand = function(command, args, done) {
        if(typeof args === 'function') {
            done = args;
            args = '';
        }
        if(args instanceof Array) {
            args = args.join(' ');
        }

        var cmdEnv = process.env;
        cmdEnv.PASS = this.password;

        try{
        return exec(command + ' ' + (args || ''), {cwd: this.cwd, env: cmdEnv}, function(err, stdOut, stdErr) {
            if(err) {
                return done(err);
            }
            if(stdErr) {
                return done(new Error(stdErr),stdOut);
            }

            return done(null, stdOut);
        });
        } catch(e){
            return done(e);
        }
    };

    /**
     * Calls p4 edit on the filepath passed.
     * @param {string} filepath - The filepath, can be absolute or relative to cwd
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.edit = function(filepath, done) {
        filepath = this.sanitizeFilepath(filepath);
        return this.runCommand('edit', filepath, done);
    };

    /**
     * Calls p4 add on the filepath passed.
     * @param {string} filepath - The filepath, can be absolute or relative to cwd
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.add = function(filepath, done) {
        return this.runCommand('add', filepath, done);
    };

    /**
     * Calls p4 edit on the filepath. If an error is thrown, calls p4 add on the filepath.
     * @param {string} filepath - The filepath, can be absolute or relative to cwd
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.smartEdit = function(filepath, done) {
        var self = this;
        return this.edit(filepath, function(err, out) {
            if(!err) {
                return done(null, out);
            }

            return self.add(filepath, done);
        });
    };

    /**
     * Calls p4 revert -a. Ignores filepath arg.
     * @param {string} filepath - The filepath, ignored
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.revertUnchanged = function(filepath, done) {
        if(!done){
            done = filepath;
            filepath = null;
        }
        filepath = filepath || '';
        return this.runCommand('revert', '-a', done);
    };

    /**
     * Calls p4 fstat *. If filepath is passed, it will first cd to that path.
     * @param {string} filepath - The filepath
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.statDir = function(filepath, done) {
        if(!done){
            done = filepath;
            filepath = null;
        }
        if(filepath){
            this.cd(filepath);
        }
        return this.runCommand('fstat','*', function(err,out){
            if(err){
                return done(err);
            }
            var output = parseStats(out);
            if(output instanceof Error){
                return done(output);
            }
            return done(null,output);
        });
    };

    /**
     * Calls `p4 fstat ...`. If filepath is passed, it will first cd to that path.
     * @param {string} filepath - The filepath
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.recursiveStatDir = function(filepath, done) {
        if(!done){
            done = filepath;
            filepath = null;
        }
        if(filepath){
            this.cd(filepath);
        }
        return this.runCommand('fstat','...', function(err,out){
            if(err){
                return done(err);
            }
            var output = parseStats(out);
            if(output instanceof Error){
                return done(output);
            }
            return done(null,output);
        });
    };

    /**
     * Calls `p4 fstat` on `path.basename(filepath)`.
     * If filepath is not passed, it will call the cb with an error.
     * @param {string} filepath - The filepath
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.stat = function(filepath, done) {
        if(!done){
            done = filepath;
            filepath = null;
        }
        if(!filepath){
            return process.nextTick(done.bind(null,new Error('Please pass a file to stat!')));
        }
        this.cd(path.dirname(filepath));
        filepath = this.sanitizeFilepath(filepath);
        return this.runCommand('fstat', path.basename(filepath), function(err,out){
            if(err){
                return done(err);
            }
            var output = parseStats(out);
            if(output instanceof Error){
                return done(output);
            }
            return done(null,output);
        });
    };

    /**
     * Calls `p4 have` on `filepath`.
     * If filepath is not passed, it will call the cb with an error.
     * @param {string} filepath - The filepath
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.have = function(filepath, done) {
        if(!done){
            done = filepath;
            filepath = null;
        }
        if(!filepath){
            return process.nextTick(done.bind(null,new Error('Please pass a file to inspect!')));
        }
        return this.stat(filepath, function(err,stats){
            if(err){
                return done(err);
            }
            return done(null,stats.haveRev);
        });
    };

    /**
     * Calls `p4 revert` on `filepath`.
     * If filepath is not passed, it will call the cb with an error.
     * @param {string} filepath - The filepath
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.revert = function(filepath, done) {
        if(!done){
            done = filepath;
            filepath = null;
        }
        if(!filepath){
            return done(new Error('Please pass a file to revert!'));
        }
        filepath = this.sanitizeFilepath(filepath);
        return this.runCommand('revert', filepath, done);
    };

    /**
     * Calls `p4 submit` on `filepath`.
     * @param {string} filepath - The filepath
     * @param {string} desc - The changelist description
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.submit = function(filepath, desc, done) {
        filepath = this.sanitizeFilepath(filepath);
        return this.runCommand('submit', ['-d', '"' + desc + '"',filepath], done);
    };

    /**
     * Calls `p4 sync` on `filepath`.
     * If filepath is not passed, calls sync in cwd.
     * @param {string} filepath - The filepath
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.sync = function(filepath, done) {
        if(!done){
            done = filepath;
            filepath = null;
        }
        if(filepath){
            filepath = this.sanitizeFilepath(filepath);
        }
        return this.runCommand('sync', filepath, done);
    };

    /**
     * Calls `p4 sync *` in `filepath`.
     * If filepath is not passed, calls `p4 sync *` in cwd.
     * @param {string} filepath - The filepath
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.syncDir = function(filepath, done) {
        if(!done){
            done = filepath;
            filepath = null;
        }
        if(filepath){
            this.cd(filepath);
        }
        return this.runCommand('sync', '*', done);
    };

    /**
     * Calls `p4 sync ...` in `filepath`.
     * If filepath is not passed, calls `p4 sync ...` in cwd.
     * @param {string} filepath - The filepath
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.recursiveSyncDir = function(filepath, done) {
        if(!done){
            done = filepath;
            filepath = null;
        }
        if(filepath){
            this.cd(filepath);
        }
        return this.runCommand('sync', '...', done);
    };

    /**
     * Calls `p4 login`.
     * Important, this happens in the cwd so whatever P4CONFIG is found will be used.
     * @param {string} username - The username
     * @param {string} password - The password
     * @param {function} done - The done callback
     * @returns {object} the child process object
     */
    P4.prototype.login = function(username, password, done) {
        // Cache the username and password for refreshing login later if necessary.
        if(username && password){
            this.username = username;
            this.password = password;
        }
        // Let the username and password be optional so they only ever have to be passed once.
        if(typeof username === 'function'){
            done = username;
        }
        return this.runShellCommand('echo "$PASS" | p4 -u "' + this.username + '" login ', done);;
    };

    /**
     * Returns the cwd.
     * @returns {string} The current cwd
     */
    P4.prototype.pwd = function(){
        return this.cwd;
    };

    /**
     * Strips perforce special chars and returns a new string.
     * @param {string} filename - The filename.
     * @returns {string} the sanitized string
     */
    P4.prototype.sanitizeFilepath = function(filename){
        var replacements = {
            '@': '%40'
          , '#': '%23'
          , '*': '%2A'
          , '%': '%25'
        };
        var replacementsRe = /@|#|\*|%/g;
        return filename.replace(replacementsRe,function(s){
            return replacements[s];
        });
    };


    return P4;
};
