import * as _ from "lodash";
import * as loaderUtils from "loader-utils";
import * as it from "iter-tools";

import { Compilation, InternalOption } from "./option";
import { localJoinPath } from "./util";
import { extname, posix, relative } from "path";

import { createHash } from "crypto";
import { isJavascriptModule, markModuleAsAsset, PluginWarning } from "./webpack_util";
import { LoaderContext } from "loader-utils";
import { NormalModule } from "webpack";

function getAssetInfo(context: LoaderContext, resourcePath: string) {
    const path = posix.normalize(relative(context._compiler.context, resourcePath).replace(/\\/g, "/"));
    const ext = extname(path);
    const name = path;

    return {
        path,
        ext,
        name
    };
}

export default function(this: LoaderContext, content: Buffer) {
    const compilation = this._compilation as Compilation;
    const query: {[key: string]: string} = loaderUtils.getOptions(this) || {};
    const option: InternalOption = compilation.__game_asset_plugin_option__;
    const module = this._module;

    if (query["info"]) {
        this.cacheable();
        const refModule = it.find((m) => isJavascriptModule(m) && m.resource === query["info"], this._compilation.modules.values()) as NormalModule;
        const res_name = relative(this._compiler.context, refModule.resource);
        compilation._referenced_modules_.set(res_name, refModule);
        this.addDependency(refModule.resource);

        return `module.exports = {
    RESOURCE_CONFIG_URL: "${res_name.replace(/\\/g, "/")}.json"
}`;
    } else {
        this.cacheable();
        markModuleAsAsset(module);
        const cb = this.async();
        const { path, ext, name } = getAssetInfo(this, this.resourcePath);
        const srcFile = localJoinPath(this._compiler.context, path);
        const hash = createHash("md5");
        hash.update(content);
        const hashStr = hash.digest("hex");

        const assets = compilation._game_asset_;
        let outFile = name.replace(ext, "");
        if (option.addHashToAsset) {
            outFile += `.${hashStr}`;
        }
        outFile += ext;
        if (!assets.has(this.resourcePath)) {
            assets.set(this.resourcePath, {
                name,
                ext: ext,
                srcFile,
                localized: [""],
                hash: hashStr,
                outFile,
                query
            });
        }
        if (query["async"]) {
            if (!isJavascriptModule(module)) {
                // this._module.addWarning(new PluginWarning(module, "", undefined));
            } else {
                compilation._referenced_modules_.set(outFile.replace(ext, ""), module);
            }
        }

        cb(undefined, `exports = module.exports = { default: "${name}", path: ${JSON.stringify(outFile)}, __esModule: true }`);
    }
}

export const raw = true;