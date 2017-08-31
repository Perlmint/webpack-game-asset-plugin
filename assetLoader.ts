import * as wp from "webpack";
import { relative, extname, posix, normalize, parse } from "path";
import { defaultsDeep, includes } from "lodash";
import { Compilation } from "./option";
import { localJoinPath, collectDependentAssets, getFileHash } from "./util";
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
        const refModule = _.find(this._compilation._modules, m => m.resource === query["info"]);
        const hash = createHash("md5");
        hash.update(refModule.identifier() + collectDependentAssets(refModule, {[refModule.resource]: []}, __filename).join(";"));
        const hashStr = hash.digest("hex") + ".assets";
        defaultsDeep<any, Compilation>(this._compilation, { _referenced_modules_: {} })._referenced_modules_[hashStr] = refModule;
        this.addDependency(refModule.resource);

        return `module.exports = {
    RESOURCE_CONFIG_URL: "${hashStr}.json"
}`;
    } else {
        const cb = this.async();
        const { path, ext, name } = getAssetInfo(this, this.resourcePath);
        const srcFile = localJoinPath(this._compiler.context, path);
        const hash = createHash("md5");
        hash.update(content);
        const hashStr = hash.digest("hex");

        const assets = defaultsDeep<any, Compilation>(this._compilation, { _game_asset_: {} })._game_asset_;
        const outPath = query["raw"] ? path : undefined;
        if (assets[this.resourcePath] === undefined) {
            assets[this.resourcePath] = {
                name,
                ext: ext,
                srcFile,
                localized: [""],
                hash: hashStr,
                outFile: `${name}.${hashStr}${ext}`,
                query
            };
        }

        cb(undefined, `exports = module.exports = { default: "${name}", path: "${outPath}", __esModule: true }`);
    }
}

export const raw = true;