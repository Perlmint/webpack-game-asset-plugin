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

## option

### assetRoots
`(string | [string, string])[]`
paths of root that collect assets from.

Automatically, this removes extension for using as name.
if array is passed, this assumes first element as source directory, second element as target directory.

### listOut
`string`

path where to write list of collected & processed assets

### makeAtlas
`boolean`

make atlas with collected images when processing phase

### compositor
`"gm"`

compositor used when make atlas. - node-sprite-generator

### atlasMap
`string` | `(string | string[])[]`

defintion of atlas groups.

`string` is passed, this plugin interpret as path, read file which given path.
Specified file should cantains json data in form described below.

`(string | string[])[]` is raw data. each element means prefix.
It can be directory prefix or filename.  
If element starts with `!`, matched images will be not used for making atlas.
just emitted as is.
