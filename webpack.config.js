'use strict'
const path = require('node:path')

// Tabby owns Angular and its plugin SDK; externalising them avoids duplicate
// Angular injectors and prevents bundling a second copy of Tabby's services.
module.exports = {
    target: 'electron-renderer',
    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        library: { type: 'commonjs2' },
    },
    resolve: { extensions: ['.ts', '.js'] },
    module: {
        rules: [{ test: /\.ts$/, exclude: /node_modules/, loader: 'ts-loader' }],
    },
    externals: [
        ({ request }, callback) => {
            if (request && (/^tabby-/.test(request) || /^@angular\//.test(request) || /^@ng-bootstrap\//.test(request))) {
                return callback(null, `commonjs ${request}`)
            }
            callback()
        },
    ],
}
