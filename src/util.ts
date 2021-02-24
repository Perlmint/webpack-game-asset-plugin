import * as _ from "lodash";
import * as it from "iter-tools";
import * as _debug from "debug";
import * as bb from "bluebird";
import * as xml2js from "xml2js";
import * as wp from "webpack";

import { Hash, createHash } from "crypto";
import { ParsedPath, join as localJoinPath, parse as parsePath, posix } from "path";
import { Stats, readFile, stat } from "fs";

import { Dependency, NormalModule } from "webpack";
import { isJavascriptModule } from "./webpack_util";

export { createWriteStream } from "fs";
export { isAbsolute, join as localJoinPath, parse as parsePath } from "path";

export const [
    /**
     * @hidden
     */
    readFileAsync,
    /**
     * @hidden
     */
    statAsync,
    /**
     * @hidden
     */
    relativePath,
    /**
     * @hidden
     */
    formatPath,
    /**
     * @hidden
     */
    joinPath,
    /**
     * @hidden
     */
    normalizePath,
    /**
     * @hidden
     */
    debug,
    /**
     * @hidden
     */
    parseXMLString
] = [
    bb.promisify(readFile),
    bb.promisify(stat),
    posix.relative,
    posix.format,
    posix.join,
    posix.normalize,
    _debug("wgap"),
    bb.promisify<any, xml2js.convertableToString>(xml2js.parseString)
];

export function collectDependentAssets(
    compilation: wp.Compilation,
    referencedModules: Map<string, NormalModule>,
    module: NormalModule,
    cache: Map<string, string[]>,
    loaderPath: string
) {
    const dependencies = _.map(module.dependencies, dep => [dep, [module.resource]] as [Dependency, string[]]);
    const assets: string[] = [];
    const assetDeps: {[key: string]: string[]} = {};
    while (dependencies.length !== 0) {
        const [dep, from] = dependencies.shift();
        const dep_module = compilation.moduleGraph.getModule(dep);
        // ignore null module
        if (dep_module == null) {
            continue;
        }
        // ignore helper
        if (!isJavascriptModule(dep_module)) {
            continue;
        }
        const module_id = dep_module.resource;
        // ignore other referenced module
        if (it.find(m => m.identifier() === dep_module.resource, referencedModules.values()) !== undefined) {
            debug("---", dep_module.resource);
            continue;
        }
        // depedency is asset
        if (_.some(dep_module.loaders, l => l.loader === loaderPath)) {
            assets.push(dep_module.resource);
            for (const f of from) {
                cache.get(f).push(dep_module.resource);
            }
        }
        // already cached!
        else if (cache.has(module_id)) {
            assets.push(...cache.get(module_id));
        }
        // new normal module
        else {
            cache.set(module_id, []);
            dependencies.push(..._.map(dep_module.dependencies, d => [d, [module_id, ...from]] as [any, string[]]));
        }
    }

    return assets;
}

export async function getFileHash(hash: string, path: string) {
    const h = createHash(hash);
    const buf = await readFileAsync(path);
    h.update(buf);
    return h;
}

export async function isExists(path: string) {
    return statAsync(path).thenReturn(true).catchReturn(false);
}

export function getLocalizedPath(path: string | ParsedPath, language: string) {
    let parsedPath: ParsedPath;
    if (typeof path === "string") {
        parsedPath = parsePath(path);
    } else {
        parsedPath = path;
    }

    if (language !== "") {
        language = `@${language}`;
    }

    return localJoinPath(parsedPath.dir, parsedPath.name + language + parsedPath.ext);
}
