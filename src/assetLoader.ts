import * as wp from "webpack";
import { relative, extname, posix, normalize, parse } from "path";
import { defaultsDeep, includes } from "lodash";
import { Compilation, InternalOption } from "./option";
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
    const option: InternalOption = this._compilation.__game_asset_plugin_option__;
    if (query["info"]) {
        const refModule = _.find<any>(this._compilation._modules, m => m.resource === query["info"]);
        const hash = createHash("md5");
        hash.update(refModule.identifier() + collectDependentAssets(this._compilation, refModule, {[refModule.resource]: []}, __filename).join(";"));
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
        let outFile = name;
        if (option.addHashToAsset) {
            outFile += `.${hashStr}`;
        }
        outFile += ext;
        let outPath = (query["raw"] || query["async"]) ? outFile.concat("") : undefined;
        if (query["async"]) {
            outPath = outPath.replace(ext, `_dep${ext}`);
        }
        if (assets[this.resourcePath] === undefined) {
            assets[this.resourcePath] = {
                name,
                ext: ext,
                srcFile,
                localized: [""],
                hash: hashStr,
                outFile,
                query
            };
        }
        if (query["async"]) {
            defaultsDeep<any, Compilation>(this._compilation, { _referenced_modules_: {} })._referenced_modules_[outPath.replace(ext, "")] = this._module;
        }

        cb(undefined, `exports = module.exports = { default: "${name}", path: ${JSON.stringify(outPath)}, __esModule: true }`);
    }
}

export const raw = true;