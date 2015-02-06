/**
* @fileoverview Tests for p4 object
* @author Greg Cochard <greg.cochard@gmail.com>
* @copyright 2014 Greg Cochard, all rights reserved.
*/

'use strict';
var path = require('path'),
EventEmitter = require('events').EventEmitter,
expect = require('chai').expect,
should = require('chai').should(),
util = require('util'),
errnoException = util._errnoException,
maybeClose = function(subprocess){
    subprocess._closesGot++;
    if (subprocess._closesGot === subprocess._closesNeeded) {
        subprocess.emit('close', subprocess.exitCode, subprocess.signalCode);
    }
},
flushStdio = function(subprocess) {
    if (subprocess.stdio == null) {
        return;
    }
    subprocess.stdio.forEach(function(stream) {
        if (!stream || !stream.readable || stream._consuming ||
        stream._readableState.flowing) {
            return;
        }
        stream.resume();
    });
},
ChildProcess = function(){
    EventEmitter.call(this);
    var self = this;
    this._closesNeeded = 1;
    this._closesGot = 0;
    this.connected = false;

    this.signalCode = null;
    this.exitCode = null;
    this.killed = false;
    this.spawnfile = null;

    this._handle = {};
    this._handle.owner = this;

    this._handle.onexit = function(exitCode, signalCode) {
        //
        // follow 0.4.x behaviour:
        //
        // - normally terminated processes don't touch this.signalCode
        // - signaled processes don't touch this.exitCode
        //
        // new in 0.9.x:
        //
        // - spawn failures are reported with exitCode < 0
        //
        var syscall = self.spawnfile ? 'spawn ' + self.spawnfile : 'spawn';
        /*eslint-disable no-shadow */
        var err = exitCode < 0 ? errnoException(exitCode, syscall) : null;
        /*eslint-enable no-shadow */

        if (signalCode) {
            self.signalCode = signalCode;
        } else {
            self.exitCode = exitCode;
        }

        if (self.stdin) {
            self.stdin.destroy();
        }

        self._handle.close();
        self._handle = null;

        if (exitCode < 0) {
            if (self.spawnfile) {
                err.path = self.spawnfile;
            }

            self.emit('error', err);
        } else {
            self.emit('exit', self.exitCode, self.signalCode);
        }

        // if any of the stdio streams have not been touched,
        // then pull all the data through so that it can get the
        // eof and emit a 'close' event.
        // Do it on nextTick so that the user has one last chance
        // to consume the output, if for example they only want to
        // start reading the data once the process exits.
        process.nextTick(function() {
            flushStdio(self);
        });

        maybeClose(self);
    };
},
ChildMock = function(){

}
;
util.inherits(ChildProcess, EventEmitter);
var errs = [], stdouts = [], stderrs = [], throws = [];
var lastCmd;
ChildMock.exec = function(cmd,opts,cb){
    lastCmd = cmd;
    var err = null, stdout = '', stderr = '';
    var child = new ChildProcess();
    if(throws.length){
        throw throws.pop();
    }
    if(errs.length && stdouts.length && stderrs.length){
        err = errs.pop();
        stdout = stdouts.pop();
        stderr = stderrs.pop();
    }
    setTimeout(function(){
        cb(err,stdout,stderr);
    },5);
    return child;
};

var P4 = require('../lib/p4.js')(ChildMock.exec,path);


