import * as wp from "webpack";
import { relative, extname, posix } from "path";
import { defaultsDeep, includes } from "lodash";
import { Compilation } from "./option";
import { localJoinPath } from "./util";
import * as loaderUtils from "loader-utils";
import * as _ from "lodash";
import { createHash } from "crypto";

function getAssetInfo(context: wp.loader.LoaderContext, resourcePath: string) {
    const path = posix.normalize(relative(context._compiler.context, resourcePath)).replace(/\\/g, "/");
    const ext = extname(path);
    const name = path.replace(ext, "");

    return {
        path,
        ext,
        name
    };
}

export default function(this: wp.loader.LoaderContext, content: Buffer) {
    const query: {[key: string]: string} = loaderUtils.getOptions(this) || {};
    if (query["info"]) {
        const groupName = relative(this._compiler.context, query["info"]);
        const refModule = _.find(this._compilation._modules, m => m.resource === query["info"]);
        const referencedAssets = _.filter(refModule.dependencies, d => d.module != null && d.request !== "webpack-game-asset-plugin/dist/helper" && _.some(d.module.loaders, l => l.loader === __filename));
        const hash = createHash("sha256");
        const assetNames = _.map(referencedAssets, a => relative(this._compiler.context, a.module.resource));
        hash.update(assetNames.join(""));
        const hashStr = hash.digest("hex");
        defaultsDeep<any, Compilation>(this._compilation, { _referenced_modules_: {} })._referenced_modules_[hashStr] = assetNames;

        return `module.exports = {
    RESOURCE_CONFIG_URL: "${hashStr}.json"
}`;
    } else {
        const { path, ext, name } = getAssetInfo(this, this.resourcePath);

        const assets = defaultsDeep<any, Compilation>(this._compilation, { _game_asset_: {} })._game_asset_;
        const outPath = query["raw"] ? path : undefined;
        if (assets[this.resourcePath] === undefined) {
            assets[this.resourcePath] = {
                name,
                ext: ext,
                srcFile: localJoinPath(this._compiler.context, path),
                outFile: path,
                query
            };
        }

        return `module.exports = { default: "${name}", path: "${outPath}" }`;
    }
}

export const raw = true;