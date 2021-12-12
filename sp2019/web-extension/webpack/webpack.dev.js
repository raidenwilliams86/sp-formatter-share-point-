const merge = require('webpack-merge').merge;
const common = require('./webpack.common.js');
const webpack = require('webpack');
const ESLintPlugin = require('eslint-webpack-plugin');

module.exports = merge(common, {
  mode: 'none',
  plugins: [
    new webpack.SourceMapDevToolPlugin({
      filename: null,
      exclude: /monaco-build/
    }),
    new ESLintPlugin({
      lintDirtyModulesOnly: true,
      files: './src/**/*.{ts,tsx}'
    }),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development')
    })
  ]
});
