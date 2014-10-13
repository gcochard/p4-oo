'use strict';
module.exports = function(grunt){
    grunt.initConfig({
        jsdoc: {
            dist: {
                src: ['index.js', 'lib/*.js', 'test/*.js'],
                dest: 'gh-pages'
            }
        },
        githubPages: {
            target: {
                options: {
                    commitMesage: 'push'
                },
                src: 'gh-pages'
            }
        }
    });
    grunt.loadNpmTasks('grunt-jsdoc');
    grunt.registerTask('default', 'jsdoc');
    grunt.loadNpmTasks('grunt-github-pages');
    grunt.registerTask('docs', ['githubPages:target']);
};