describe('P4', function(){

    it('should not share state between multiple objects',function(done){
        var p4s = [];
        var i;
        var p4;

        for(i=0;i<10;i++){
            p4 = new P4();
            i = 'dir'+i;
            p4.cd('/').cd(i);
            p4s.push(p4);
        }

        p4s.forEach(function(p,idx){
            idx = '/dir'+idx;
            expect(p.pwd()).to.equal(idx);
        });

        done();
    });

    it('should work with or without new',function(){
        /*eslint-disable new-cap */
        var p4 = P4();
        /*eslint-enable new-cap */
        expect(p4).to.be.instanceof(P4);
        var p4n = new P4();
        expect(p4n).to.be.instanceof(P4);
    });

    it('should exec crap',function(done){
        var p4 = new P4();
        stderrs.push('');
        errs.push(null);
        var stdout = 'yay\n';
        stdouts.push(stdout);
        p4.runShellCommand('echo',['yay'],function(err,out,stderr){
            expect(out).to.equal(stdout);
            should.not.exist(err);
            should.not.exist(stderr);
            done();
        });
    });

    it('should handle error when it cannot exec',function(done){
        var p4 = new P4();
        stderrs.push('Could not exec file\n');
        errs.push(new Error('ENOENT'));
        stdouts.push('yay\n');
        p4.runShellCommand('echo','yay',function(err,stdout,stderr){
            err.should.be.instanceof(Error);
            expect(err.message).to.equal('ENOENT');
            should.not.exist(stdout);
            should.not.exist(stderr);
            done();
        });
    });

    it('should call cb with error that exec throws',function(done){
        var p4 = new P4();
        throws.push(new Error('exec ENOENT'));
        p4.runShellCommand('echo','yay',function(err,stdout,stderr){
            err.should.be.instanceof(Error);
            expect(err.message).to.equal('exec ENOENT');
            should.not.exist(stdout);
            should.not.exist(stderr);
            done();
        });
    });


    it('should run arbitrary p4 command',function(done){
        var p4 = new P4();
        stderrs.push('');
        errs.push(null);
        var stdout = 'yay\n';
        stdouts.push(stdout);
        p4.runCommand('yay',function(err,out,stderr){
            should.not.exist(err);
            expect(out).to.equal(stdout);
            should.not.exist(stderr);
            done();
        });
    });

    it('should handle error when exec command fails',function(done){
        var p4 = new P4();
        var stderr = 'error, happy not found\n';
        stderrs.push(stderr);
        errs.push(null);
        var stdout = 'yay\n';
        stdouts.push(stdout);
        p4.runShellCommand('echo',['yay'],function(err,out,stdErr){
            err.should.be.instanceof(Error);
            expect(err.message).to.equal(stderr);
            expect(out).to.equal(stdout);
            should.not.exist(stdErr);
            done();
        });
    });

    it('should call cb with error that exec throws',function(done){
        var p4 = new P4();
        throws.push(new Error('happy ENOTFOUND'));
        p4.runCommand('yay',function(err,out,stdErr){
            err.should.be.instanceof(Error);
            expect(err.message).to.equal('happy ENOTFOUND');
            should.not.exist(out);
            should.not.exist(stdErr);
            done();
        });
    });

    it('should edit files',function(done){
        var p4 = new P4();
        stderrs.push('');
        errs.push(null);
        var stdout = ['//depot/path/to/file/foo.js#123 - opened for edit',
            '... //depot/path/to/file/foo.js - also opened by user@workspace',
        ].join('\n');
        stdouts.push(stdout);
        p4.edit('foo.js',function(err,res){
            should.not.exist(err);
            expect(res).to.equal(stdout);
            done();
        });
    });

    it('should edit files with special chars in the names',function(done){
        var p4 = new P4();
        var stdout = '//depot/path/to/file/foo@foo.js#123 - opened for edit';
        stderrs.push('');
        errs.push(null);
        stdouts.push(stdout);
        p4.edit('foo@foo.js',function(err,res){
            should.not.exist(err);
            expect(lastCmd).to.equal('p4 edit foo%40foo.js');
            expect(res).to.equal(stdout);
            done();
        });
    });

    it('should call cb with error when edit fails',function(done){
        var p4 = new P4();
        var thiserror = 'Perforce password (P4PASSWD) invalid or unset.';
        stderrs.push(thiserror+'\n');
        var thiserr = new Error('Command failed: '+thiserror);
        thiserr.killed = false;
        thiserr.code = 1;
        thiserr.signal = null;
        errs.push(thiserr);
        stdouts.push('');
        p4.edit('foo.js',function(err,res){
            err.should.be.instanceof(Error);
            expect(err.message).to.equal('Command failed: Perforce password (P4PASSWD) invalid or unset.');
            should.not.exist(res);
            done();
        });
    });

    it('should add files',function(done){
        var p4 = new P4();
        stderrs.push('');
        errs.push(null);
        var stdout = '//depot/path/to/file/bar.js#1 - opened for add\n';
        stdouts.push(stdout);
        p4.add('bar.js',function(err,res){
            should.not.exist(err);
            expect(res).to.equal(stdout);
            done();
        });
    });

    it('should call cb with error when add fails',function(done){
        var p4 = new P4();
        var thiserror = 'Perforce password (P4PASSWD) invalid or unset.';
        stderrs.push(thiserror+'\n');
        var thiserr = new Error('Command failed: '+thiserror);
        thiserr.killed = false;
        thiserr.code = 1;
        thiserr.signal = null;
        errs.push(thiserr);
        stdouts.push('');
        p4.add('bar.js',function(err,res){
            err.should.be.instanceof(Error);
            expect(err.message).to.equal('Command failed: Perforce password (P4PASSWD) invalid or unset.');
            should.not.exist(res);
            done();
        });
    });

    it('should smartEdit files',function(done){
        var p4 = new P4();
        stderrs.push('');
        errs.push(null);
        var stdout = '//depot/path/to/file/bar.js#1 - opened for add\n';
        stdouts.push(stdout);
        p4.smartEdit('bar.js',function(err,res){
            should.not.exist(err);
            expect(res).to.equal(stdout);
            done();
        });
    });

    it('should add when smartEdit edit fails',function(done){
        var p4 = new P4();
        stderrs.push('','bar.js - file(s) not on client.\n');
        stdouts.push('bar.js#1 - opened for add\n','');
        errs.push(null,null);
        p4.smartEdit('bar.js',function(err,res){
            should.not.exist(err);
            expect(res).to.equal('bar.js#1 - opened for add\n');
            done();
        });
    });

    it('should call cb with error when smartEdit fails',function(done){
        var p4 = new P4();
        var stderr = 'Perforce password (P4PASSWD) invalid or unset.';
        stderrs.push(stderr+'\n');
        var err = new Error('Command failed: '+stderr);
        stderr += '\n';
        err.killed = false;
        err.code = 1;
        err.signal = null;
        errs.push(err);
        stdouts.push('');
        p4.add('bar.js',function(theerr,res){
            theerr.should.be.instanceof(Error);
            expect(theerr.message).to.equal('Command failed: Perforce password (P4PASSWD) invalid or unset.');
            should.not.exist(res);
            done();
        });
    });

    it('should parse fstat output', function(done){
        var p4 = new P4();
        // Be explicit about setting err, stdout, and stderr before EVERY test
        errs.push(null);
        stderrs.push('');
        stdouts.push([
            '... depotFile //depot/path/to/foo.js',
            '... clientFile /path/to/workspace/foo.js',
            '... isMapped',
            '... headAction edit',
            '... headType text',
            '... headTime 1230890900',
            '... headRev 2',
            '... headChange 123',
            '... headModTime 1230890900',
            '... haveRev 2',
            '... action edit',
            '... change default',
            '... type text',
            '... actionOwner luser',
        ].join('\n'));
        p4.stat('foo.js',function(err,stats){
            should.not.exist(err);
            var expectedStats = {
                depotFile: '//depot/path/to/foo.js',
                clientFile: '/path/to/workspace/foo.js',
                isMapped: true,
                headAction: 'edit',
                headType: 'text',
                headTime: '1230890900',
                headRev: '2',
                headChange: '123',
                headModTime: '1230890900',
                haveRev: '2',
                action: 'edit',
                change: 'default',
                type: 'text',
                actionOwner: 'luser',
            };
            expect(stats).to.deep.equal(expectedStats);
            done();
        });
    });

    it('should show have revision', function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('');
        stdouts.push('... haveRev 2\n');
        p4.have('foo.js',function(err,revision){
            should.not.exist(err);
            expect(revision).to.equal('2');
            done();
        });
    });

    it('should handle error on calling have', function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('foo.js - file(s) not on client.\n');
        stdouts.push('');
        p4.have('foo.js',function(err,revision){
            err.should.be.instanceof(Error);
            should.not.exist(revision);
            done();
        });
    });

    it('should call the cb with error if filepath not passed to stat',function(done){
        var p4 = new P4();
        p4.stat(function(err,out){
            err.should.be.instanceof(Error);
            should.not.exist(out);
            expect(err.message).to.equal('Please pass a file to stat!');
            done();
        });
    });

    it('should call the callback with error on stderror',function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('fdsa\n');
        stdouts.push('');
        p4.stat('foo.js',function(err,stats){
            err.should.be.instanceof(Error);
            should.not.exist(stats);
            done();
        });
    });

    it('should call the callback with error on err',function(done){
        var p4 = new P4();
        stderrs.push('');
        stdouts.push('');
        errs.push(new Error('ENOENT'));
        p4.stat('foo.js',function(err,stats){
            err.should.be.instanceof(Error);
            should.not.exist(stats);
            done();
        });
    });

    it('should parse perforce fstat output correctly',function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('bar - no such file(s).\n');
        stdouts.push([
            '',
            '',
            '',
            '... depotFile //depot/path/to/foo.js',
            '... clientFile /path/to/workspace/foo.js',
            '... isMapped',
            '... headAction edit',
            '... headType text',
            '... headTime 1230890900',
            '... headRev 2',
            '... headChange 123',
            '... headModTime 1230890900',
            '... haveRev 2',
            '... action edit',
            '... change default',
            '... type text',
            '... actionOwner luser',
            '',
            '... depotFile //depot/path/to/bar.js',
            '... clientFile /path/to/workspace/bar.js',
            '... isMapped',
            '... headAction edit',
            '... headType text',
            '... headTime 1230890900',
            '... headRev 2',
            '... headChange 123',
            '... headModTime 1230890900',
            '... haveRev 2',
            '... action edit',
            '... change default',
            '... type text',
            '... actionOwner luser',
        ].join('\n')+'\n');
        var expectedStats = [{
            depotFile: '//depot/path/to/foo.js',
            clientFile: '/path/to/workspace/foo.js',
            isMapped: true,
            headAction: 'edit',
            headType: 'text',
            headTime: '1230890900',
            headRev: '2',
            headChange: '123',
            headModTime: '1230890900',
            haveRev: '2',
            action: 'edit',
            change: 'default',
            type: 'text',
            actionOwner: 'luser',
        },{
            depotFile: '//depot/path/to/bar.js',
            clientFile: '/path/to/workspace/bar.js',
            isMapped: true,
            headAction: 'edit',
            headType: 'text',
            headTime: '1230890900',
            headRev: '2',
            headChange: '123',
            headModTime: '1230890900',
            haveRev: '2',
            action: 'edit',
            change: 'default',
            type: 'text',
            actionOwner: 'luser',
        }];
        p4.statDir(function(err,stats){
            should.not.exist(err);
            expect(stats).to.have.length(2);
            expect(stats).to.deep.equal(expectedStats);
            done();
        });
    });

    it('should cd to filepath when passed to statDir',function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('');
        stdouts.push('');
        p4.statDir('/path/to/dir/',function(err,out){
            should.not.exist(err);
            out.should.be.instanceof(Array);
            expect(p4.pwd()).to.equal('/path/to/dir');
            done();
        });
    });

    it('should call cb with error on statDir error',function(done){
        var p4 = new P4();
        errs.push(new Error('fdsa'));
        stderrs.push('');
        stdouts.push('');
        p4.statDir('/path/to/dir/',function(err,out){
            expect(err.message).to.equal('fdsa');
            should.not.exist(out);
            expect(p4.pwd()).to.equal('/path/to/dir');
            done();
        });
    });

    it('should call cb with error on parseStats error in statDir',function(done){
        var p4 = new P4();
        errs.push(null);
        stdouts.push([
            '... depotFile //path/to/file/foo.js',
            '... clientFile /path/to/workspace/foo.js',
            '... isMapped ',
            '... headAction edit',
            '... headType xtext',
            '... headTime 1234567890',
            '... headRev 123',
            '... headChange 12345',
            '... headModTime 1234567890',
            '... haveRev 123',
            '... ... otherOpen0 other@some_other_workspace',
            '... ... otherAction0 edit',
            '... ... otherChange0 12340',
            '... ... otherOpen1 other@another_workspace',
            '... ... otherAction1 edit',
            '... ... otherChange1 default',
            '... ... otherOpen2 other2@yet_another_workspace',
            '... ... otherAction2 edit',
            '... ... otherChange2 default',
            '... ... otherOpen3 other@some_other_workspace',
            '... ... otherAction3 edit',
            '... ... otherChange3 12340',
            '... ... otherOpen4 other@another_workspace',
            '... ... otherAction4 edit',
            '... ... otherChange4 default',
            '... ... otherOpen5 other2@yet_another_workspace',
            '... ... otherAction5 edit',
            '... ... otherChange5 default',
            '... ... otherOpen 3',
            ''
        ].join('\n')+'\n');
        stderrs.push('');
        p4.statDir('/path/to/dir/',function(err,out){
            err.should.be.instanceof(Error);
            should.not.exist(out);
            done();
        });
    });

    it('should handle no such file errors from perforce',function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('bar - no such file(s).\n');
        stdouts.push('');
        var expectedStats = [];
        p4.statDir(function(err,stats){
            should.not.exist(err);
            stats.should.have.length(0);
            stats.should.deep.equal(expectedStats);
            done();
        });
    });

    it('should handle multiple stat levels with fstat',function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('');

        stdouts.push([
            '... depotFile //path/to/file/foo.js',
            '... clientFile /path/to/workspace/foo.js',
            '... isMapped ',
            '... headAction edit',
            '... headType xtext',
            '... headTime 1234567890',
            '... headRev 123',
            '... headChange 12345',
            '... headModTime 1234567890',
            '... haveRev 123',
            '... ... otherOpen0 other@some_other_workspace',
            '... ... otherAction0 edit',
            '... ... otherChange0 12340',
            '... ... otherOpen1 other@another_workspace',
            '... ... otherAction1 edit',
            '... ... otherChange1 default',
            '... ... otherOpen2 other2@yet_another_workspace',
            '... ... otherAction2 edit',
            '... ... otherChange2 default',
            '... ... otherOpen3 other@some_other_workspace',
            '... ... otherAction3 edit',
            '... ... otherChange3 12340',
            '... ... otherOpen4 other@another_workspace',
            '... ... otherAction4 edit',
            '... ... otherChange4 default',
            '... ... otherOpen5 other2@yet_another_workspace',
            '... ... otherAction5 edit',
            '... ... otherChange5 default',
            '... ... otherOpen6 other@some_other_workspace',
            '... ... otherAction6 edit',
            '... ... otherChange6 12340',
            '... ... otherOpen7 other@another_workspace',
            '... ... otherAction7 edit',
            '... ... otherChange7 default',
            '... ... otherOpen8 other2@yet_another_workspace',
            '... ... otherAction8 edit',
            '... ... otherChange8 default',
            '... ... otherOpen9 other@some_other_workspace',
            '... ... otherAction9 edit',
            '... ... otherChange9 12340',
            '... ... otherOpen10 other@another_workspace',
            '... ... otherAction10 edit',
            '... ... otherChange10 default',
            '... ... otherOpen 11',
            ''
        ].join('\n')+'\n');

        var expectedStats = {
            depotFile: '//path/to/file/foo.js',
            clientFile: '/path/to/workspace/foo.js',
            isMapped: true,
            headAction: 'edit',
            headType: 'xtext',
            headTime: '1234567890',
            headRev: '123',
            headChange: '12345',
            headModTime: '1234567890',
            haveRev: '123',
            other: [
                {
                    Open: 'other@some_other_workspace',
                    Action: 'edit',
                    Change: '12340',
                },{
                    Open: 'other@another_workspace',
                    Action: 'edit',
                    Change: 'default',
                },{
                    Open: 'other2@yet_another_workspace',
                    Action: 'edit',
                    Change: 'default',
                },{
                    Open: 'other@some_other_workspace',
                    Action: 'edit',
                    Change: '12340',
                },{
                    Open: 'other@another_workspace',
                    Action: 'edit',
                    Change: 'default',
                },{
                    Open: 'other2@yet_another_workspace',
                    Action: 'edit',
                    Change: 'default',
                },{
                    Open: 'other@some_other_workspace',
                    Action: 'edit',
                    Change: '12340',
                },{
                    Open: 'other@another_workspace',
                    Action: 'edit',
                    Change: 'default',
                },{
                    Open: 'other2@yet_another_workspace',
                    Action: 'edit',
                    Change: 'default',
                },{
                    Open: 'other@some_other_workspace',
                    Action: 'edit',
                    Change: '12340',
                },{
                    Open: 'other@another_workspace',
                    Action: 'edit',
                    Change: 'default',
                },
            ]
        };

        p4.stat('foo.js',function(err,stats){
            should.not.exist(err);
            stats.should.deep.equal(expectedStats);
            stderrs.push('');
            errs.push(null);
            stdouts.push([
                '... ... ... depotFile //depot/path/to/foo.js',
                '... ... ... clientFile /path/to/workspace/foo.js',
                '... ... ... isMapped',
                '... ... ... headAction edit',
                '... ... ... headType text',
                '... ... ... headTime 1230890900',
                '... ... ... headRev 2',
                '... ... ... headChange 123',
                '... ... ... headModTime 1230890900',
                '... ... ... haveRev 2',
                '... ... ... action edit',
                '... ... ... change default',
                '... ... ... type text',
                '... ... ... actionOwner luser',
            ].join('\n')+'\n');
            p4.stat('foo.js',function(theerr,thestats){
                theerr.should.be.instanceof(Error);
                should.not.exist(thestats);
                done();
            });
        });
    });

    it('should recursively stat dir',function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('');
        stdouts.push([
            '',
            '',
            '',
            '... depotFile //depot/path/to/foo.js',
            '... clientFile /path/to/workspace/foo.js',
            '... isMapped',
            '... headAction edit',
            '... headType text',
            '... headTime 1230890900',
            '... headRev 2',
            '... headChange 123',
            '... headModTime 1230890900',
            '... haveRev 2',
            '... action edit',
            '... change default',
            '... type text',
            '... actionOwner luser',
            '',
            '... depotFile //depot/path/to/bar.js',
            '... clientFile /path/to/workspace/bar.js',
            '... isMapped',
            '... headAction edit',
            '... headType text',
            '... headTime 1230890900',
            '... headRev 2',
            '... headChange 123',
            '... headModTime 1230890900',
            '... haveRev 2',
            '... action edit',
            '... change default',
            '... type text',
            '... actionOwner luser',
        ].join('\n')+'\n');
        var expectedStats = [{
            depotFile: '//depot/path/to/foo.js',
            clientFile: '/path/to/workspace/foo.js',
            isMapped: true,
            headAction: 'edit',
            headType: 'text',
            headTime: '1230890900',
            headRev: '2',
            headChange: '123',
            headModTime: '1230890900',
            haveRev: '2',
            action: 'edit',
            change: 'default',
            type: 'text',
            actionOwner: 'luser',
        },{
            depotFile: '//depot/path/to/bar.js',
            clientFile: '/path/to/workspace/bar.js',
            isMapped: true,
            headAction: 'edit',
            headType: 'text',
            headTime: '1230890900',
            headRev: '2',
            headChange: '123',
            headModTime: '1230890900',
            haveRev: '2',
            action: 'edit',
            change: 'default',
            type: 'text',
            actionOwner: 'luser',
        }];
        p4.recursiveStatDir(function(err,stats){
            should.not.exist(err);
            stats.should.deep.equal(expectedStats);
            stdouts.push([
                        '... depotFile //depot/path/to/foo.js',
                        '... clientFile /path/to/workspace/foo.js',
                        '... isMapped',
                        '... headAction edit',
                        '... headType text',
                        '... headTime 1230890900',
                        '... headRev 2',
                        '... headChange 123',
                        '... headModTime 1230890900',
                        '... haveRev 2',
                        '... action edit',
                        '... change default',
                        '... type text',
                        '... actionOwner luser',
                        '',
                        '... depotFile //depot/path/to/bar.js',
                        '... clientFile /path/to/workspace/bar.js',
                        '... isMapped',
                        '... headAction edit',
                        '... headType text',
                        '... headTime 1230890900',
                        '... headRev 2',
                        '... headChange 123',
                        '... headModTime 1230890900',
                        '... haveRev 2',
                        '... action edit',
                        '... change default',
                        '... type text',
                        '... actionOwner luser',
                    ].join('\n')+'\n');
            stderrs.push('');
            errs.push(null);
            p4.recursiveStatDir('/foo/bar',function(theerr,thestats){
                should.not.exist(theerr);
                expect(p4.pwd()).to.equal('/foo/bar');
                thestats.should.deep.equal(expectedStats);
                done();
            });
        });
    });

    it('should handle error in recursiveStatDir',function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('I can\'t let you do that starfox...');
        stdouts.push('');
        p4.recursiveStatDir(function(err,stats){
            err.should.be.instanceof(Error);
            should.not.exist(stats);
            done();
        });
    });

    it('should throw an error on bad fstat output',function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('');

        stdouts.push([
            '... depotFile //path/to/file/foo.js',
            '... clientFile /path/to/workspace/foo.js',
            '... isMapped ',
            '... headAction edit',
            '... headType xtext',
            '... headTime 1234567890',
            '... headRev 123',
            '... headChange 12345',
            '... headModTime 1234567890',
            '... haveRev 123',
            '... ... otherOpen0 other@some_other_workspace',
            '... ... otherAction0 edit',
            '... ... otherChange0 12340',
            '... ... otherOpen1 other@another_workspace',
            '... ... otherAction1 edit',
            '... ... otherChange1 default',
            '... ... otherOpen2 other2@yet_another_workspace',
            '... ... otherAction2 edit',
            '... ... otherChange2 default',
            '... ... otherOpen3 other@some_other_workspace',
            '... ... otherAction3 edit',
            '... ... otherChange3 12340',
            '... ... otherOpen4 other@another_workspace',
            '... ... otherAction4 edit',
            '... ... otherChange4 default',
            '... ... otherOpen5 other2@yet_another_workspace',
            '... ... otherAction5 edit',
            '... ... otherChange5 default',
            '... ... otherOpen 3',
            ''
        ].join('\n')+'\n');

        p4.stat('foo.js',function(err,stats){
            should.not.exist(stats);
            err.should.be.instanceof(Error);
            errs.push(null,null);
            stderrs.push('','');

            stdouts.push([
                '... depotFile //path/to/file/foo.js',
                '... clientFile /path/to/workspace/foo.js',
                '... isMapped ',
                '... headAction edit',
                '... headType xtext',
                '... headTime 1234567890',
                '... headRev 123',
                '... headChange 12345',
                '... headModTime 1234567890',
                '... haveRev 123',
                '... ... otherOpen0 other@some_other_workspace',
                '... ... otherAction0 edit',
                '... ... otherChange0 12340',
                '... ... otherOpen1 other@another_workspace',
                '... ... otherAction1 edit',
                '... ... otherChange1 default',
                '... ... otherOpen2 other2@yet_another_workspace',
                '... ... otherAction2 edit',
                '... ... otherChange2 default',
                '... ... otherOpen3 other@some_other_workspace',
                '... ... otherAction3 edit',
                '... ... otherChange3 12340',
                '... ... otherOpen4 other@another_workspace',
                '... ... otherAction4 edit',
                '... ... otherChange4 default',
                '... ... otherOpen5 other2@yet_another_workspace',
                '... ... otherAction5 edit',
                '... ... otherChange5 default',
                '... ... otherOpen10 other@another_workspace',
                '... ... otherAction10 edit',
                '... ... otherChange10 default',
                ''
            ].join('\n')+'\n',[
                '... depotFile //path/to/file/foo.js',
                '... clientFile /path/to/workspace/foo.js',
                '... isMapped ',
                '... headAction edit',
                '... headType xtext',
                '... headTime 1234567890',
                '... headRev 123',
                '... headChange 12345',
                '... headModTime 1234567890',
                '... haveRev 123',
                '... ... otherOpen0 other@some_other_workspace',
                '... ... otherAction0 edit',
                '... ... otherChange0 12340',
                '... ... otherOpen1 other@another_workspace',
                '... ... otherAction1 edit',
                '... ... otherChange1 default',
                '... ... otherOpen2 other2@yet_another_workspace',
                '... ... otherAction2 edit',
                '... ... otherChange2 default',
                '... ... otherOpen3 other@some_other_workspace',
                '... ... otherAction3 edit',
                '... ... otherChange3 12340',
                '... ... otherOpen4 other@another_workspace',
                '... ... otherAction4 edit',
                '... ... otherChange4 default',
                '... ... otherOpen5 other2@yet_another_workspace',
                '... ... otherAction5 edit',
                '... ... otherChange5 default',
                '... ... otherOpen10 other@another_workspace',
                '... ... otherAction10 edit',
                '... ... otherChange10 default',
                ''
            ].join('\n')+'\n');

            p4.stat('foo.js',function(theerr,thestats){
                theerr.should.be.instanceof(Error);
                should.not.exist(thestats);
                p4.recursiveStatDir(function(rerr,rstats){
                    rerr.should.be.instanceof(Error);
                    should.not.exist(rstats);
                    done();
                });
            });
        });
    });

    it('should refuse to cd when passed in setOpts',function(){
        var p4 = new P4();
        p4.cd('/');
        p4.setOpts({cwd:'/a/b/c/d/e/f/g'});
        expect(p4.pwd()).to.equal('/');
    });

    it('should set options',function(){
         var p4 = new P4();
         p4.setOpts({fdsa:'fdsa',asdf:'asdf'});
         expect(p4.options).to.deep.equal({fdsa:'fdsa',asdf:'asdf'});
    });

    it('should work with revert',function(done){
        var p4 = new P4();
        stderrs.push('');
        stdouts.push('//depot/path/to/file/foo.js#123 - was edit, reverted\n');
        errs.push(null);
        p4.revert('foo.js',function(err,results){
            should.not.exist(err);
            should.exist(results);
            done();
        });
    });

    it('should call cb with error if no path is passed to revert',function(done){
        var p4 = new P4();
        // No need to push anything to stdouts, stderrs, errs, because exec is not called here
        p4.revert(function(err,results){
            err.should.be.instanceof(Error);
            should.not.exist(results);
            done();
        });
    });

    it('should work with revertUnchanged',function(done){
        var p4 = new P4();
        stderrs.push('');
        stdouts.push('//depot/path/to/file/foo.js#123 - was edit, reverted\n');
        errs.push(null);
        p4.revertUnchanged(function(err,results){
            should.not.exist(err);
            should.exist(results);
            done();
        });
    });

    it('should work when revertUnchaged is passed a path',function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('');
        stdouts.push('//depot/path/to/file/foo.js#123 - was edit, reverted\n');
        p4.revertUnchanged('bar.js',function(err,results){
            should.not.exist(err);
            should.exist(results);
            done();
        });
    });

    it('should call cb with error if no path is passed ot have',function(done){
        var p4 = new P4();
        p4.have(function(err,rev){
            err.should.be.instanceof(Error);
            should.not.exist(rev);
            done();
        });
    });

    it('should submit files',function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('');
        var stdout = [
            'Submitting change 123456.',
            'Locking 1 files ...',
            'edit //depot/path/to/file/foo.js#123',
            'Change 123456 submitted.'
        ].join('\n')+'\n';
        stdouts.push(stdout);
        p4.submit('foo.js','adding mad opts to foo yo!',function(err,res){
            should.not.exist(err);
            expect(res).to.equal(stdout);
            done();
        });
    });

    it('should call cb with error when submit fails',function(done){
        var p4 = new P4();
        errs.push(new Error('ENOENT'));
        stdouts.push('');
        stderrs.push('yeah...about that');
        p4.submit('foo.js','adding mad opts to foo yo!',function(err,res){
            err.should.be.instanceof(Error);
            should.not.exist(res);
            done();
        });
    });

    it('should call cb with error when stderr is populated during submit',function(done){
        var p4 = new P4();
        errs.push(null);
        stdouts.push('');
        var stderr = 'Could not submit foo.js, please sync/resolve first\n';
        stderrs.push(stderr);
        p4.submit('foo.js','adding mad opts to foo yo!',function(err,res){
            err.should.be.instanceof(Error);
            should.not.exist(res);
            expect(err.message).to.equal(stderr);
            done();
        });
    });

    it('should sync',function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('');
        var stdout = 'foo.js - file(s) up-to-date.\n';
        stdouts.push(stdout);
        p4.sync('foo.js',function(err,out){
            should.not.exist(err);
            expect(out).to.equal(stdout);
            done();
        });
    });

    it('should sync even when not given a path',function(done){
        var p4 = new P4();
        errs.push(null);
        stderrs.push('');
        var stdout = 'foo.js - file(s) up-to-date.\n';
        stdouts.push(stdout);
        p4.sync(function(err,out){
            should.not.exist(err);
            expect(out).to.equal(stdout);
            done();
        });
    });

    it('should sync dir',function(done){
        var p4 = new P4();
        errs.push(null,null);
        stderrs.push('','');
        var stdout = 'foo.js - file(s) up-to-date.\n';
        stdouts.push(stdout,stdout);
        p4.syncDir(function(err,out){
            should.not.exist(err);
            expect(out).to.equal(stdout);
            p4.syncDir('/path/to/dir/',function(theerr,theout){
                should.not.exist(theerr);
                expect(p4.pwd()).to.equal('/path/to/dir');
                expect(theout).to.equal(stdout);
                done();
            });
        });
    });

    it('should sync dir recursively',function(done){
        var p4 = new P4();
        errs.push(null,null);
        stderrs.push('','');
        var stdout = 'foo.js - file(s) up-to-date.\n';
        stdouts.push(stdout,stdout);
        p4.recursiveSyncDir(function(err,out){
            should.not.exist(err);
            expect(out).to.equal(stdout);
            p4.recursiveSyncDir('/path/to/dir/',function(theerr,theout){
                should.not.exist(theerr);
                expect(p4.pwd()).to.equal('/path/to/dir');
                expect(theout).to.equal(stdout);
                done();
            });
        });
    });

    describe('login',function(){

        it('should login',function(done){
            var p4 = new P4();
            errs.push(null);
            stderrs.push('');
            var stdout = 'User foo logged in.';
            stdouts.push(stdout);
            p4.login('foo','foo',function(err,out){
                should.not.exist(err);
                expect(out).to.equal(stdout);
                done();
            });
        });

        it('should cache credentials and re-login',function(done){
            var p4 = new P4();
            errs.push(null);
            stderrs.push('');
            var stdout = 'User foo logged in.';
            stdouts.push(stdout);
            p4.login('foo','foo',function(err,out){
                should.not.exist(err);
                expect(out).to.equal(stdout);
                errs.push(null);
                stderrs.push('');
                stdouts.push(stdout);
                p4.login(function(theerr,theout){
                    should.not.exist(theerr);
                    expect(theout).to.equal(stdout);
                    done();
                });
            });
        });

        it('should log in automatically when login is stale',function(done){
            var p4 = new P4();
            errs.push(null);
            stderrs.push('');
            var stdout = 'User foo logged in.';
            stdouts.push(stdout);
            p4.login('foo','foo',function(err,out){
                should.not.exist(err);
                expect(out).to.equal(stdout);
                errs.push(null);
                stderrs.push('');
                stdouts.push([
                    '... depotFile //depot/path/to/foo.js',
                    '... clientFile /path/to/workspace/foo.js',
                    '... isMapped',
                    '... headAction edit',
                    '... headType text',
                    '... headTime 1230890900',
                    '... headRev 2',
                    '... headChange 123',
                    '... headModTime 1230890900',
                    '... haveRev 2',
                    '... action edit',
                    '... change default',
                    '... type text',
                    '... actionOwner luser',
                ].join('\n'));

                errs.push(null);
                stderrs.push('');
                stdout = 'User foo logged in.';
                stdouts.push(stdout);

                errs.push(null);
                stdouts.push('');
                stderrs.push('Perforce password (P4PASSWD) invalid or unset.');

                p4.stat('foo',function(theerr,stats){
                    should.not.exist(theerr);
                    var expectedStats = {
                        depotFile: '//depot/path/to/foo.js',
                        clientFile: '/path/to/workspace/foo.js',
                        isMapped: true,
                        headAction: 'edit',
                        headType: 'text',
                        headTime: '1230890900',
                        headRev: '2',
                        headChange: '123',
                        headModTime: '1230890900',
                        haveRev: '2',
                        action: 'edit',
                        change: 'default',
                        type: 'text',
                        actionOwner: 'luser',
                    };
                    expect(stats).to.deep.equal(expectedStats);
                    done();
                });
            });
        });

        it('should bail on failed auto-login',function(done){
            var p4 = new P4();
            errs.push(null);
            stderrs.push('');
            var stdout = 'User foo logged in.';
            stdouts.push(stdout);
            p4.login('foo','foo',function(err,out){
                should.not.exist(err);
                expect(out).to.equal(stdout);
                errs.push(null);
                stderrs.push('Perforce password (P4PASSWD) invalid or unset.');
                stdouts.push('');

                errs.push(null);
                stdouts.push('');
                stderrs.push('Perforce password (P4PASSWD) invalid or unset.');

                p4.stat('foo',function(theerr,stats){
                    theerr.should.be.instanceof(Error);
                    should.not.exist(stats);
                    done();
                });
            });
        });

    });

});
