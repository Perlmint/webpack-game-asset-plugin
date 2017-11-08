import * as bb from "bluebird";
import { stat, readFile, Stats } from "fs";
import { parse as parsePath, join as localJoinPath, posix, ParsedPath } from "path";
import * as _debug from "debug";
import * as _ from "lodash";
import { createHash, Hash } from "crypto";
import { Module } from "webpack";

export { fileSync as tmpFile, SynchrounousResult, dirSync as tmpDir } from "tmp";
export { createWriteStream } from "fs";
export { isAbsolute, join as localJoinPath, parse as parsePath } from "path";
import * as xml2js from "xml2js";
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
    context: {
        referencedModules: { [key: string]: Module}
    },
    module: Module,
    cache: { [key: string]: string[]},
    loaderPath: string
) {
    const dependencies: [any, string[]][] = _.map(module.dependencies, dep => [dep, [module.resource]] as [any, string[]]);
    const assets: string[] = [];
    const assetDeps: {[key: string]: string[]} = {};
    while (dependencies.length !== 0) {
        const [dep, from] = dependencies.shift();
        // ignore null module
        if (dep.module == null) {
            continue;
        }
        // ignore helper
        if (dep.request === "webpack-game-asset-plugin/helper") {
            continue;
        }
        // ignore other referenced module
        if (_.find(context.referencedModules, m => m.resource === dep.module.resource) !== undefined) {
            debug("---", dep.module.resource);
            continue;
        }
        // depedency is asset
        if (_.some(dep.module.loaders, l => l.loader === loaderPath)) {
            assets.push(dep.module.resource);
            for (const f of from) {
                cache[f].push(dep.module.resource);
            }
        }
        // already cached!
        else if (cache[dep.module.resource]) {
            assets.push(...cache[dep.module.resource]);
        }
        // new normal module
        else {
            cache[dep.module.resource] = [];
            dependencies.push(..._.map(dep.module.dependencies, d => [d, [dep.module.resource, ...from]] as [any, string[]]));
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