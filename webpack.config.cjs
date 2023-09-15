const path = require('path')
const pathPublic = path.join(__dirname, 'example')

module.exports = (env) => {
    return {
        mode: 'development',

        optimization: { minimize: false },
        devtool: 'eval',

        entry: {
            example: path.join(pathPublic, 'js', 'example.js')
        },

        devServer: {
            static: [pathPublic],
            client: { logging: 'none' },
            port: 9100,
            open: true,
            hot: true
        }
    }
}