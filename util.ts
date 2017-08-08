import * as bb from "bluebird";
import { stat, readFile, Stats } from "fs";
import { parse as parsePath, posix } from "path";
import * as _debug from "debug";

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
