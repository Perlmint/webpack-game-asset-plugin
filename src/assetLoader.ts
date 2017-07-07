import * as wp from "webpack";
import { relative, extname, posix } from "path";
import { defaultsDeep, includes } from "lodash";
import { Compilation } from "./option";
import { localJoinPath } from "./util";
import * as loaderUtils from "loader-utils";

export default function(this: wp.loader.LoaderContext, content: Buffer) {
    const query: {[key: string]: string} = loaderUtils.getOptions(this) || {};
    const path = posix.normalize(relative(this._compiler.context, this.resourcePath)).replace(/\\/g, "/");
    const ext = extname(path);
    const name = path.replace(ext, "");

    const assets = defaultsDeep<any, Compilation>(this._compilation, { _game_asset_: {} })._game_asset_;
    if (assets[this.resourcePath] === undefined) {
        assets[this.resourcePath] = {
            name,
            ext: ext,
            srcFile: localJoinPath(this._compiler.context, path),
            outFile: path,
            query
        };
    }

    return `module.exports = { default: "${name}" }`;
}

export const raw = true;