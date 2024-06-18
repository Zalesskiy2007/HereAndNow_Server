const resolve = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');

module.exports = {
    input: 'client/client.js',
    output: {
        file: 'out/bundle.js',
        format: 'iife',
        sourcemap: 'inline'
    },
    plugins: [
        resolve({
            jsnext: true,
            main: true,
            browser: true
        }),
        commonjs()
    ]
};
