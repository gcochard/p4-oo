'use strict';
module.exports = function(grunt){
    grunt.initConfig({
        jsdoc: {
            dist: {
                src: ['index.js', 'lib/*.js', 'test/*.js'],
                dest: 'gh-pages/jsdoc'
            }
        },
        githubPages: {
            target: {
                options: {
                    commitMesage: 'push'
                },
                src: 'gh-pages'
            }
        },
        eslint: {
            options: {
                rulesDir: './node_modules/eslint/lib/rules'
            },
            nodeFiles: {
                files: {
                    src: ['index.js','lib/*.js']
                },
                options: {
                    config: 'conf/node-eslint.json'
                }
            },
            testFiles: {
                files: {
                    src: ['test/*.js']
                },
                options: {
                    config: 'conf/mocha-eslint.json'
                }
            }
        }
    });
    grunt.loadNpmTasks('eslint-grunt');
    grunt.loadNpmTasks('grunt-jsdoc');
    grunt.loadNpmTasks('grunt-github-pages');
    grunt.registerTask('lint', ['eslint']);
    grunt.registerTask('default', ['eslint', 'jsdoc']);
    grunt.registerTask('docs', ['githubPages:target']);
};
