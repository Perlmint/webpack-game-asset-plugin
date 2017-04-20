import * as bb from "bluebird";
import { stat, readFile, Stats } from "fs";
import { parse as parsePath, posix } from "path";
import * as _debug from "debug";

export { fileSync as tmpFile, SynchrounousResult } from "tmp";
export { createWriteStream } from "fs";
export { isAbsolute, join as localJoinPath, parse as parsePath } from "path";
export const [
    readFileAsync,
    statAsync,
    relativePath,
    formatPath,
    joinPath,
    normalizePath,
    debug
] = [
    bb.promisify(readFile),
    bb.promisify(stat),
    posix.relative,
    posix.format,
    posix.join,
    posix.normalize,
    _debug("wgap")
];
