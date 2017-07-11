[![npm version](https://badge.fury.io/js/webpack-game-asset-plugin.svg)](https://badge.fury.io/js/webpack-game-asset-plugin)
[![dependencies Status](https://david-dm.org/perlmint/webpack-game-asset-plugin/status.svg)](https://david-dm.org/perlmint/webpack-game-asset-plugin)
[![devDependencies Status](https://david-dm.org/perlmint/webpack-game-asset-plugin/dev-status.svg)](https://david-dm.org/perlmint/webpack-game-asset-plugin?type=dev)
[![typedoc link](https://img.shields.io/badge/docs-typedoc-blue.svg)](https://perlmint.github.io/webpack-game-asset-plugin/index.html)

# webpack-game-asset-plugin
webpack plugin for HTML5 game asset

## usage - simple example

```
new assetPlugin({
  assetRoots: [
    "assets",
    ["assets/Data", "Data"]
  ],
  listOut: "resources.json",
  makeAtlas: true,
  compositor: "gm",
  atlasMap: [
    "game",
    "!game/effect"
  ]
})
```

## Optional Depedencies

### bitmapfont generation

- @mapbox/shelf-pack
- bitmapfont
- xml2js
- stream-buffers

### texture packing

- node-sprite-generator
- node-sprite-generator composer
  - gm

### making audiosrptie

- audiosprite

### audio encode

- fluent-ffmpeg

## option

see [typedoc](https://perlmint.github.io/webpack-game-asset-plugin/index.html)
